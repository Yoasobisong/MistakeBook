/**
 * 列表页的批量选择与批量操作。
 *
 * 选择状态只存内存，切换书籍或章节时清空 —— 跨视图保留选中会让人
 * 在别处误操作一批看不见的题。
 */
import { $, $$, esc } from '../core/dom.js'
import { S } from '../core/state.js'
import { MASTERY } from '../core/consts.js'
import { chTree, filtered, findProblem } from '../core/selectors.js'
import { deleteProblem, saveProblems } from '../storage/repo.js'
import { queueAnalyze, queueExtract } from '../ai/tasks.js'
import { isConfigured } from '../ai/config.js'
import { confirmBox, modal } from './modal.js'
import { toast } from './toast.js'
import { render, renderAll } from './render.js'

/** 选中的题目 id */
export const sel = new Set()

export const selMode = () => S.selMode === true

export function clearSel () {
  sel.clear()
  S.selMode = false
  render('list')
}

export function toggleSelMode () {
  S.selMode = !S.selMode
  if (!S.selMode) sel.clear()
  render('list')
}

/** 卡片被点：选择模式下切换选中，否则交回给打开详情的逻辑 */
export function selClick (pid, shiftKey) {
  if (!selMode()) return false

  if (shiftKey && sel.size) {
    // 从最后一个选中项到当前项之间整段选上，长列表里省很多次点击
    const arr = filtered().map(p => p.id)
    const last = [...sel][sel.size - 1]
    const a = arr.indexOf(last)
    const b = arr.indexOf(pid)
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a]
      for (let i = lo; i <= hi; i++) sel.add(arr[i])
      render('list')
      return true
    }
  }

  sel.has(pid) ? sel.delete(pid) : sel.add(pid)
  render('list')
  return true
}

/* ---------- 工具条 ---------- */

export function selBarHTML () {
  if (!selMode()) return ''
  const n = sel.size
  const all = filtered().length

  return `<div class="selbar">
    <label class="ck"><input type="checkbox" data-selall ${n && n === all ? 'checked' : ''}>
      <span>${n ? `已选 ${n} 题` : '全选'}</span></label>
    <div class="spacer"></div>
    ${n
      ? `<button class="btn sm" data-selact="extract">提取文字</button>
         <button class="btn sm" data-selact="analyze">分析考点</button>
         <span class="vr"></span>
         <button class="btn sm" data-selact="chapter">移到章节</button>
         <button class="btn sm" data-selact="mastery">掌握度</button>
         <button class="btn sm" data-selact="star">星标</button>
         <span class="vr"></span>
         <button class="btn sm danger" data-selact="del">删除</button>`
      : '<span class="tip">点卡片选中，Shift+点选一整段</span>'}
    <button class="btn sm ghost" data-selact="exit">退出</button>
  </div>`
}

/* ---------- 各项操作 ---------- */

const picked = () => [...sel].map(findProblem).filter(Boolean)

async function bulkSave (list, fn, msg) {
  list.forEach(fn)
  await saveProblems(list)
  renderAll()
  toast(msg, list.length + ' 题')
}

async function toChapter (list) {
  const chs = chTree(S.bookId)
  const cid = await modal({
    title: '移到章节',
    okText: '移动',
    body: `<div style="font-size:13px;color:var(--ink2);line-height:1.9">
      把选中的 <b>${list.length}</b> 题移到：
      <select class="inp" id="bulkCh" style="margin-top:8px">
        <option value="">未归类</option>
        ${chs.map(({ c, depth }) => `<option value="${c.id}">${'　'.repeat(depth)}${esc(c.title)}</option>`).join('')}
      </select></div>`,
    onOk: w => ({ v: w.querySelector('#bulkCh').value })
  })
  if (!cid) return
  await bulkSave(list, p => { p.chapterId = cid.v || null }, '已移动')
}

async function toMastery (list) {
  const r = await modal({
    title: '设置掌握程度',
    okText: '应用',
    body: `<div style="font-size:13px;color:var(--ink2);line-height:1.9">
      把选中的 <b>${list.length}</b> 题标记为：
      <div class="msel" style="margin-top:8px">
        ${MASTERY.map((m, i) => `<label style="flex:1"><input type="radio" name="bm" value="${m.v}" ${i === 0 ? 'checked' : ''}> ${m.t}</label>`).join('')}
      </div></div>`,
    onOk: w => ({ v: +w.querySelector('[name=bm]:checked').value })
  })
  if (!r) return
  await bulkSave(list, p => { p.mastery = r.v }, '已更新掌握度')
}

async function toggleStar (list) {
  // 只要有一道没标记，就整批标上；全都标了才整批取消
  const anyOff = list.some(p => !p.starred)
  await bulkSave(list, p => { p.starred = anyOff }, anyOff ? '已加星标' : '已取消星标')
}

async function bulkDelete (list) {
  const imgs = list.reduce((n, p) => n + p.images.length, 0)
  const ok = await confirmBox(
    `删除 ${list.length} 道题`,
    `连同 ${imgs} 张截图一起删除。删掉的题会进回收站，可以再找回来。`
  )
  if (!ok) return

  for (const p of list) await deleteProblem(p.id)
  sel.clear()
  renderAll()
  toast('已删除 ' + list.length + ' 题', '可在 设置 → 备份 → 回收站 里恢复')
}

async function bulkExtract (list) {
  if (!isConfigured('extract')) { toast('提取槽还没配模型', '设置 → AI'); return }

  // 按槽位算而不是按题：一道题可能题干已提取、答案刚补了截图还没提取
  const SLOTS = ['q', 'a', 'x']
  let todo = 0
  let skip = 0
  for (const p of list) {
    for (const k of SLOTS) {
      if (!p.images.some(i => i.slot === k)) continue
      if ((p.latex?.[k] || '').trim()) skip++
      else todo++
    }
  }

  if (!todo) {
    skip
      ? toast('选中的都已经提取过了', '想重做的话进题目点「重新提取」')
      : toast('选中的题都没有截图')
    return
  }

  // 已有文字的一律跳过 —— 重新提取会覆盖掉人工改动，那得由你显式发起
  toast('已排入队列', `${todo} 处${skip ? ` · 跳过 ${skip} 处已提取的` : ''}`)
  await queueExtract(list, SLOTS, { skipDone: true })
  renderAll()
  toast('批量提取结束')
}

async function bulkAnalyze (list) {
  if (!isConfigured('analyze')) { toast('分析槽还没配模型', '设置 → AI'); return }
  const targets = list.filter(p => (p.latex?.q || p.latex?.a || '').trim())
  if (!targets.length) { toast('选中的题都还没有文字版', '先批量提取'); return }
  if (targets.length < list.length) {
    toast(`${list.length - targets.length} 题没有文字版，已跳过`)
  }

  await queueAnalyze(targets)
  renderAll()
  toast('批量分析结束')
}

/** 全选当前筛选结果；已经全选则清空 */
export function selectAll () {
  const arr = filtered()
  if (sel.size === arr.length) sel.clear()
  else arr.forEach(p => sel.add(p.id))
  render('list')
}

/** 返回 true 表示这次点击已被批量工具条处理 */
export function handleSelClick (t) {
  if (t.closest('[data-selall]')) { selectAll(); return true }

  const act = t.closest('[data-selact]')
  if (!act) return false

  const a = act.dataset.selact
  if (a === 'exit') { clearSel(); return true }

  const list = picked()
  if (!list.length) { toast('还没有选中任何题'); return true }

  if (a === 'extract') bulkExtract(list)
  else if (a === 'analyze') bulkAnalyze(list)
  else if (a === 'chapter') toChapter(list)
  else if (a === 'mastery') toMastery(list)
  else if (a === 'star') toggleStar(list)
  else if (a === 'del') bulkDelete(list)
  return true
}
