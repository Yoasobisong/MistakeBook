/**
 * 回收站。
 *
 * 删除一直是软删除（只打 deletedAt 墓碑），但此前 UI 层完全没暴露过，
 * 数据其实都还在库里，只是找不回来。这里把它接出来。
 */
import { esc } from '../core/dom.js'
import { fmtDT } from '../core/fmt.js'
import { pad } from '../core/fmt.js'
import { S } from '../core/state.js'
import { purgeTombstones, restoreProblem, trashed } from '../storage/repo.js'
import { confirmBox, modal } from './modal.js'
import { toast } from './toast.js'
import { renderAll } from './render.js'

const bookName = id => S.books.find(b => b.id === id)?.name || '（书籍已删除）'

const label = p =>
  p.title || (p.latex?.q || '').replace(/\s+/g, ' ').trim().slice(0, 40) || '（无标题）'

function listHTML () {
  const rows = trashed()
  if (!rows.length) return '<div class="trash-empty">回收站是空的</div>'

  return rows.map(p => `<div class="trash-row" data-tid="${p.id}">
    <span class="ic">#${pad(p.no || 0)}</span>
    <span class="tt" title="${esc(bookName(p.bookId))}">${esc(label(p))}</span>
    <span class="dt">${fmtDT(p.deletedAt)}</span>
    <button class="btn sm" data-restore="${p.id}">恢复</button>
  </div>`).join('')
}

function repaint (wrap) {
  const box = wrap.querySelector('[data-trashbox]')
  if (box) box.innerHTML = listHTML()
  const n = wrap.querySelector('[data-trashcount]')
  if (n) n.textContent = trashed().length ? `${trashed().length} 项` : ''
}

export async function trashModal () {
  await modal({
    title: '回收站',
    okText: '关闭',
    cancelText: '',
    wide: true,
    noEnter: true,
    body: `
      <div style="font-size:12.5px;color:var(--ink3);line-height:1.8;margin-bottom:9px">
        删除的题目会保留在这里，截图也还在，随时可以恢复。<br>
        点「彻底清空」才会真正释放磁盘空间，该操作不可撤销。
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span class="mt-l" data-trashcount></span>
        <div style="flex:1"></div>
        <button class="btn sm danger" data-trashact="empty">彻底清空</button>
      </div>
      <div class="trash" data-trashbox>${listHTML()}</div>`,

    onClick: async (t, wrap) => {
      const r = t.closest('[data-restore]')
      if (r) {
        const p = await restoreProblem(r.dataset.restore)
        repaint(wrap)
        renderAll()
        toast('已恢复', p ? label(p) : '')
        return true
      }

      const act = t.closest('[data-trashact]')
      if (act) {
        const n = trashed().length
        if (!n) { toast('回收站已经是空的'); return true }
        const ok = await confirmBox('彻底清空回收站',
          `${n} 道题及其截图将被永久删除，无法找回。`)
        if (ok) {
          const res = await purgeTombstones(0)
          repaint(wrap)
          renderAll()
          toast('已清空', `释放 ${res.images} 张截图`)
        }
        return true
      }
      return false
    }
  })
}

/** 供设置面板显示数量 */
export const trashCount = () => trashed().length
