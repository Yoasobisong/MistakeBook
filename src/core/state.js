/**
 * 全局内存状态。
 *
 * 这是个纯数据容器 —— 不 import 任何 storage / ui 模块，保证依赖单向。
 * 持久化由 storage/repo.js 负责读写这里的字段。
 */

export function defaultSettings () {
  return {
    autoTrim: true,
    foldAnswer: true,
    maxW: 1600,
    /** 正文缩放，Ctrl+滚轮调节 */
    zoom: 1,
    /** 自动备份，仅 Electron 下可用 */
    backup: { enabled: false, dir: '', keep: 5, everyDays: 1, lastAt: 0 },
    /** 云端同步：桌面版单向推送，网页端只读。
     *  qCleanedAt 标记「已清理过云端残留的题目截图引用」，是一次性迁移，不是配置 */
    cloud: { apiBase: '', token: '', autoPush: false, lastPush: 0, qCleanedAt: 0 },
    /** 'auto' 跟随系统 | 'light' | 'dark' */
    theme: 'auto',
    ai: {
      /** 提取槽：把截图转成 LaTeX，必须是视觉模型 */
      extract: { baseURL: 'http://127.0.0.1:11434/v1', apiKey: '', model: '', verifiedAt: 0 },
      /** 分析槽：吃 LaTeX 文本产出考点/难度/章节，纯文本模型即可 */
      analyze: { baseURL: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat', verifiedAt: 0 },
      autoExtract: false,
      autoAnalyze: false,
      /** 提取引擎：目前只有视觉模型；以后接 PaddleOCR 再加 */
      engine: 'vision',
      concurrency: 1,
      timeoutMs: 180000
    }
  }
}

export const emptyFilters = () => ({
  reasons: [], diff: [], mastery: [], star: false, kind: '',
  noAnswer: false,
  /** 有截图但还没提取出文字 */
  noText: false,
  /** 有文字但还没分析过考点 */
  noAI: false
})

export const emptyLatex = () => ({ q: '', a: '', x: '' })

export const emptyAI = () => ({
  extractedAt: 0, extractModel: '',
  analyzedAt: 0, analyzeModel: '',
  topics: [], chapterId: null,
  difficulty: 0, difficultyReason: '',
  summary: '',
  confidence: 0, error: null
})

export const S = {
  books: [], chapters: [], problems: [],
  bookId: null, chapterId: null, problemId: null,
  view: 'list',
  q: '', sort: 'new', size: 'md', scope: 'book',
  f: emptyFilters(),
  settings: defaultSettings(),
  armedSlot: 'q',
  lastBackup: 0
}

/**
 * 当前题目里被手动展开的区块（'a' | 'x' | 'note'）。
 * 每次打开一道题都会清空 —— 重做时不该一进来就看见答案。
 * 只存内存，不写进数据库。
 */
export const openSecs = new Set()

/** 截图折叠区的展开状态，键是槽位 key。同样只存内存 */
export const openShots = new Set()

/**
 * 与 AI 的对话记录，键是题目 id。
 * **刻意不落库**：对话是理解题目的过程，不是笔记本身；
 * 真正有价值的结论应该由你手动写进批注。
 * 全存下来只会让题目记录和每一份备份快照无谓地膨胀。
 */
export const chatLog = new Map()

/* ---------- 记录迁移：补齐新版字段，让旧备份也能导入 ---------- */

export function migrateProblem (p) {
  if (!p.latex || typeof p.latex !== 'object') p.latex = emptyLatex()
  if (!p.ai || typeof p.ai !== 'object') p.ai = emptyAI()
  else p.ai = { ...emptyAI(), ...p.ai }
  delete p.chat // 早期版本把对话存进过题目记录，清掉
  if (!p.deletedAt) p.deletedAt = 0
  if (!Array.isArray(p.reasons)) p.reasons = []
  if (!Array.isArray(p.topics)) p.topics = []
  if (!Array.isArray(p.images)) p.images = []
  if (!p.updatedAt) p.updatedAt = p.createdAt || Date.now()
  delete p._open // 旧版把展开状态误存进了库里
  return p
}

export function migrateChapter (c) {
  if (!c.deletedAt) c.deletedAt = 0
  if (!c.updatedAt) c.updatedAt = c.createdAt || Date.now()
  return c
}

export function migrateBook (b) {
  if (!b.deletedAt) b.deletedAt = 0
  if (!b.updatedAt) b.updatedAt = b.createdAt || Date.now()
  if (!b.seq) b.seq = 0
  return b
}

/** 设置项深合并：旧配置缺 ai 段时用默认值补齐 */
export function mergeSettings (saved) {
  const d = defaultSettings()
  if (!saved) return d
  return {
    ...d,
    ...saved,
    backup: { ...d.backup, ...(saved.backup || {}) },
    cloud: { ...d.cloud, ...(saved.cloud || {}) },
    ai: {
      ...d.ai,
      ...(saved.ai || {}),
      extract: { ...d.ai.extract, ...(saved.ai?.extract || {}) },
      analyze: { ...d.ai.analyze, ...(saved.ai?.analyze || {}) }
    }
  }
}
