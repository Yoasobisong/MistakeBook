/**
 * OpenAI 兼容的聊天客户端。
 *
 * 只实现这一个协议就够了：Ollama 提供 /v1、DeepSeek 原生兼容，
 * 硅基流动 / OpenRouter / Groq / 智谱 / Kimi 也都兼容。
 * 换服务商只要改 baseURL + apiKey + model 三个字段，代码一行不动。
 *
 * Electron 下请求转到主进程（无 CORS、key 不进渲染进程）；
 * 浏览器下降级为直连 —— 方便 npm run dev 时快速调本地 Ollama
 * （需要给 Ollama 设 OLLAMA_ORIGINS=*）。
 */
import { uid } from '../core/dom.js'
import { S } from '../core/state.js'
import { slotCfg } from './config.js'

const joinURL = (base, path) => String(base || '').replace(/\/+$/, '') + path

/* ---------- 浏览器直连（降级路径） ---------- */

function describeBrowserError (e, baseURL) {
  const msg = String(e?.message || e)
  if (e?.name === 'AbortError') return '请求超时或已取消'
  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return `连不上 ${baseURL}。浏览器模式下会受 CORS 限制：` +
      'Ollama 需设置 OLLAMA_ORIGINS=*；DeepSeek 等云端服务不发 CORS 头，必须在 Electron 版里用。'
  }
  return msg
}

async function browserChat (o, onChunk) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), o.timeoutMs || 180000)
  try {
    const res = await fetch(joinURL(o.baseURL, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(o.apiKey ? { Authorization: 'Bearer ' + o.apiKey } : {})
      },
      body: JSON.stringify({
        model: o.model,
        messages: o.messages,
        stream: !!onChunk,
        temperature: o.temperature ?? 0.2,
        ...(o.jsonMode ? { response_format: { type: 'json_object' } } : {})
      }),
      signal: ac.signal
    })
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 400)
      return { ok: false, error: `HTTP ${res.status} ${body}` }
    }

    if (!onChunk) {
      const j = await res.json()
      return { ok: true, text: j.choices?.[0]?.message?.content ?? '', usage: j.usage || null }
    }

    let text = ''
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        const s = line.trim()
        if (!s.startsWith('data:')) continue
        const data = s.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const d = JSON.parse(data).choices?.[0]?.delta?.content
          if (d) { text += d; onChunk(d) }
        } catch (_) {}
      }
    }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: describeBrowserError(e, o.baseURL) }
  } finally {
    clearTimeout(timer)
  }
}

async function browserModels (o) {
  try {
    const res = await fetch(joinURL(o.baseURL, '/models'), {
      headers: o.apiKey ? { Authorization: 'Bearer ' + o.apiKey } : {},
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const j = await res.json()
    const list = (j.data || j.models || [])
      .map(m => (typeof m === 'string' ? m : m.id || m.name))
      .filter(Boolean).sort()
    return { ok: true, models: list }
  } catch (e) {
    return { ok: false, error: describeBrowserError(e, o.baseURL) }
  }
}

/* ---------- 对外接口 ---------- */

/**
 * @param slot 'extract' | 'analyze'
 * @param messages OpenAI 格式的消息数组
 * @param opts {id, json, onChunk, model, temperature}
 * @returns {ok, text, usage} | {ok:false, error}
 */
export function chat (slot, messages, opts = {}) {
  const cfg = slotCfg(slot)
  if (!cfg) return Promise.resolve({ ok: false, error: '未知的模型槽：' + slot })

  const payload = {
    id: opts.id || uid(),
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    model: opts.model || cfg.model,
    messages,
    jsonMode: !!opts.json,
    temperature: opts.temperature,
    timeoutMs: S.settings.ai.timeoutMs
  }

  return window.native?.ai
    ? window.native.ai.chat(payload, opts.onChunk)
    : browserChat(payload, opts.onChunk)
}

export function listModels (slot, override) {
  const cfg = { ...slotCfg(slot), ...(override || {}) }
  const payload = { baseURL: cfg.baseURL, apiKey: cfg.apiKey }
  return window.native?.ai ? window.native.ai.models(payload) : browserModels(payload)
}

export function abort (id) {
  if (window.native?.ai) window.native.ai.abort(id)
}

/** 用最短的一次真实请求验证配置是否可用 */
export async function testConnection (slot, override) {
  const cfg = { ...slotCfg(slot), ...(override || {}) }
  if (!cfg.baseURL) return { ok: false, error: '还没填 baseURL' }
  if (!cfg.model) return { ok: false, error: '还没选模型' }

  const payload = {
    id: uid(),
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    model: cfg.model,
    messages: [{ role: 'user', content: '用一句话确认你在线，不要多余内容。' }],
    timeoutMs: 60000
  }
  const r = window.native?.ai ? await window.native.ai.chat(payload) : await browserChat(payload)
  if (!r.ok) return r
  return { ok: true, text: (r.text || '').trim().slice(0, 120) || '（模型返回了空内容）' }
}

/**
 * 剥掉模型自作主张加的代码围栏。
 *
 * 提示词里写了「不要加围栏」，但小模型经常照加不误，把整段输出裹进 ```markdown。
 * 只在**整段内容就是一个围栏**时才剥 —— 正文中间真正的代码块必须保留。
 */
export function stripFence (text) {
  const t = String(text || '').trim()
  if (!t.startsWith('```')) return t

  const m = t.match(/^```[a-zA-Z0-9+-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/)
  if (m) return m[1].trim()

  // 输出被截断，只剩开头那道围栏
  const nl = t.indexOf('\n')
  return nl < 0 ? t : t.slice(nl + 1).replace(/```\s*$/, '').trim()
}

/* ---------- 视觉模型的定位坐标 ---------- */

/**
 * 剥掉视觉模型吐出来的包围盒坐标。
 *
 * Qwen-VL / InternVL / MiniCPM-V 这类模型带 grounding 能力，转录时经常
 * 顺手把文字块在图上的位置也报出来 —— 正文前面多出一行 (1,0),(249,35)
 * （归一化到 0-1000 的左上角、右下角）。严重时整段输出退化成只有坐标、
 * 一个字都没有：模型把任务当成了版面检测。
 *
 * 提示词里禁止过一遍，但这是模型的训练格式，光靠提示词按不住，所以出库前再剥一道。
 *
 * 剥的两种形态：
 *   `<box>`/`<|box_start|>` 包着的 —— 连内容一起删，标签本身就是铁证；
 *   行首裸露的坐标串 —— 只在**行首**且**连着两个以上**时才算，
 *     单个 (1,0) 更可能是题目里真正的坐标点。
 * `<ref>` 裹的是正文，只删标签、留内容。
 */
const BOX_WRAPPED_RE = /<\|?box(?:_start)?\|?>[\s\S]*?<\/?\|?box(?:_end)?\|?>/g
const BOX_TAG_RE = /<\/?\|?(?:box|ref|quad|point)(?:_start|_end)?\|?>/g
const BOX_LINE_RE = /^[ \t]*(?:\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)[ \t]*,?[ \t]*){2,}/gm

export function stripBoxes (text) {
  return String(text || '')
    .replace(BOX_WRAPPED_RE, '')
    .replace(BOX_TAG_RE, '')
    .replace(BOX_LINE_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ---------- JSON 容错解析 ---------- */

/** 从位置 i 开始扫一段配对的括号，正确跳过字符串里的括号与转义 */
function balanced (s, open, close) {
  const start = s.indexOf(open)
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let escaped = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

/**
 * 模型经常把 JSON 包在 ``` 围栏里，或者前后再加两句解释。
 * 依次尝试：直接解析 → 剥围栏 → 抓第一段配对的 {} 或 []。
 */
export function parseJSON (text) {
  if (!text || !text.trim()) throw new Error('模型返回了空内容')
  let s = text.trim()

  try { return JSON.parse(s) } catch (_) {}

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) {
    s = fence[1].trim()
    try { return JSON.parse(s) } catch (_) {}
  }

  for (const [o, c] of [['{', '}'], ['[', ']']]) {
    const seg = balanced(s, o, c)
    if (seg) {
      try { return JSON.parse(seg) } catch (_) {}
    }
  }

  throw new Error('模型没有返回合法 JSON：' + s.slice(0, 150))
}

/**
 * 要求 JSON 输出的对话。解析失败时补一轮纠正提示重试一次 ——
 * 小模型偶尔会带上解释文字，重试一次基本都能救回来。
 */
export async function chatJSON (slot, messages, opts = {}) {
  const first = await chat(slot, messages, { ...opts, json: true })
  if (!first.ok) return first

  try {
    return { ok: true, data: parseJSON(first.text), raw: first.text, usage: first.usage }
  } catch (e) {
    const retry = await chat(slot, [
      ...messages,
      { role: 'assistant', content: first.text },
      { role: 'user', content: '你的回复不是合法 JSON。请只输出 JSON 本身，不要任何解释文字、不要 Markdown 代码围栏。' }
    ], { ...opts, json: true })

    if (!retry.ok) return retry
    try {
      return { ok: true, data: parseJSON(retry.text), raw: retry.text, usage: retry.usage }
    } catch (e2) {
      return { ok: false, error: e2.message }
    }
  }
}
