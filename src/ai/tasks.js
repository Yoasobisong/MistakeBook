/**
 * AI 任务：提取 LaTeX、分析考点难度。
 *
 * 提取被设计成可插拔的引擎（extractWithVision 是目前唯一实现）。
 * 以后要接 PaddleOCR / pix2tex 那种专用公式识别，只需在这里加一个同签名的
 * 引擎函数，上层 UI 与分析链路完全不用改。
 */
import { S } from '../core/state.js'
import { slotName } from '../core/consts.js'
import { BOOK, chTree, topicCounts, byCountDesc } from '../core/selectors.js'
import { uid } from '../core/dom.js'
import { imageForVision } from '../storage/images.js'
import { saveProblem } from '../storage/repo.js'
import { chat, chatJSON, stripFence } from './client.js'
import { isConfigured } from './config.js'
import { push } from './queue.js'
import { ANALYZE_SYS, CHAT_SYS, EXTRACT_SYS, analyzeUser, chatContext, extractUser } from './prompts.js'

/* ============================================================
   提取引擎
   ============================================================ */

/** 视觉模型引擎：整块图直接读，中文正文与公式混排能一次成型 */
async function extractWithVision (imageIds, slotKey, ctx, onChunk) {
  const parts = [{ type: 'text', text: extractUser(slotName(slotKey)) }]

  for (const id of imageIds) {
    // 库里存的是 WebP，部分推理后端不认，统一转 JPEG
    const url = await imageForVision(id)
    if (url) parts.push({ type: 'image_url', image_url: { url } })
  }
  if (parts.length === 1) return { ok: false, error: '这个区域没有可用的图片' }

  const id = uid()
  ctx?.register?.(id)
  const r = await chat('extract', [
    { role: 'system', content: EXTRACT_SYS },
    { role: 'user', content: parts }
  ], { id, temperature: 0.1, onChunk })
  ctx?.release?.(id)

  if (!r.ok) return r
  const text = stripFence(r.text)
  if (!text) return { ok: false, error: '模型返回了空内容' }
  return { ok: true, text }
}

const ENGINES = { vision: extractWithVision }

/* ============================================================
   单题操作
   ============================================================ */

/** 提取某个槽位的图片为 LaTeX 文本，写入 p.latex[slotKey] */
export async function extractSlot (p, slotKey, ctx, onChunk) {
  if (!isConfigured('extract')) {
    return { ok: false, error: '提取槽还没配好模型，去「设置 → AI」配置' }
  }

  const ids = p.images.filter(i => i.slot === slotKey).map(i => i.id)
  if (!ids.length) return { ok: false, error: `「${slotName(slotKey)}」还没有截图` }

  const engine = ENGINES[S.settings.ai.engine || 'vision']
  const r = await engine(ids, slotKey, ctx, onChunk)

  if (!r.ok) {
    p.ai.error = r.error
    await saveProblem(p)
    return r
  }

  p.latex[slotKey] = r.text
  p.ai.extractedAt = Date.now()
  p.ai.extractModel = S.settings.ai.extract.model
  p.ai.error = null
  await saveProblem(p)
  return r
}

/** 读 p.latex，产出考点/难度/章节/批注草稿，写入 p.ai.* */
export async function analyzeProblem (p, ctx) {
  if (!isConfigured('analyze')) {
    return { ok: false, error: '分析槽还没配好模型，去「设置 → AI」配置' }
  }
  if (!p.latex.q && !p.latex.a) {
    return { ok: false, error: '还没有文字内容 —— 先提取 LaTeX' }
  }

  const id = uid()
  ctx?.register?.(id)
  const r = await chatJSON('analyze', [
    { role: 'system', content: ANALYZE_SYS },
    {
      role: 'user',
      content: analyzeUser({
        book: BOOK()?.name,
        chapters: chTree(S.bookId),
        knownTopics: byCountDesc(topicCounts()).slice(0, 60),
        latex: p.latex,
        note: p.note
      })
    }
  ], { id, temperature: 0.3 })
  ctx?.release?.(id)

  if (!r.ok) {
    p.ai.error = r.error
    await saveProblem(p)
    return r
  }

  const d = r.data || {}
  const tree = chTree(S.bookId) || []
  const validChapter = tree.some(x => x.c.id === d.chapterId)

  const topics = (Array.isArray(d.topics) ? d.topics : [])
    .map(String).map(s => s.trim()).filter(Boolean).slice(0, 4)

  // 直接落地，不再走「建议 → 采纳」那一步
  const added = []
  for (const t of topics) {
    if (!p.topics.includes(t)) { p.topics.push(t); added.push(t) }
  }

  // 章节只在空着时才填 —— 手动归过类的题不该被模型改掉
  let chapterSet = false
  if (validChapter && !p.chapterId) { p.chapterId = d.chapterId; chapterSet = true }

  // 难度默认值是 3，光看值判断不出用户有没有手动设过，所以另用一个标记
  const diff = Math.max(0, Math.min(5, Math.round(+d.difficulty || 0)))
  let diffSet = false
  if (diff && !p.difficultyManual) { p.difficulty = diff; diffSet = true }

  Object.assign(p.ai, {
    summary: String(d.summary || '').slice(0, 120),
    topics,
    difficulty: diff,
    difficultyReason: String(d.difficultyReason || '').slice(0, 200),
    chapterId: validChapter ? d.chapterId : null,
    confidence: Math.max(0, Math.min(1, +d.confidence || 0)),
    analyzedAt: Date.now(),
    analyzeModel: S.settings.ai.analyze.model,
    error: null
  })
  await saveProblem(p)
  return { ok: true, data: p.ai, added, chapterSet, diffSet }
}

/* ============================================================
   就题目对话
   ============================================================ */

/** 只带最近若干轮，避免上下文无限膨胀 */
const HISTORY_TURNS = 12

export async function chatAbout (p, text) {
  if (!isConfigured('analyze')) {
    return { ok: false, error: '分析槽还没配好模型，去「设置 → AI」配置' }
  }

  const history = (p.chat || []).slice(-HISTORY_TURNS)
  const msgs = [
    { role: 'system', content: CHAT_SYS },
    { role: 'user', content: chatContext({ latex: p.latex, topics: p.topics }) },
    { role: 'assistant', content: '好的，我看过这道题了。你想讨论哪部分？' },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: text }
  ]

  return chat('analyze', msgs, { temperature: 0.5 })
}

/* ============================================================
   批量：排进队列
   ============================================================ */

/** 提取一批题目里所有有图的槽位 */
export function queueExtract (problems, slots = ['q', 'a', 'x']) {
  const jobs = []
  for (const p of problems) {
    for (const k of slots) {
      if (!p.images.some(i => i.slot === k)) continue
      jobs.push(ctx => extractSlot(p, k, ctx))
    }
  }
  return jobs.length ? push(jobs, '提取') : Promise.resolve([])
}

export function queueAnalyze (problems) {
  const jobs = problems.map(p => ctx => analyzeProblem(p, ctx))
  return jobs.length ? push(jobs, '分析') : Promise.resolve([])
}

/**
 * 粘贴截图后的自动流程。
 * 两个开关都关就直接返回，不打扰。
 */
export async function autoPipeline (problems) {
  const cfg = S.settings.ai
  if (!cfg.autoExtract || !isConfigured('extract')) return
  const list = [].concat(problems).filter(Boolean)
  if (!list.length) return

  await queueExtract(list)

  if (!cfg.autoAnalyze || !isConfigured('analyze')) return
  await queueAnalyze(list.filter(p => p.latex.q || p.latex.a))
}
