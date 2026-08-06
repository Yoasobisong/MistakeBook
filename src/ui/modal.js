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

    /** 默认点击行为：点遮罩 / ✕ / 取消 → null，确定 → onOk 返回值 */
    const defaultClick = e => {
      if (e.target === wrap || e.target.closest('[data-x]')) done(null)
      else if (e.target.closest('[data-ok]')) done(onOk ? onOk(wrap) : true)
    }

    wrap.addEventListener('click', e => {
      if (!onClick) { defaultClick(e); return }
      // onClick 可能是 async（如回收站），返回值是 Promise ——
      // 不能直接当 truthy 判断，否则 ✕/确定/遮罩全被吞掉，弹窗永远关不上。
      const ret = onClick(e.target, wrap, done)
      if (ret && typeof ret.then === 'function') {
        ret.then(handled => { if (!handled) defaultClick(e) })
          .catch(err => console.error('[modal] onClick', err))
        return
      }
      if (!ret) defaultClick(e)
    })

    wrap.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !noEnter && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault()
        done(onOk ? onOk(wrap) : true)
      }
      // stopPropagation:keys.js 也有全局 Escape 处理,不拦的话一次 Esc 会关掉两层弹窗
      if (e.key === 'Escape') { e.stopPropagation(); done(null) }
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
