/**
 * AI 请求代理（主进程）。
 *
 * 放在主进程的两个理由：
 *   1. 无 CORS —— DeepSeek 等厂商不发 CORS 头，渲染进程直连必然失败
 *   2. API key 不必出现在渲染进程
 *
 * 协议统一用 OpenAI 兼容的 /chat/completions，
 * Ollama（/v1）、DeepSeek、硅基流动、OpenRouter、Groq、智谱、Kimi 都能直接用。
 */
const controllers = new Map()

const joinURL = (base, path) => String(base || '').replace(/\/+$/, '') + path

/** 把底层网络错误翻译成用户看得懂的话 */
function describe (e, baseURL) {
  const msg = String(e?.message || e)
  if (e?.name === 'AbortError') return '请求超时或已取消'
  if (/ECONNREFUSED|fetch failed/i.test(msg)) {
    return `连不上 ${baseURL} —— 本地模型请确认 Ollama 已启动；在线服务请检查网络与地址`
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return `域名解析失败：${baseURL}`
  if (/CERT_|SELF_SIGNED/i.test(msg)) return '证书校验失败，检查代理设置'
  return msg
}

async function readError (res) {
  let body = ''
  try { body = (await res.text()).slice(0, 400) } catch (_) {}
  if (res.status === 401 || res.status === 403) return `鉴权失败（${res.status}），检查 API Key`
  if (res.status === 404) return `接口不存在（404），检查 baseURL 是否带 /v1：${body}`
  if (res.status === 429) return '请求过于频繁或额度用尽（429）'
  return `HTTP ${res.status} ${body}`
}

async function chat (evt, opts) {
  const { id, baseURL, apiKey, model, messages, stream, jsonMode, timeoutMs } = opts
  if (!model) return { ok: false, error: '还没有选择模型' }

  const ac = new AbortController()
  if (id) controllers.set(id, ac)
  const timer = setTimeout(() => ac.abort(), timeoutMs || 180000)

  try {
    const res = await fetch(joinURL(baseURL, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {})
      },
      body: JSON.stringify({
        model,
        messages,
        stream: !!stream,
        temperature: opts.temperature ?? 0.2,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
      }),
      signal: ac.signal
    })

    if (!res.ok) return { ok: false, error: await readError(res) }

    if (!stream) {
      const j = await res.json()
      return {
        ok: true,
        text: j.choices?.[0]?.message?.content ?? '',
        usage: j.usage || null
      }
    }

    // SSE 流式：边收边往渲染进程推
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
          const j = JSON.parse(data)
          const d = j.choices?.[0]?.delta?.content
          if (d) { text += d; evt.sender.send('ai:chunk:' + id, d) }
        } catch (_) { /* 跳过不完整的分片 */ }
      }
    }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: describe(e, baseURL) }
  } finally {
    clearTimeout(timer)
    if (id) controllers.delete(id)
  }
}

async function models (_evt, { baseURL, apiKey }) {
  try {
    const res = await fetch(joinURL(baseURL, '/models'), {
      headers: apiKey ? { Authorization: 'Bearer ' + apiKey } : {},
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return { ok: false, error: await readError(res) }
    const j = await res.json()
    const list = (j.data || j.models || [])
      .map(m => (typeof m === 'string' ? m : m.id || m.name))
      .filter(Boolean)
      .sort()
    return { ok: true, models: list }
  } catch (e) {
    return { ok: false, error: describe(e, baseURL) }
  }
}

function abort (_evt, id) {
  controllers.get(id)?.abort()
  controllers.delete(id)
  return true
}

function registerAI (ipcMain) {
  ipcMain.handle('ai:chat', chat)
  ipcMain.handle('ai:models', models)
  ipcMain.handle('ai:abort', abort)
}

module.exports = { registerAI }
