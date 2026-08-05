/**
 * JSON 备份导出与恢复。
 *
 * 图片以 data URL 内联进 JSON —— 体积大但胜在单文件、可直接丢网盘。
 * 不导出软删除的墓碑记录：恢复时本来就会重新分配 id，墓碑毫无意义。
 */
import { uid } from '../core/dom.js'
import { today } from '../core/fmt.js'
import { S, migrateBook, migrateChapter, migrateProblem } from '../core/state.js'
import { allBooks, allChapters, allProblems, BOOK } from '../core/selectors.js'
import { dbGet, dbPutMany } from './db.js'
import { blobToDataURL, dataURLToBlob } from './images.js'

const APP_TAG = 'cuotiben'
const FORMAT_VER = 2 // 2 起包含 latex / ai 字段

/** 打包成可下载的 Blob */
export async function buildBackup (all) {
  const books = all ? allBooks() : allBooks().filter(b => b.id === S.bookId)
  const ids = books.map(b => b.id)
  const chapters = allChapters().filter(c => ids.includes(c.bookId))
  const problems = allProblems().filter(p => ids.includes(p.bookId))

  const images = []
  for (const p of problems) {
    for (const ref of p.images) {
      const r = await dbGet('images', ref.id)
      if (!r) continue
      images.push({
        id: r.id, w: r.w, h: r.h,
        full: await blobToDataURL(r.full),
        thumb: await blobToDataURL(r.thumb || r.full)
      })
    }
  }

  const data = { app: APP_TAG, ver: FORMAT_VER, at: Date.now(), books, chapters, problems, images }
  return new Blob([JSON.stringify(data)], { type: 'application/json' })
}

export function downloadBlob (blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export const backupName = all =>
  `错题本备份_${all ? '全部' : (BOOK() ? BOOK().name : '')}_${today()}.json`

/** 解析并校验备份文件，返回原始数据供调用方确认后再写入 */
export async function readBackup (file) {
  const data = JSON.parse(await file.text())
  if (data.app !== APP_TAG) throw new Error('不是错题本的备份文件')
  data.books ||= []
  data.chapters ||= []
  data.problems ||= []
  data.images ||= []
  return data
}

/**
 * 作为新书籍追加导入，全部 id 重新分配，不覆盖现有内容。
 * 返回新导入的书籍列表，供调用方切换当前书。
 */
export async function applyBackup (data) {
  const map = {}

  const books = data.books.map(b => {
    const nb = migrateBook({ ...b, id: uid() })
    map[b.id] = nb.id
    return nb
  })

  const chapters = data.chapters.map(c => {
    const nc = migrateChapter({ ...c, id: uid(), bookId: map[c.bookId] })
    map[c.id] = nc.id
    return nc
  })
  chapters.forEach(c => { if (c.parentId) c.parentId = map[c.parentId] || null })

  const imap = {}
  const imgs = []
  for (const im of data.images) {
    const nid = uid()
    imap[im.id] = nid
    imgs.push({
      id: nid,
      full: await dataURLToBlob(im.full),
      thumb: await dataURLToBlob(im.thumb || im.full),
      w: im.w, h: im.h, createdAt: Date.now()
    })
  }

  const problems = data.problems.map(p => migrateProblem({
    ...p,
    id: uid(),
    bookId: map[p.bookId],
    chapterId: p.chapterId ? (map[p.chapterId] || null) : null,
    images: (p.images || []).map(i => ({ ...i, id: imap[i.id] })).filter(i => i.id)
  }))

  await dbPutMany('images', imgs)
  await dbPutMany('books', books)
  await dbPutMany('chapters', chapters)
  await dbPutMany('problems', problems)

  S.books.push(...books)
  S.chapters.push(...chapters)
  S.problems.push(...problems)

  return { books, problems }
}
