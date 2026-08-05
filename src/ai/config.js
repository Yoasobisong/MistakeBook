/**
 * 两个模型槽的配置读写。
 *
 *   extract —— 把截图转 LaTeX，必须有视觉能力（本地 Ollama 视觉模型）
 *   analyze —— 读 LaTeX 产出考点/难度/章节，纯文本模型即可（DeepSeek 更强更便宜）
 *
 * 拆成两槽是因为 DeepSeek 没有视觉；但这不是妥协——本地模型做 OCR、
 * 云端强模型做推理，本来就是效果和成本都最优的组合。
 */
import { S } from '../core/state.js'

export const SLOTS = ['extract', 'analyze']

export const SLOT_META = {
  extract: {
    name: '提取',
    vision: true,
    desc: '把题目截图转成 LaTeX 文本。必须选带视觉能力的模型，推荐本地 Ollama 的 qwen2.5vl。'
  },
  analyze: {
    name: '分析',
    vision: false,
    desc: '读提取出的文本，产出考点、难度和所属章节。纯文本模型即可，DeepSeek 性价比最高。'
  }
}

/** 常见服务商的快填预设 */
export const PRESETS = [
  { t: 'Ollama 本地', baseURL: 'http://127.0.0.1:11434/v1', apiKey: 'ollama', model: '' },
  { t: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' },
  { t: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', apiKey: '', model: '' },
  { t: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '', model: 'glm-4-flash' },
  { t: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', apiKey: '', model: '' }
]

export const slotCfg = slot => S.settings.ai[slot]

export const isConfigured = slot => {
  const c = slotCfg(slot)
  return !!(c && c.baseURL && c.model)
}

export const isLocal = slot => /127\.0\.0\.1|localhost|0\.0\.0\.0/.test(slotCfg(slot)?.baseURL || '')

/* ---------- API Key ----------
   Electron 下走主进程 safeStorage 加密存盘，内存里才有明文；
   浏览器下没有安全存储可用，只能落 IndexedDB，界面上会明确提示。 */

const keyName = slot => 'ai.' + slot + '.apiKey'

export async function loadKeys () {
  if (!window.native?.secret) return
  for (const slot of SLOTS) {
    try {
      const v = await window.native.secret.get(keyName(slot))
      if (v) S.settings.ai[slot].apiKey = v
    } catch (e) {
      console.warn('[ai] 读取 key 失败', slot, e)
    }
  }
}

export async function saveKey (slot, value) {
  S.settings.ai[slot].apiKey = value
  if (window.native?.secret) {
    await window.native.secret.set(keyName(slot), value)
  }
}

export async function keyStorageSafe () {
  if (!window.native?.secret) return false
  try { return await window.native.secret.available() } catch (_) { return false }
}
