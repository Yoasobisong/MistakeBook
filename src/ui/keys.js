/** 全局键盘快捷键 */
import { $, $$ } from '../core/dom.js'
import { S } from '../core/state.js'
import { READONLY } from '../core/env.js'
import { PROB } from '../core/selectors.js'
import { saveProblem } from '../storage/repo.js'
import { nav, openNote, renderDetail, renderSide } from './detail.js'
import { go, render } from './render.js'
import { clearSel, selectAll, selMode } from './select.js'

export function bindKeys () {
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '')

    if (e.key === 'Escape') {
      // 逐层退出：弹窗 → 批注编辑 → 批量模式 → 回列表
      const mask = $$('.mask').pop()
      if (mask) {
        const x = mask.querySelector('[data-x]')
        x ? x.click() : mask.remove()
        return
      }
      if ($('#noteEdit')) { $('#noteEdit').blur(); return }
      if (selMode()) { clearSel(); return }
      if (S.view !== 'list') { go('list'); render('list') }
      return
    }

    if (typing) return

    // 批量模式下 Ctrl+A 全选当前列表
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && selMode()) {
      e.preventDefault()
      selectAll()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return

    if (e.key === '/') { e.preventDefault(); $('#q').focus(); $('#q').select(); return }
    // 只读版：新建、改难度、星标、写批注这些写操作快捷键全部禁用
    if (READONLY) {
      if (S.view === 'detail') {
        if (e.key === 'ArrowLeft') { nav(-1) } else if (e.key === 'ArrowRight') { nav(1) }
      }
      return
    }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); $('#btnNew').click(); return }

    if (S.view !== 'detail') return
    const p = PROB()
    if (!p) return

    if (/^[1-5]$/.test(e.key)) {
      p.difficulty = +e.key
      saveProblem(p).then(() => { renderSide(); render('list') })
    } else if (e.key === 's' || e.key === 'S') {
      p.starred = !p.starred
      saveProblem(p).then(() => { renderDetail(); render('list') })
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault()
      openNote()
    } else if (e.key === 'ArrowLeft') {
      nav(-1)
    } else if (e.key === 'ArrowRight') {
      nav(1)
    }
  })
}
