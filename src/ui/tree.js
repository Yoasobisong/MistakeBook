/** 左栏大纲树：章节的展示、增删改、层级调整 */
import { $, esc } from '../core/dom.js'
import { on } from '../core/bus.js'
import { S } from '../core/state.js'
import {
  allChapters, allProblems, bookProblems, chOf, chTree,
  countIn, descendants, findChapter, hasKids
} from '../core/selectors.js'
import { createChapter, deleteChapter, normalizeOrders, saveChapter, saveChapters } from '../storage/repo.js'
import { popover, closePop } from './popover.js'
import { ask, confirmBox } from './modal.js'
import { toast } from './toast.js'
import { render } from './render.js'

export function renderTree () {
  const box = $('#tree')
  if (!S.bookId) { box.innerHTML = ''; return }

  const ps = bookProblems()
  const total = ps.length
  const un = ps.filter(p => !p.chapterId).length

  let h = `<div class="node ${S.chapterId === null ? 'on' : ''}" data-cid="" data-all="1">
      <span class="tw leaf"></span><span class="tt">全部题目</span><span class="cnt">${total}</span></div>`

  // 折叠：父节点收起时，把它的后代一并跳过
  const hidden = new Set()
  for (const { c, depth } of chTree(S.bookId)) {
    if (c.parentId && hidden.has(c.parentId)) { hidden.add(c.id); continue }
    const kids = hasKids(c.id)
    if (c.collapsed && kids) hidden.add(c.id)
    h += `<div class="node ${S.chapterId === c.id ? 'on' : ''}" data-cid="${c.id}" data-depth="${Math.min(depth, 2)}">
      <span class="tw ${kids ? '' : 'leaf'}" data-tw>${kids ? (c.collapsed ? '▸' : '▾') : '·'}</span>
      <span class="tt" title="${esc(c.title)}">${esc(c.title)}</span>
      <span class="cnt">${countIn(c.id) || ''}</span>
      <span class="row-act">
        <button class="btn" data-ch="add" title="新建子章节">＋</button>
        <button class="btn" data-ch="menu" title="更多">⋯</button>
      </span></div>`
  }

  if (un) {
    h += `<div class="node ${S.chapterId === '' ? 'on' : ''}" data-cid="" data-un="1" style="margin-top:2px">
      <span class="tw leaf"></span><span class="tt" style="color:var(--ink3)">未归类</span><span class="cnt">${un}</span></div>`
  }

  box.innerHTML = h
}

export async function addChapter (parentId) {
  if (!S.bookId) { toast('先建一本书'); return }
  const t = await ask(parentId ? '新建子章节' : '新建章节', '', '例如：第三章 导数与微分')
  if (!t) return

  await createChapter(S.bookId, parentId, t)
  if (parentId) {
    const p = findChapter(parentId)
    if (p?.collapsed) { p.collapsed = false; await saveChapter(p) }
  }
  renderTree()
  toast('已添加章节')
}

export function chapterMenu (anchor, cid) {
  popover(anchor, `
    <button class="pop-i" data-a="ren">重命名</button>
    <button class="pop-i" data-a="sub">新建子章节</button>
    <div class="pop-sep"></div>
    <button class="pop-i" data-a="up">上移</button>
    <button class="pop-i" data-a="down">下移</button>
    <button class="pop-i" data-a="out">升为上级</button>
    <button class="pop-i" data-a="in">并入上一章</button>
    <div class="pop-sep"></div>
    <button class="pop-i" data-a="del" style="color:var(--red)">删除章节</button>`,
  async a => { closePop(); await chapterAct(a, cid) })
}

export async function chapterAct (a, cid) {
  const c = findChapter(cid)
  if (!c) return

  const sibs = chOf(c.bookId)
    .filter(x => (x.parentId || '') === (c.parentId || ''))
    .sort((x, y) => x.order - y.order)
  const i = sibs.indexOf(c)

  if (a === 'ren') {
    const t = await ask('重命名章节', c.title)
    if (t) { c.title = t; await saveChapter(c) }
  }
  if (a === 'sub') { await addChapter(cid); return }

  if (a === 'up' && i > 0) {
    sibs[i].order = i - 1; sibs[i - 1].order = i
    await saveChapters([sibs[i], sibs[i - 1]])
  }
  if (a === 'down' && i < sibs.length - 1) {
    sibs[i].order = i + 1; sibs[i + 1].order = i
    await saveChapters([sibs[i], sibs[i + 1]])
  }
  if (a === 'out' && c.parentId) {
    const p = findChapter(c.parentId)
    c.parentId = p ? p.parentId : null
    c.order = 999
    await saveChapter(c)
    await normalizeOrders(c.bookId)
  }
  if (a === 'in' && i > 0) {
    c.parentId = sibs[i - 1].id
    c.order = 999
    await saveChapter(c)
    await normalizeOrders(c.bookId)
  }

  if (a === 'del') {
    const kids = descendants(cid)
    const n = allProblems().filter(p => kids.includes(p.chapterId)).length
    const ok = await confirmBox('删除章节',
      `章节「${esc(c.title)}」${kids.length > 1 ? '及其 ' + (kids.length - 1) + ' 个子章节' : ''}将被删除。<br>` +
      `其中 <b>${n}</b> 道题会移到「未归类」，不会丢失。`, '删除章节')
    if (!ok) return
    await deleteChapter(cid)
    if (kids.includes(S.chapterId)) S.chapterId = null
  }

  render('tree', 'list')
}

/** 把某道题拖到章节节点上 */
export const chapterIdFromNode = node =>
  node.dataset.all ? undefined : (node.dataset.un ? null : node.dataset.cid)

/** 展开 / 折叠 */
export async function toggleCollapse (cid) {
  const c = findChapter(cid)
  if (!c || !allChapters().some(x => x.parentId === cid)) return
  c.collapsed = !c.collapsed
  await saveChapter(c)
  renderTree()
}

on('render:tree', renderTree)
