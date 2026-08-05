/** 设置弹窗里的「AI」分页：两个模型槽的配置、模型列表拉取、连通性测试 */
import { esc } from '../core/dom.js'
import { S } from '../core/state.js'
import { PRESETS, SLOTS, SLOT_META, saveKey } from '../ai/config.js'
import { listModels, testConnection } from '../ai/client.js'
import { toast } from './toast.js'

const q = (wrap, sel) => wrap.querySelector(sel)

/** 每个槽的当前状态，显示在标题右边 */
function statusOf (slot) {
  const c = S.settings.ai[slot]
  if (!c.baseURL || !c.model) return { k: 'none', t: '未配置' }
  if (c.verifiedAt) return { k: 'ok', t: '已连通' }
  return { k: 'unk', t: '未测试' }
}

/** 用输入框里的实时值判断，而不是已保存的值 —— 用户刚改完还没点完成 */
function paintStatus (slot, wrap) {
  const el = wrap.querySelector(`[data-st="${slot}"]`)
  if (!el) return
  const live = liveCfg(slot, wrap)
  const saved = S.settings.ai[slot]
  const changed = live && (live.baseURL !== saved.baseURL || live.model !== saved.model)

  const s = !live || !live.baseURL || !live.model
    ? { k: 'none', t: '未配置' }
    : (saved.verifiedAt && !changed)
        ? { k: 'ok', t: '已连通' }
        : { k: 'unk', t: '未测试' }

  el.className = 'st ' + s.k
  el.textContent = s.t
}

function slotHTML (slot) {
  const m = SLOT_META[slot]
  const c = S.settings.ai[slot]
  const s = statusOf(slot)
  return `
  <div class="slotcfg" data-slot="${slot}">
    <div class="hd">
      <b>${m.name}槽</b>
      ${m.vision ? '<span class="badge vis">需要视觉能力</span>' : '<span class="badge">纯文本即可</span>'}
      <div class="spacer"></div>
      <span class="st ${s.k}" data-st="${slot}">${s.t}</span>
    </div>
    <div class="desc">${m.desc}</div>

    <div class="presets">
      ${PRESETS.map((p, i) => `<button data-preset="${i}" data-for="${slot}">${esc(p.t)}</button>`).join('')}
    </div>

    <div class="row">
      <div>
        <label class="fld">接口地址（baseURL）</label>
        <input class="inp" data-f="baseURL" value="${esc(c.baseURL || '')}" placeholder="http://127.0.0.1:11434/v1">
      </div>
      <div class="narrow">
        <label class="fld">API Key</label>
        <input class="inp" data-f="apiKey" type="password" value="${esc(c.apiKey || '')}" placeholder="本地模型可留空">
      </div>
    </div>

    <div class="row">
      <div>
        <label class="fld">模型</label>
        <input class="inp" data-f="model" value="${esc(c.model || '')}" placeholder="点右边「拉取列表」，或直接手填">
      </div>
      <button class="btn" data-pull="${slot}">拉取列表</button>
      <button class="btn" data-test="${slot}">测试连接</button>
    </div>

    <div class="modellist" data-list="${slot}"></div>
    <div class="testres wait hidden" data-res="${slot}"></div>
  </div>`
}

export function aiPaneHTML (safeKeys) {
  const ai = S.settings.ai
  return `
  <div style="font-size:13px;color:var(--ink2)">
    <div style="font-size:12px;color:var(--ink3);line-height:1.8;margin-bottom:12px">
      截图 → <b>提取槽</b>转成 LaTeX 文本 → <b>分析槽</b>读文本产出考点与难度。<br>
      两个槽可以是同一个模型，也可以混搭；本地视觉模型做提取 + DeepSeek 做分析是推荐配置。
    </div>

    ${SLOTS.map(slotHTML).join('')}

    <div class="sep"></div>
    <div class="row" style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap">
      <div style="flex:0 0 120px">
        <label class="fld">并发数</label>
        <input class="inp" id="aiConc" type="number" min="1" max="8" value="${ai.concurrency}">
      </div>
      <div style="flex:0 0 140px">
        <label class="fld">超时（秒）</label>
        <input class="inp" id="aiTimeout" type="number" min="30" max="1200" value="${Math.round(ai.timeoutMs / 1000)}">
      </div>
      <div style="flex:1;min-width:200px;font-size:11.5px;color:var(--ink3);line-height:1.7">
        本地模型建议并发保持 1 —— 并发跑视觉模型容易把显存打爆。
      </div>
    </div>

    <div style="margin-top:10px;font-size:12.5px;line-height:2">
      <label style="display:block"><input type="checkbox" id="aiAutoEx" ${ai.autoExtract ? 'checked' : ''}> 粘贴截图后自动排队提取 LaTeX</label>
      <label style="display:block"><input type="checkbox" id="aiAutoAn" ${ai.autoAnalyze ? 'checked' : ''}> 提取完成后自动分析考点与难度</label>
    </div>

    <div style="margin-top:10px;font-size:11.5px;color:${safeKeys ? 'var(--ink3)' : 'var(--red)'};line-height:1.8">
      ${safeKeys
        ? 'API Key 已用系统加密存储（Windows DPAPI），不会写进浏览器数据库。'
        : '⚠ 当前环境没有安全存储可用，API Key 会明文存在本地数据库里。云端服务的 Key 建议在打包后的桌面版里填写。'}
    </div>
  </div>`
}

/**
 * 读取弹窗里的输入。
 * 必须同步完成 —— modal 的 onOk 返回后 DOM 就被移除了，
 * 所以这里只取值，异步的落盘交给 applyAI。
 */
export function readAI (wrap) {
  const pane = q(wrap, '[data-pane="ai"]')
  if (!pane) return null

  const slots = {}
  for (const slot of SLOTS) {
    const box = pane.querySelector(`.slotcfg[data-slot="${slot}"]`)
    if (!box) continue
    slots[slot] = {
      baseURL: box.querySelector('[data-f="baseURL"]').value.trim(),
      model: box.querySelector('[data-f="model"]').value.trim(),
      apiKey: box.querySelector('[data-f="apiKey"]').value.trim()
    }
  }

  return {
    slots,
    concurrency: +q(pane, '#aiConc').value,
    timeoutSec: +q(pane, '#aiTimeout').value,
    autoExtract: q(pane, '#aiAutoEx').checked,
    autoAnalyze: q(pane, '#aiAutoAn').checked
  }
}

/** 写回 S.settings.ai，API Key 走 safeStorage */
export async function applyAI (data) {
  if (!data) return
  for (const slot of SLOTS) {
    const v = data.slots[slot]
    if (!v) continue
    const cfg = S.settings.ai[slot]
    // 地址或模型换了，之前测通的结论就不作数了
    if (cfg.baseURL !== v.baseURL || cfg.model !== v.model) cfg.verifiedAt = 0
    cfg.baseURL = v.baseURL
    cfg.model = v.model
    await saveKey(slot, v.apiKey)
  }
  S.settings.ai.concurrency = Math.max(1, Math.min(8, data.concurrency || 1))
  S.settings.ai.timeoutMs = Math.max(30, Math.min(1200, data.timeoutSec || 180)) * 1000
  S.settings.ai.autoExtract = data.autoExtract
  S.settings.ai.autoAnalyze = data.autoAnalyze
}

/** 返回 true 表示这次点击已被 AI 分页处理 */
export function handleAIClick (target, wrap) {
  const preset = target.closest('[data-preset]')
  if (preset) {
    const p = PRESETS[+preset.dataset.preset]
    const slot = preset.dataset.for
    const box = wrap.querySelector(`.slotcfg[data-slot="${slot}"]`)
    box.querySelector('[data-f="baseURL"]').value = p.baseURL
    box.querySelector('[data-f="apiKey"]').value = p.apiKey
    if (p.model) box.querySelector('[data-f="model"]').value = p.model
    paintStatus(slot, wrap)
    return true
  }

  const use = target.closest('[data-usemodel]')
  if (use) {
    const slot = use.dataset.for
    const box = wrap.querySelector(`.slotcfg[data-slot="${slot}"]`)
    box.querySelector('[data-f="model"]').value = use.dataset.usemodel
    wrap.querySelectorAll(`[data-list="${slot}"] button`)
      .forEach(b => b.classList.toggle('on', b === use))
    paintStatus(slot, wrap)
    return true
  }

  const pull = target.closest('[data-pull]')
  if (pull) { pullModels(pull.dataset.pull, wrap); return true }

  const test = target.closest('[data-test]')
  if (test) { runTest(test.dataset.test, wrap); return true }

  return false
}

/* ---------- 拉取模型列表 / 测试连接 ---------- */

function liveCfg (slot, wrap) {
  const box = wrap.querySelector(`.slotcfg[data-slot="${slot}"]`)
  if (!box) return null
  return {
    baseURL: box.querySelector('[data-f="baseURL"]').value.trim(),
    apiKey: box.querySelector('[data-f="apiKey"]').value.trim(),
    model: box.querySelector('[data-f="model"]').value.trim()
  }
}

function setResult (slot, wrap, cls, text) {
  // 请求还在飞的时候用户可能已经关掉弹窗了
  const el = wrap.querySelector(`[data-res="${slot}"]`)
  if (!el) return
  el.className = 'testres ' + cls
  el.textContent = text
}

async function pullModels (slot, wrap) {
  const cfg = liveCfg(slot, wrap)
  if (!cfg) return
  setResult(slot, wrap, 'wait', '正在拉取模型列表…')
  const r = await listModels(slot, cfg)
  if (!r.ok) { setResult(slot, wrap, 'err', r.error); return }
  if (!r.models.length) { setResult(slot, wrap, 'err', '服务返回了空列表 —— 确认该服务已装载模型'); return }

  const box = wrap.querySelector(`[data-list="${slot}"]`)
  if (!box) return

  const current = wrap.querySelector(`.slotcfg[data-slot="${slot}"] [data-f="model"]`)?.value.trim()
  const pick = current || guessModel(slot, r.models)

  box.innerHTML = r.models.map(m =>
    `<button data-usemodel="${esc(m)}" data-for="${slot}" class="${m === pick ? 'on' : ''}">${esc(m)}</button>`
  ).join('')

  const input = wrap.querySelector(`.slotcfg[data-slot="${slot}"] [data-f="model"]`)
  if (input && !input.value) input.value = pick
  paintStatus(slot, wrap)
  setResult(slot, wrap, 'ok', `拿到 ${r.models.length} 个模型，点上面的名字即可选用，然后按「测试连接」。`)
}

/** 视觉槽优先猜视觉模型，省得用户在一长串里翻 */
function guessModel (slot, models) {
  if (slot !== 'extract') return models[0] || ''
  const vis = /vl|vision|llava|minicpm-v|moondream|internvl|qwen2\.5vl|gemma3/i
  return models.find(m => vis.test(m)) || models[0] || ''
}

async function runTest (slot, wrap) {
  const cfg = liveCfg(slot, wrap)
  if (!cfg) return
  if (!cfg.baseURL) { setResult(slot, wrap, 'err', '✕ 还没填接口地址'); return }
  if (!cfg.model) { setResult(slot, wrap, 'err', '✕ 还没选模型，先点「拉取列表」'); return }

  const name = SLOT_META[slot].name + '槽'
  const t0 = Date.now()
  setResult(slot, wrap, 'wait', '正在连接…')

  // 本地模型首次要把权重读进显存，几十秒很正常；不走秒表会以为卡死了
  const tick = setInterval(() => {
    if (!wrap.isConnected) { clearInterval(tick); return }
    const s = Math.round((Date.now() - t0) / 1000)
    setResult(slot, wrap, 'wait',
      `正在连接… ${s}s${s > 6 ? '　（本地模型首次把权重加载进显存可能要几十秒，耐心等）' : ''}`)
  }, 500)

  let r
  try {
    r = await testConnection(slot, cfg)
  } catch (e) {
    r = { ok: false, error: String(e?.message || e) }
  }
  clearInterval(tick)

  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  S.settings.ai[slot].verifiedAt = r.ok ? Date.now() : 0
  paintStatus(slot, wrap)

  if (r.ok) {
    setResult(slot, wrap, 'ok', `✓ 连通，用时 ${secs}s。模型回复：${r.text}`)
    toast(name + '连通', cfg.model)
  } else {
    setResult(slot, wrap, 'err', '✕ ' + r.error)
    toast(name + '连接失败', '看弹窗里的红色说明')
    console.error('[ai] 连接测试失败', { slot, baseURL: cfg.baseURL, model: cfg.model, error: r.error })
  }
}
