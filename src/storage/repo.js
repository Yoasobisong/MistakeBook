/**
 * 业务仓储层 —— 所有写操作的唯一入口。
 *
 * 之所以强制收口在这里，是为了后续接 Cloudflare 同步：
 * 届时只需在这一层挂上「推送到远端」的钩子，UI 代码一行都不用改。
 *
 * 删除策略：软删除。
 *   记录本身只标记 deletedAt（同步时用来告诉另一端「这条已删」），
 *   但图片 blob 真删 —— 墓碑是给同步用的，不是给撤销用的，留着 blob 纯属浪费空间。
 */
import { debounce, uid } from '../core/dom.js'
import {
  S, mergeSettings, migrateBook, migrateChapter, migrateProblem,
  emptyAI, emptyLatex
} from '../core/state.js'
import { chOf, descendants, bookProblems, findBook, findChapter, findProblem } from '../core/selectors.js'
import { dbAll, dbDel, dbDelMany, dbGet, dbPut, dbPutMany } from './db.js'
import { forgetImages } from './images.js'

const now = () => Date.now()

/* ---------- 启动加载 ---------- */

export async function loadAll () {
  const [books, chapters, problems, ui, st, bk] = await Promise.all([
    dbAll('books'), dbAll('chapters'), dbAll('problems'),
    dbGet('meta', 'ui'), dbGet('meta', 'settings'), dbGet('meta', 'backup')
  ])

  S.books = books.map(migrateBook).sort((a, b) => (a.order || 0) - (b.order || 0))
  S.chapters = chapters.map(migrateChapter)
  S.problems = problems.map(migrateProblem)
  S.settings = mergeSettings(st && st.v)
  S.lastBackup = (bk && bk.v) || 0

  if (ui && ui.v) {
    S.bookId = ui.v.bookId
    S.chapterId = ui.v.chapterId === undefined ? null : ui.v.chapterId
    S.sort = ui.v.sort || 'new'
    S.size = ui.v.size || 'md'
  }
  if (!findBook(S.bookId)) S.bookId = S.books.find(b => !b.deletedAt)?.id || null
  if (S.chapterId && !findChapter(S.chapterId)) S.chapterId = null
}

/* ---------- meta ---------- */

export async function saveMeta () {
  await dbPut('meta', {
    k: 'ui',
    v: { bookId: S.bookId, chapterId: S.chapterId, sort: S.sort, size: S.size }
  })

  // Electron 下 API key 走 safeStorage 加密存储，不落 IndexedDB
  let settings = S.settings
  if (window.native?.isElectron) {
    settings = {
      ...settings,
      ai: {
        ...settings.ai,
        extract: { ...settings.ai.extract, apiKey: '' },
        analyze: { ...settings.ai.analyze, apiKey: '' }
      }
    }
  }
  await dbPut('meta', { k: 'settings', v: settings })
}

export const saveMetaSoon = debounce(saveMeta, 400)

export async function markBackedUp () {
  S.lastBackup = now()
  await dbPut('meta', { k: 'backup', v: S.lastBackup })
}

/* ---------- 书籍 ---------- */

export async function createBook (name) {
  const b = {
    id: uid(), name, order: S.books.length, seq: 0,
    createdAt: now(), updatedAt: now(), deletedAt: 0
  }
  S.books.push(b)
  await dbPut('books', b)
  return b
}

export async function saveBook (b) {
  b.updatedAt = now()
  await dbPut('books', b)
}

/** 软删整本书：书 + 章节 + 题目打墓碑，图片真删 */
export async function deleteBook (id) {
  const b = findBook(id)
  if (!b) return
  const ts = now()
  const ps = bookProblems(id)
  const cs = chOf(id)

  const imgIds = ps.flatMap(p => p.images.map(i => i.id))
  await dbDelMany('images', imgIds)
  forgetImages(imgIds)

  ps.forEach(p => { p.deletedAt = ts; p.updatedAt = ts; p.images = [] })
  cs.forEach(c => { c.deletedAt = ts; c.updatedAt = ts })
  b.deletedAt = ts
  b.updatedAt = ts

  await dbPutMany('problems', ps)
  await dbPutMany('chapters', cs)
  await dbPut('books', b)
}

/* ---------- 章节 ---------- */

export async function createChapter (bookId, parentId, title) {
  const sibs = chOf(bookId).filter(c => (c.parentId || '') === (parentId || ''))
  const c = {
    id: uid(), bookId, parentId: parentId || null, title,
    order: sibs.length, collapsed: false,
    createdAt: now(), updatedAt: now(), deletedAt: 0
  }
  S.chapters.push(c)
  await dbPut('chapters', c)
  return c
}

export async function saveChapter (c) {
  c.updatedAt = now()
  await dbPut('chapters', c)
}

export async function saveChapters (arr) {
  const ts = now()
  arr.forEach(c => { c.updatedAt = ts })
  await dbPutMany('chapters', arr)
}

/** 软删章节及其子章节；其下题目移到「未归类」，不会丢 */
export async function deleteChapter (cid) {
  const kids = descendants(cid)
  const ts = now()
  const moved = S.problems.filter(p => !p.deletedAt && kids.includes(p.chapterId))
  moved.forEach(p => { p.chapterId = null; p.updatedAt = ts })

  const cs = S.chapters.filter(c => kids.includes(c.id))
  cs.forEach(c => { c.deletedAt = ts; c.updatedAt = ts })

  await dbPutMany('problems', moved)
  await dbPutMany('chapters', cs)
  return { kids, moved: moved.length }
}

/** 把同级 order 重排成 0..n-1，消除 999 之类的临时值 */
export async function normalizeOrders (bookId = S.bookId) {
  const groups = {}
  for (const c of chOf(bookId)) (groups[c.parentId || ''] ||= []).push(c)
  const dirty = []
  for (const a of Object.values(groups)) {
    a.sort((x, y) => x.order - y.order).forEach((c, i) => { if (c.order !== i) { c.order = i; dirty.push(c) } })
  }
  await saveChapters(dirty)
}

/* ---------- 题目 ---------- */

export async function createProblem (imgRecs, slot, bookId = S.bookId, chapterId = S.chapterId) {
  const bk = findBook(bookId)
  if (!bk) return null
  bk.seq = (bk.seq || 0) + 1
  await saveBook(bk)

  const p = {
    id: uid(), bookId: bk.id, chapterId: chapterId || null,
    no: bk.seq, title: '', kind: 'wrong', difficulty: 3, mastery: 0, starred: false,
    reasons: [], topics: [], source: '', note: '',
    latex: emptyLatex(), ai: emptyAI(),
    images: (imgRecs || []).map(r => ({ id: r.id, slot: slot || 'q', cap: '' })),
    createdAt: now(), updatedAt: now(), deletedAt: 0, reviewCount: 0
  }
  S.problems.push(p)
  await dbPut('problems', p)
  return p
}

export async function saveProblem (p) {
  p.updatedAt = now()
  await dbPut('problems', p)
}

export async function saveProblems (arr) {
  const ts = now()
  arr.forEach(p => { p.updatedAt = ts })
  await dbPutMany('problems', arr)
}

/** 软删题目，图片真删 */
export async function deleteProblem (id) {
  const p = findProblem(id)
  if (!p) return
  const imgIds = p.images.map(i => i.id)
  await dbDelMany('images', imgIds)
  forgetImages(imgIds)
  p.images = []
  p.deletedAt = now()
  p.updatedAt = p.deletedAt
  await dbPut('problems', p)
}

/** 删除题目里的单张图 */
export async function deleteImage (p, imgId) {
  const i = p.images.findIndex(x => x.id === imgId)
  if (i < 0) return
  p.images.splice(i, 1)
  await dbDel('images', imgId)
  forgetImages([imgId])
  await saveProblem(p)
}

/* ---------- 墓碑清理 ---------- */

/**
 * 清掉超过 days 天的墓碑记录。
 * 同步尚未接入前不会自动调用 —— 一旦有多端，太早清墓碑会让已删记录复活。
 */
export async function purgeTombstones (days = 90) {
  const cut = now() - days * 864e5
  const dead = r => r.deletedAt && r.deletedAt < cut
  const P = S.problems.filter(dead)
  const C = S.chapters.filter(dead)
  const B = S.books.filter(dead)

  await dbDelMany('problems', P.map(r => r.id))
  await dbDelMany('chapters', C.map(r => r.id))
  await dbDelMany('books', B.map(r => r.id))

  S.problems = S.problems.filter(r => !dead(r))
  S.chapters = S.chapters.filter(r => !dead(r))
  S.books = S.books.filter(r => !dead(r))
  return P.length + C.length + B.length
}
