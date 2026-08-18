/** 全局键盘快捷键 */
import { $, $$, esc } from '../core/dom.js'
import { S } from '../core/state.js'
import { READONLY } from '../core/env.js'
import { MASTERY } from '../core/consts.js'
import { PROB } from '../core/selectors.js'
import { saveProblem } from '../storage/repo.js'
import { nav, noteStep, renderDetail, renderSide, toggleSlot } from './detail.js'
import { go, render } from './render.js'
import { toast } from './toast.js'
import { clearSel, selectAll, selMode } from './select.js'

/** Z X C → 未掌握 / 半懂 / 已掌握 */
const MASTERY_KEYS = { z: 0, x: 1, c: 2 }

/* ============================================================
   说明表 —— 设置弹窗的「快捷键」页由它渲染
   ============================================================ */

/**
 * 刻意和 bindKeys() 放在同一个文件里。
 *
 * 之前这份说明散在 settings.js 的一段等宽小字里，加了键忘了改，
 * 结果写着「E 写批注」而 E 早就变成两段式了。放在一起才不容易过期。
 *
 * web:true 表示网页只读版也能用 —— 那边没有任何写操作，
 * 列出「N 新建空白题」只会让人白按一场。
 * webT 是只读版下的替代说明（同一个键，两边行为略有差别）。
 */
const HELP = [
  {
    g: '全局',
    rows: [
      { k: ['Ctrl+V'], t: '粘贴截图直接建题；多张图会问「每张一题 / 合并一题」' },
      { k: ['/'], t: '跳到搜索框并全选', web: true },
      { k: ['N'], t: '新建一道空白题' },
      { k: ['Esc'], t: '逐层退出：弹窗 → 批注编辑 → 批量模式 → 回列表', web: true }
    ]
  },
  {
    g: '详情页',
    rows: [
      { k: ['←', '→'], t: '上一题 / 下一题', web: true },
      { k: ['A'], t: '展开 / 收起答案解析 —— 先出原始截图，文字版折在下面', web: true },
      {
        k: ['E'],
        t: '展开批注；已经展开时再按一次进入编辑',
        web: true,
        webT: '展开批注（只读版不能编辑）'
      },
      { k: ['1 – 5'], t: '设难度' },
      { k: ['Z', 'X', 'C'], t: '设掌握度：未掌握 / 半懂 / 已掌握（左手标记，右手 ←/→ 翻页）' },
      { k: ['S'], t: '加 / 去星标' }
    ]
  },
  {
    g: '鼠标',
    rows: [
      { k: ['Shift+点击'], t: '批量模式下，从上一个选中项到当前项整段选上' },
      { k: ['拖拽'], t: '把卡片拖到左栏章节上，直接归类' },
      { k: ['Ctrl+滚轮'], t: '放大 / 缩小正文，70% – 200%', web: true }
    ]
  },
  {
    g: '批量选择',
    rows: [
      { k: ['Ctrl+A'], t: '全选当前筛选结果，再按一次清空' }
    ]
  },
  {
    g: '正文缩放',
    rows: [
      { k: ['Ctrl++', 'Ctrl+-'], t: '放大 / 缩小，不用鼠标', web: true },
      { k: ['Ctrl+0'], t: '复位到 100%', web: true }
    ]
  },
  {
    g: '编辑与输入',
    rows: [
      { k: ['Esc'], t: '保存并退出批注 / LaTeX 编辑器' },
      { k: ['Ctrl+Enter'], t: '保存批注，和 Esc 等价' },
      { k: ['Enter'], t: 'AI 对话发送' },
      { k: ['Shift+Enter'], t: 'AI 对话换行' },
      { k: ['Enter'], t: '弹窗确认（设置弹窗除外，那里输入框太多）' }
    ]
  }
]

/** 'Ctrl+V' → <kbd>Ctrl</kbd>+<kbd>V</kbd> */
const chordHTML = c =>
  c.split('+').map(x => `<kbd>${esc(x)}</kbd>`).join('<span class="kh-p">+</span>')

export function keysPaneHTML () {
  return HELP.map(g => {
    const rows = g.rows.filter(r => !READONLY || r.web)
    if (!rows.length) return ''
    return `<div class="kh-g">${esc(g.g)}</div>
      <table class="kh"><tbody>${rows.map(r => `<tr>
        <td class="kh-k">${r.k.map(chordHTML).join('<span class="kh-p">/</span>')}</td>
        <td class="kh-t">${esc((READONLY && r.webT) || r.t)}</td>
      </tr>`).join('')}</tbody></table>`
  }).join('')
}

/* ============================================================
   绑定
   ============================================================ */

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
    // 只读版：新建、改难度、星标这些写操作快捷键全部禁用。
    // 但翻页、看答案、展开批注都是纯读，手机上重做完想看答案正是这个场景
    if (READONLY) {
      if (S.view === 'detail') {
        if (e.key === 'ArrowLeft') nav(-1)
        else if (e.key === 'ArrowRight') nav(1)
        else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); toggleSlot('a') }
        else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); noteStep() }
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
    } else if (e.key === 'a' || e.key === 'A') {
      e.preventDefault()
      toggleSlot('a')
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault()
      noteStep()
    } else if (/^[zxc]$/i.test(e.key)) {
      // 三档掌握度。放在左手下、和右手的 ←/→ 分工 ——
      // 复习就是「翻页 → 判断 → 标记」的循环，双手各管一半才不用来回抬手。
      // 数字键被难度占了，只能另找三个相邻键
      e.preventDefault()
      p.mastery = MASTERY_KEYS[e.key.toLowerCase()]
      saveProblem(p).then(() => {
        renderSide()
        // 掌握度同时是左栏的筛选项
        render('list', 'filters')
      })
      toast('掌握度 · ' + (MASTERY[p.mastery] || MASTERY[0]).t)
    } else if (e.key === 'ArrowLeft') {
      nav(-1)
    } else if (e.key === 'ArrowRight') {
      nav(1)
    }
  })
}
