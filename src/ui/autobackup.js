/**
 * 自动备份（仅 Electron）。
 *
 * 走增量文件夹格式：图片按 id 拆成独立文件只写一次，每次只追加新增的，
 * 再配一份几百 KB 的元数据快照。这样把备份目录设成网盘同步文件夹时，
 * 同步客户端每天只需要传新题的截图，而不是把几百 MB 重传一遍。
 */
import { S } from '../core/state.js'
import { fmtD } from '../core/fmt.js'
import { bytes } from '../core/fmt.js'
import { buildMeta, collectNewImages, applyFolderBackup } from '../storage/backup.js'
import { markBackedUp } from '../storage/repo.js'
import { modal } from './modal.js'
import { toast } from './toast.js'
import { renderAll } from './render.js'

export const canAutoBackup = () => !!window.native?.backup

/** 文件名用本地时间，便于人肉辨认 */
function stamp () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export async function runBackup (silent) {
  const cfg = S.settings.backup
  if (!canAutoBackup() || !cfg.dir) return { ok: false, error: '还没设置备份目录' }

  try {
    const { meta, problems } = buildMeta()
    const have = await window.native.backup.haveImages(cfg.dir)
    const { newImages, imageMeta } = await collectNewImages(problems, have)
    meta.imageMeta = imageMeta

    const r = await window.native.backup.writeIncremental({
      dir: cfg.dir,
      meta,
      stamp: stamp(),
      images: newImages,
      keep: cfg.keep
    })

    if (!r.ok) {
      if (!silent) toast('备份失败', r.error.slice(0, 50))
      return r
    }

    cfg.lastAt = Date.now()
    await markBackedUp()

    if (!silent) {
      const bits = [`新增 ${r.newImages} 张图`]
      if (r.bytes) bits.push(bytes(r.bytes))
      if (r.orphans) bits.push(`清理 ${r.orphans} 张过期图`)
      toast('已备份', bits.join(' · '))
    }
    return r
  } catch (e) {
    if (!silent) toast('备份失败', String(e?.message || e).slice(0, 50))
    return { ok: false, error: String(e?.message || e) }
  }
}

/**
 * 启动后按间隔补一次。
 * 只在「距上次超过设定天数」时才跑，一天开关几次应用不会写几份。
 */
export function scheduleBackup () {
  const cfg = S.settings.backup
  if (!canAutoBackup() || !cfg.enabled || !cfg.dir) return
  if (!S.problems.some(p => !p.deletedAt)) return // 空库没什么可备份的
  if (Date.now() - (cfg.lastAt || 0) <= cfg.everyDays * 864e5) return

  // 延后到首屏之后：备份要读全部图片 blob，抢在前面会拖慢启动
  setTimeout(async () => {
    const r = await runBackup(true)
    if (r.ok) toast('已自动备份', r.newImages ? `新增 ${r.newImages} 张图` : '没有新内容')
  }, 6000)
}

/* ---------- 从备份文件夹恢复 ---------- */

export async function restoreFromFolder () {
  if (!canAutoBackup()) { toast('浏览器版不支持', '请用桌面版'); return }

  const dir = await window.native.backup.pickDir()
  if (!dir) return

  const snaps = await window.native.backup.snapshots(dir)
  if (!snaps.length) {
    toast('这个目录里没有备份快照', '选包含 meta-*.json 的那个文件夹')
    return
  }

  const pick = await modal({
    title: '从备份文件夹恢复',
    okText: '恢复',
    wide: true,
    body: `<div style="font-size:13px;color:var(--ink2);line-height:1.9">
      找到 <b>${snaps.length}</b> 份快照，选择要恢复的时间点：
      <select class="inp" id="snapPick" style="margin-top:8px">
        ${snaps.map((s, i) => {
          const c = s.counts
          const d = new Date(s.at)
          const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          return `<option value="${s.name}" ${i === 0 ? 'selected' : ''}>${label}${c ? `　${c.problems} 题 · ${c.images} 图` : ''}</option>`
        }).join('')}
      </select>
      <div style="font-size:12px;color:var(--ink3);margin-top:9px;line-height:1.8">
        恢复的内容会作为<b>新书籍追加</b>进来，不会覆盖现有数据。<br>
        所以同一份快照恢复两次会得到两套副本。
      </div></div>`,
    onOk: w => ({ name: w.querySelector('#snapPick').value })
  })
  if (!pick) return

  toast('正在读取…')
  const r = await window.native.backup.readSnapshot({ dir, name: pick.name })
  if (!r.ok) { toast('读取失败', r.error.slice(0, 50)); return }

  const res = await applyFolderBackup(r.meta, r.files)
  if (res.books[0]) S.bookId = res.books[0].id
  renderAll()
  toast(
    '恢复完成',
    `${res.problems.length} 题${res.missing ? ` · ${res.missing} 张图片文件缺失` : ''}`
  )
}
