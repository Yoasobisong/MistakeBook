import { $, clamp } from '../core/dom.js'
import { PROB } from '../core/selectors.js'
import { imgURL, polarityOf } from '../storage/images.js'

/** 全屏看图：缩放 + 左右翻当前题的所有图 */
export function lightbox (imgId) {
  const p = PROB()
  const list = p ? p.images.map(i => i.id) : [imgId]
  let ix = Math.max(0, list.indexOf(imgId))
  let zoom = 1

  const el = document.createElement('div')
  el.className = 'lightbox'
  el.innerHTML = `<div class="lightbox-bar">
      <span class="mono" id="lbN"></span><div class="spacer"></div>
      <button class="btn sm" data-z="-">－</button><button class="btn sm" data-z="0">适应</button>
      <button class="btn sm" data-z="+">＋</button>
      <button class="btn sm" data-nav="-1">上一张</button><button class="btn sm" data-nav="1">下一张</button>
      <button class="btn sm" data-close>关闭 Esc</button></div>
    <div class="lightbox-stage"><img id="lbImg" alt=""></div>`
  document.body.appendChild(el)

  const im = $('#lbImg', el)
  const show = async () => {
    im.src = await imgURL(list[ix], 'full')
    im.className = 'pol-' + polarityOf(list[ix])
    im.style.width = (zoom * 100) + '%'
    $('#lbN', el).textContent = (ix + 1) + ' / ' + list.length
  }
  show()

  const close = () => { el.remove(); document.removeEventListener('keydown', key) }

  el.addEventListener('click', e => {
    const z = e.target.closest('[data-z]')
    const n = e.target.closest('[data-nav]')
    if (e.target.closest('[data-close]') || e.target === el || e.target.classList.contains('lightbox-stage')) {
      return close()
    }
    if (z) {
      const v = z.dataset.z
      zoom = v === '0' ? 1 : clamp(zoom + (v === '+' ? 0.25 : -0.25), 0.25, 4)
      im.style.width = (zoom * 100) + '%'
    }
    if (n) { ix = (ix + +n.dataset.nav + list.length) % list.length; zoom = 1; show() }
  })

  const key = e => {
    if (e.key === 'Escape') close()
    if (e.key === 'ArrowRight') { ix = (ix + 1) % list.length; show() }
    if (e.key === 'ArrowLeft') { ix = (ix - 1 + list.length) % list.length; show() }
  }
  document.addEventListener('keydown', key)
}
