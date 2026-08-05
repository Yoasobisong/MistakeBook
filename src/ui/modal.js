import { $, esc } from '../core/dom.js'

export function closeLayer () { $('#layer').innerHTML = '' }

/**
 * 通用弹窗，返回 Promise：确定 → onOk 的返回值（无 onOk 则 true），取消 → null。
 *
 * @param onOk    (wrap) => value        点确定时从 DOM 里取值，返回 falsy 也会关闭
 * @param onClick (target, wrap, done)   弹窗内部自定义交互；返回 true 表示已处理，跳过默认逻辑
 * @param noEnter 多输入框的表单要打开它，否则打字时顺手回车会直接关窗
 */
export function modal ({ title, body, okText = '确定', cancelText = '取消', wide, onOk, onClick, danger, noEnter }) {
  return new Promise(res => {
    const wrap = document.createElement('div')
    wrap.className = 'mask'
    wrap.innerHTML = `<div class="modal${wide ? ' wide' : ''}">
      <div class="modal-h"><b>${esc(title)}</b><div class="spacer"></div>
        <button class="btn icon ghost" data-x>✕</button></div>
      <div class="modal-b">${body}</div>
      <div class="modal-f">
        ${cancelText ? `<button class="btn" data-x>${esc(cancelText)}</button>` : ''}
        ${okText ? `<button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okText)}</button>` : ''}
      </div></div>`

    $('#layer').appendChild(wrap)
    let settled = false
    const done = v => { if (settled) return; settled = true; wrap.remove(); res(v) }

    wrap.addEventListener('click', e => {
      if (onClick && onClick(e.target, wrap, done)) return
      if (e.target === wrap || e.target.closest('[data-x]')) done(null)
      else if (e.target.closest('[data-ok]')) done(onOk ? onOk(wrap) : true)
    })

    wrap.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !noEnter && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault()
        done(onOk ? onOk(wrap) : true)
      }
      if (e.key === 'Escape') done(null)
    })

    setTimeout(() => {
      const f = wrap.querySelector('input,textarea')
      f?.focus()
      f?.select?.()
    }, 30)
  })
}

/** 单行输入框，返回去空白后的字符串；留空则 null */
export function ask (title, val = '', ph = '') {
  return modal({
    title,
    body: `<input class="inp" data-v value="${esc(val)}" placeholder="${esc(ph)}">`,
    onOk: w => w.querySelector('[data-v]').value.trim() || null
  })
}

/** 危险操作确认。text 允许含 HTML（调用方负责转义变量部分） */
export function confirmBox (title, text, okText = '删除') {
  return modal({
    title,
    body: `<div style="font-size:13.5px;line-height:1.8;color:var(--ink2)">${text}</div>`,
    okText,
    danger: true
  })
}
