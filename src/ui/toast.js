import { $, esc } from '../core/dom.js'

let timer

/** 底部一句话提示。extra 会以强调色显示在后面 */
export function toast (msg, extra) {
  clearTimeout(timer)
  $('.toast')?.remove()
  const d = document.createElement('div')
  d.className = 'toast'
  d.innerHTML = esc(msg) + (extra ? ' <span class="u">' + esc(extra) + '</span>' : '')
  document.body.appendChild(d)
  timer = setTimeout(() => d.remove(), 2200)
}
