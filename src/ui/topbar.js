/** 顶栏：品牌统计、书籍切换菜单、书籍增删改 */
import { $, esc } from '../core/dom.js'
import { on } from '../core/bus.js'
import { S } from '../core/state.js'
import { READONLY } from '../core/env.js'
import { BOOK, allBooks, allProblems, bookProblems } from '../core/selectors.js'
import { createBook, deleteBook, saveBook, saveMetaSoon } from '../storage/repo.js'
import { popover, closePop } from './popover.js'
import { ask, confirmBox } from './modal.js'
import { toast } from './toast.js'
import { go, render, renderAll } from './render.js'

export function renderBookBar () {
  const b = BOOK()
  const books = allBooks()
  $('#bookName').textContent = b ? b.name : '新建第一本'
  $('#bookCount').textContent = b ? bookProblems(b.id).length : ''
  $('#brandStat').textContent = books.length
    ? books.length + ' 本 · ' + allProblems().length + ' 题'
    : ''
  document.title = (b ? b.name + ' — ' : '') + '错题本'
}

export function bookMenu (anchor) {
  const items = allBooks().map(b => `
    <button class="pop-i ${b.id === S.bookId ? 'on' : ''}" data-a="open" data-id="${b.id}">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.name)}</span>
      <span class="ct">${bookProblems(b.id).length}</span></button>`).join('')

  // 网页只读版没有书籍管理
  const mgmt = READONLY ? '' : `<div class="pop-sep"></div>
    <button class="pop-i" data-a="new">＋ 新建书籍</button>
    ${S.bookId ? `<button class="pop-i" data-a="ren">重命名当前书籍</button>
    <button class="pop-i" data-a="del" style="color:var(--red)">删除当前书籍</button>` : ''}`

  popover(anchor, items + mgmt,
  async (a, id) => {
    closePop()
    if (a === 'open') {
      S.bookId = id; S.chapterId = null; S.problemId = null
      go('list'); saveMetaSoon(); renderAll()
    }
    if (a === 'new') await newBook()
    if (a === 'ren') {
      const b = BOOK()
      const nm = await ask('重命名书籍', b.name)
      if (nm) { b.name = nm; await saveBook(b); renderAll() }
    }
    if (a === 'del') await delBook()
  })
}

export async function newBook () {
  const nm = await ask('新建书籍', '', '例如：高等数学 上册')
  if (!nm) return null
  const b = await createBook(nm)
  S.bookId = b.id
  S.chapterId = null
  saveMetaSoon()
  renderAll()
  toast('已创建', '《' + nm + '》')
  return b
}

export async function delBook () {
  const b = BOOK()
  if (!b) return
  const n = bookProblems(b.id).length
  const ok = await confirmBox('删除书籍',
    `《${esc(b.name)}》连同 <b>${n}</b> 道题、全部截图都会被删除，无法恢复。<br><br>建议先在「设置 → 备份」导出一份。`)
  if (!ok) return

  await deleteBook(b.id)
  S.bookId = allBooks()[0]?.id || null
  S.chapterId = null
  go('list'); saveMetaSoon(); renderAll()
  toast('已删除')
}

on('render:topbar', renderBookBar)
