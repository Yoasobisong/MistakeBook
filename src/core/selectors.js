/**
 * 纯查询层 —— 不碰 DOM、不写数据库，只从 S 里派生数据。
 *
 * 因为无副作用，UI 各模块可以自由 import 而不会成环。
 * 所有集合访问都在这里统一过滤软删除墓碑（deletedAt），
 * 调用方不需要自己记得加这个条件。
 */
import { S } from './state.js'

/* ---------- 带墓碑过滤的基础集合 ---------- */

export const allBooks = () => S.books.filter(b => !b.deletedAt)
export const allChapters = () => S.chapters.filter(c => !c.deletedAt)
export const allProblems = () => S.problems.filter(p => !p.deletedAt)

const live = r => (r && !r.deletedAt) ? r : null

export const findBook = id => live(S.books.find(b => b.id === id))
export const findChapter = id => live(S.chapters.find(c => c.id === id))
export const findProblem = id => live(S.problems.find(p => p.id === id))

export const BOOK = () => findBook(S.bookId)
export const PROB = () => findProblem(S.problemId)

export const bookProblems = (bid = S.bookId) =>
  S.problems.filter(p => !p.deletedAt && p.bookId === bid)

export const chOf = bid => S.chapters.filter(c => !c.deletedAt && c.bookId === bid)

/* ---------- 章节树 ---------- */

/** 深度优先展开成 [{c, depth}]，同级按 order 排 */
export function chTree (bid) {
  const byP = {}
  for (const c of chOf(bid)) (byP[c.parentId || ''] ||= []).push(c)
  Object.values(byP).forEach(a => a.sort((x, y) => x.order - y.order))
  const out = []
  ;(function walk (pid, depth) {
    for (const c of byP[pid] || []) { out.push({ c, depth }); walk(c.id, depth + 1) }
  })('', 0)
  return out
}

/** 自身 + 全部后代章节的 id */
export function descendants (cid) {
  const kids = new Map()
  for (const c of allChapters()) {
    if (!c.parentId) continue
    let a = kids.get(c.parentId)
    if (!a) kids.set(c.parentId, a = [])
    a.push(c.id)
  }
  const out = [cid]
  for (let i = 0; i < out.length; i++) {
    for (const k of kids.get(out[i]) || []) out.push(k)
  }
  return out
}

export const chName = cid => (findChapter(cid) || {}).title || '未归类'

export const hasKids = cid => allChapters().some(c => c.parentId === cid)

/** 某章节（含子章节）下的题目数 */
export function countIn (cid) {
  const set = cid ? descendants(cid) : null
  return bookProblems().filter(p =>
    cid === null ? true : cid === '' ? !p.chapterId : set.includes(p.chapterId)
  ).length
}

/* ---------- 标签词频（筛选面板、侧栏建议、AI 提示词共用） ---------- */

export function reasonCounts (bid = S.bookId) {
  const m = {}
  for (const p of bookProblems(bid)) for (const r of p.reasons || []) m[r] = (m[r] || 0) + 1
  return m
}

export function topicCounts (bid = S.bookId) {
  const m = {}
  for (const p of bookProblems(bid)) for (const t of p.topics || []) m[t] = (m[t] || 0) + 1
  return m
}

export const byCountDesc = m => Object.keys(m).sort((a, b) => m[b] - m[a])

/* ---------- 列表筛选与排序 ---------- */

const SORTS = {
  new: (x, y) => (y.createdAt - x.createdAt) || (y.no - x.no),
  old: (x, y) => (x.createdAt - y.createdAt) || (x.no - y.no),
  hard: (x, y) => (y.difficulty - x.difficulty) || (y.createdAt - x.createdAt) || (y.no - x.no),
  weak: (x, y) => ((x.mastery | 0) - (y.mastery | 0)) || (y.difficulty - x.difficulty) ||
                  (y.createdAt - x.createdAt) || (y.no - x.no)
}

/** 当前书籍 + 章节 + 筛选条件 + 搜索词下的题目，已排序 */
export function filtered () {
  const f = S.f
  const q = S.q.trim().toLowerCase()
  const set = (S.chapterId && S.chapterId !== '') ? descendants(S.chapterId) : null

  const arr = bookProblems().filter(p => {
    if (S.chapterId === '') { if (p.chapterId) return false }
    else if (set && !set.includes(p.chapterId)) return false
    if (f.kind && p.kind !== f.kind) return false
    if (f.star && !p.starred) return false
    if (f.noAnswer && p.images.some(i => i.slot === 'a')) return false
    // 「未提取」只针对有截图的题 —— 空题还没录内容，不算待处理
    if (f.noText && (!p.images.length || (p.latex?.q || '').trim())) return false
    // 「未分析」要求已经有文字，否则分析也无从谈起（答案不提取文字，只认题干）
    if (f.noAI && (!(p.latex?.q || '').trim() || p.ai?.analyzedAt)) return false
    if (f.diff.length && !f.diff.includes(p.difficulty)) return false
    if (f.mastery.length && !f.mastery.includes(p.mastery | 0)) return false
    if (f.reasons.length && !f.reasons.every(r => (p.reasons || []).includes(r))) return false
    if (q) {
      const lx = p.latex || {}
      const hay = [
        p.title, p.note, p.source, chName(p.chapterId),
        (p.reasons || []).join(' '), (p.topics || []).join(' '),
        lx.q, lx.x, p.ai?.summary
      ].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return arr.sort(SORTS[S.sort] || SORTS.new)
}

/** 当前筛选是否处于激活状态（用于空状态文案与「清除」按钮） */
export const isFiltering = () => {
  const f = S.f
  return !!(S.q || f.reasons.length || f.diff.length || f.mastery.length ||
    f.star || f.kind || f.noAnswer || f.noText || f.noAI)
}
