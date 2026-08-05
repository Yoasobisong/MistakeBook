import { $$ } from '../core/dom.js'

/** 锚定在某个元素下方的下拉菜单。onClick 收到 (action, id, event) */
export function popover (anchor, html, onClick) {
  closePop()
  const p = document.createElement('div')
  p.className = 'pop'
  p.innerHTML = html
  document.body.appendChild(p)

  const r = anchor.getBoundingClientRect()
  p.style.top = (r.bottom + 6) + 'px'
  p.style.left = Math.min(r.left, innerWidth - p.offsetWidth - 12) + 'px'
  if (r.bottom + p.offsetHeight + 16 > innerHeight) {
    p.style.maxHeight = (innerHeight - r.bottom - 24) + 'px'
  }

  p.addEventListener('click', e => {
    const it = e.target.closest('[data-a]')
    if (it) onClick(it.dataset.a, it.dataset.id, e)
  })

  // 延后一拍再挂，否则触发本次 popover 的那次点击会立刻把它关掉
  setTimeout(() => document.addEventListener('mousedown', popAway), 0)
  return p
}

function popAway (e) {
  if (!e.target.closest('.pop')) closePop()
}

export function closePop () {
  $$('.pop').forEach(p => p.remove())
  document.removeEventListener('mousedown', popAway)
}
