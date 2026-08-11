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
import { emit } from '../core/bus.js'
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
  emit('data:saved')
  return b
}

export async function saveBook (b) {
  b.updatedAt = now()
  await dbPut('books', b)
  emit('data:saved')
}

/** 软删整本书：书 + 章节 + 题目打墓碑，图片真删 */
export async function deleteBook (id) {
  const b = findBook(id)
  if (!b) return
  const ts = now()
  const ps = bookProblems(id)
  const cs = chOf(id)

  // 同样只打墓碑，图片留给 purgeTombstones 清
  ps.forEach(p => { p.deletedAt = ts; p.updatedAt = ts })
  cs.forEach(c => { c.deletedAt = ts; c.updatedAt = ts })
  b.deletedAt = ts
  b.updatedAt = ts

  await dbPutMany('problems', ps)
  await dbPutMany('chapters', cs)
  await dbPut('books', b)
  emit('data:saved')
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
  emit('data:saved')
  return c
}

export async function saveChapter (c) {
  c.updatedAt = now()
  await dbPut('chapters', c)
  emit('data:saved')
}

export async function saveChapters (arr) {
  const ts = now()
  arr.forEach(c => { c.updatedAt = ts })
  await dbPutMany('chapters', arr)
  emit('data:saved')
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
  emit('data:saved')
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

/**
 * 这本书下一个可用的题号 —— 取最小的空号。
 *
 * 不用「历史最大号 +1」是因为那样会越删越稀疏：1 2 3 删掉 2，
 * 下一道就成了 4，留下一个永远补不上的洞。这里让新题补回空位。
 *
 * 只统计活着的题，回收站里的**不占号** —— 否则「删了却还占着号」
 * 等于没删。代价是恢复时可能撞号，交给 restoreProblem 重新分配。
 */
function nextNo (bookId) {
  const used = new Set(bookProblems(bookId).map(p => p.no))
  let n = 1
  while (used.has(n)) n++
  return n
}

export async function createProblem (imgRecs, slot, bookId = S.bookId, chapterId = S.chapterId) {
  const bk = findBook(bookId)
  if (!bk) return null

  const no = nextNo(bk.id)
  // seq 不再是「下一个号」，改成「历史最大号」—— 云端按它给书籍排序，
  // 旧数据里也存着这个字段，留着比删掉省事
  bk.seq = Math.max(bk.seq || 0, no)
  await saveBook(bk)

  const p = {
    id: uid(), bookId: bk.id, chapterId: chapterId || null,
    no, title: '', kind: 'wrong', difficulty: 3, mastery: 0, starred: false,
    reasons: [], topics: [], source: '', note: '',
    latex: emptyLatex(), ai: emptyAI(),
    images: (imgRecs || []).map(r => ({ id: r.id, slot: slot || 'q', cap: '' })),
    createdAt: now(), updatedAt: now(), deletedAt: 0, reviewCount: 0
  }
  S.problems.push(p)
  await dbPut('problems', p)
  emit('data:saved')
  return p
}

export async function saveProblem (p) {
  p.updatedAt = now()
  await dbPut('problems', p)
  emit('data:saved')
}

export async function saveProblems (arr) {
  const ts = now()
  arr.forEach(p => { p.updatedAt = ts })
  await dbPutMany('problems', arr)
  emit('data:saved')
}

/** 软删题目，图片真删 */
/**
 * 软删除。
 * 图片 blob **不在这里删** —— 删了的话从回收站恢复出来就是一道没有截图的空题，
 * 回收站也就失去意义了。blob 留到 purgeTombstones 真正清理时才释放。
 */
export async function deleteProblem (id) {
  const p = findProblem(id)
  if (!p) return
  p.deletedAt = now()
  p.updatedAt = p.deletedAt
  await dbPut('problems', p)
  emit('data:saved')
}

/** 从回收站恢复 */
export async function restoreProblem (id) {
  const p = S.problems.find(x => x.id === id)
  if (!p) return

  // 题号在删除的那一刻就释放了，很可能已经被后来的新题占走。
  // 必须赶在复活之前判断 —— 复活之后 p 自己也在活题里，一定会「撞上自己」
  const taken = bookProblems(p.bookId).some(x => x.no === p.no)

  p.deletedAt = 0
  p.updatedAt = now()
  // 撞号就当新题重新拿一个，不去动那道占了号的题
  if (taken) p.no = nextNo(p.bookId)
  // 原属章节可能已经被删了，那就退回未归类
  if (p.chapterId && !S.chapters.some(c => c.id === p.chapterId && !c.deletedAt)) {
    p.chapterId = null
  }
  await dbPut('problems', p)
  emit('data:saved')
  return p
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
  const cut = days <= 0 ? Infinity : now() - days * 864e5
  const dead = r => r.deletedAt && r.deletedAt < cut
  const P = S.problems.filter(dead)
  const C = S.chapters.filter(dead)
  const B = S.books.filter(dead)

  // 到这一步才真正释放图片 blob —— 软删除时留着是为了能从回收站恢复
  const imgIds = P.flatMap(p => (p.images || []).map(i => i.id))
  if (imgIds.length) {
    await dbDelMany('images', imgIds)
    forgetImages(imgIds)
  }

  await dbDelMany('problems', P.map(r => r.id))
  await dbDelMany('chapters', C.map(r => r.id))
  await dbDelMany('books', B.map(r => r.id))

  S.problems = S.problems.filter(r => !dead(r))
  S.chapters = S.chapters.filter(r => !dead(r))
  S.books = S.books.filter(r => !dead(r))
  return { records: P.length + C.length + B.length, images: imgIds.length }
}

/** 回收站里的题目，最近删的排前面 */
export const trashed = () =>
  S.problems.filter(p => p.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt)
