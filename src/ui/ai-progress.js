/** 顶栏的 AI 任务进度条。空闲时不占位，跑任务时才出现。 */
import { $, esc } from '../core/dom.js'
import { on } from '../core/bus.js'
import { cancelAll } from '../ai/queue.js'

function paint (st) {
  const el = $('#aiSlot')
  if (!el) return

  if (!st.busy) { el.innerHTML = ''; return }

  const pct = st.total ? Math.round(st.done / st.total * 100) : 0
  el.innerHTML = `
    <div class="aiprog">
      <span class="spin"></span>
      <span class="tx">${esc(st.label || '处理')} ${st.done}/${st.total}${
        st.failed ? ` · <b class="bad">${st.failed} 失败</b>` : ''
      }</span>
      <span class="pbar"><i style="width:${pct}%"></i></span>
      <button class="x" data-aicancel title="取消剩余任务">✕</button>
    </div>`
}

on('ai:progress', paint)

document.addEventListener('click', e => {
  if (e.target.closest('[data-aicancel]')) cancelAll()
})
