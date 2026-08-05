/** DOM 查询与通用小工具 */

export const $ = (s, r) => (r || document).querySelector(s)
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s))

/** HTML 转义 —— 所有插入 innerHTML 的用户数据都必须过这一层 */
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]))

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export const debounce = (fn, ms) => {
  let t
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}

/** 等待一组 <img> 全部 load 或 error（打印前用） */
export const waitImages = imgs =>
  Promise.all(imgs.map(im => im.complete ? Promise.resolve() : new Promise(r => { im.onload = im.onerror = r })))
