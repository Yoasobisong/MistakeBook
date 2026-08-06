/**
 * 备份写盘（主进程）。
 *
 * 两种格式：
 *   单文件   —— 手动导出用，一个 JSON 带 base64 图片，方便发给别人
 *   增量文件夹 —— 自动备份用，图片拆成独立文件按 id 命名，只写一次；
 *                每次只追加新图 + 一份几百 KB 的元数据快照
 *
 * 增量格式是为网盘同步准备的：单文件格式每次全量重写几百 MB，
 * 丢进同步目录等于每天重传一遍一模一样的内容。
 *
 *     备份目录/
 *       images/<id>.webp          只写一次，之后永不改动
 *       meta-20260806-1430.json   每次一份
 */
const fs = require('node:fs')
const path = require('node:path')

const PREFIX = 'cuotiben-backup-'
const META = 'meta-'
const IMGDIR = 'images'

const ensureDir = dir => fs.mkdirSync(dir, { recursive: true })

/* ---------- 单文件格式 ---------- */

function listBackups (dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => f.startsWith(PREFIX) && f.endsWith('.json'))
      .map(f => {
        const st = fs.statSync(path.join(dir, f))
        return { name: f, size: st.size, at: st.mtimeMs }
      })
      .sort((a, b) => b.at - a.at)
  } catch (_) {
    return []
  }
}

/* ---------- 增量格式 ---------- */

function listSnapshots (dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => f.startsWith(META) && f.endsWith('.json'))
      .map(f => {
        const st = fs.statSync(path.join(dir, f))
        let counts = null
        try {
          const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
          counts = {
            books: (j.books || []).length,
            problems: (j.problems || []).length,
            images: (j.imageMeta || []).length
          }
        } catch (_) {}
        return { name: f, size: st.size, at: st.mtimeMs, counts }
      })
      .sort((a, b) => b.at - a.at)
  } catch (_) {
    return []
  }
}

/** 目录里已有的图片 id，用来算增量 */
function haveImages (dir) {
  try {
    return fs.readdirSync(path.join(dir, IMGDIR))
      .map(f => f.replace(/\.[^.]+$/, ''))
  } catch (_) {
    return []
  }
}

/**
 * 清掉不再被任何保留快照引用的图片。
 * 必须扫全部保留下来的 meta，只按最新一份清会让旧快照失去图片，
 * 那样「翻出三天前的备份捞回误删的题」就不成立了。
 */
function pruneOrphans (dir) {
  const keep = new Set()
  for (const s of listSnapshots(dir)) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, s.name), 'utf8'))
      for (const im of j.imageMeta || []) keep.add(im.id)
    } catch (_) {
      return 0 // 有 meta 读不出来就别删，宁可留着垃圾也不能删错
    }
  }

  let n = 0
  const imgDir = path.join(dir, IMGDIR)
  let files = []
  try { files = fs.readdirSync(imgDir) } catch (_) { return 0 }

  for (const f of files) {
    if (keep.has(f.replace(/\.[^.]+$/, ''))) continue
    try { fs.unlinkSync(path.join(imgDir, f)); n++ } catch (_) {}
  }
  return n
}

function registerBackup (ipcMain, app, dialog, BrowserWindow) {
  ipcMain.handle('backup:pickDir', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const r = await dialog.showOpenDialog(win, {
      title: '选择备份目录（可以选网盘的同步文件夹）',
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? '' : r.filePaths[0]
  })

  ipcMain.handle('backup:defaultDir', () =>
    path.join(app.getPath('documents'), '错题本备份'))

  ipcMain.handle('backup:list', (_e, dir) => listBackups(dir))
  ipcMain.handle('backup:snapshots', (_e, dir) => listSnapshots(dir))
  ipcMain.handle('backup:haveImages', (_e, dir) => haveImages(dir))

  ipcMain.handle('backup:reveal', (_e, dir) => {
    require('electron').shell.openPath(dir)
    return true
  })

  /** 单文件写入（手动导出到目录时用） */
  ipcMain.handle('backup:write', (_e, { dir, data, keep = 5, stamp }) => {
    try {
      ensureDir(dir)
      const file = path.join(dir, `${PREFIX}${stamp}.json`)
      fs.writeFileSync(file, Buffer.from(data))

      let removed = 0
      for (const o of listBackups(dir).slice(Math.max(1, keep))) {
        try { fs.unlinkSync(path.join(dir, o.name)); removed++ } catch (_) {}
      }
      return { ok: true, file, size: fs.statSync(file).size, removed }
    } catch (e) {
      return { ok: false, error: String(e?.message || e) }
    }
  })

  /**
   * 增量写入。
   * @param images 只包含目录里还没有的图片，[{id, ext, data}]
   * @param keep   保留多少份元数据快照
   */
  ipcMain.handle('backup:writeIncremental', (_e, { dir, meta, stamp, images = [], keep = 30 }) => {
    try {
      ensureDir(dir)
      const imgDir = path.join(dir, IMGDIR)
      ensureDir(imgDir)

      let bytes = 0
      for (const im of images) {
        const f = path.join(imgDir, `${im.id}.${im.ext || 'webp'}`)
        const buf = Buffer.from(im.data)
        fs.writeFileSync(f, buf)
        bytes += buf.length
      }

      const metaFile = path.join(dir, `${META}${stamp}.json`)
      fs.writeFileSync(metaFile, JSON.stringify(meta))
      const metaSize = fs.statSync(metaFile).size

      // 轮换旧快照
      let dropped = 0
      for (const o of listSnapshots(dir).slice(Math.max(1, keep))) {
        try { fs.unlinkSync(path.join(dir, o.name)); dropped++ } catch (_) {}
      }

      const orphans = dropped ? pruneOrphans(dir) : 0
      return { ok: true, newImages: images.length, bytes, metaSize, dropped, orphans }
    } catch (e) {
      return { ok: false, error: String(e?.message || e) }
    }
  })

  /** 读一份快照：元数据 + 它引用到的全部图片 */
  ipcMain.handle('backup:readSnapshot', (_e, { dir, name }) => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
      const files = []
      for (const im of meta.imageMeta || []) {
        const f = path.join(dir, IMGDIR, `${im.id}.${im.ext || 'webp'}`)
        try {
          files.push({ id: im.id, data: fs.readFileSync(f).buffer })
        } catch (_) { /* 缺文件就跳过，恢复端会统计 */ }
      }
      return { ok: true, meta, files }
    } catch (e) {
      return { ok: false, error: String(e?.message || e) }
    }
  })
}

module.exports = { registerBackup }
