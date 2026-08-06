/**
 * 应用入口：全局事件绑定与启动流程。
 *
 * 事件采用委托，统一挂在 document 上 —— 各视图频繁重画 innerHTML，
 * 逐元素绑定会在重画后失效。
 */
import './styles/index.css'

import { $, $$, debounce } from './core/dom.js'
import { S, emptyFilters, openSecs, openShots } from './core/state.js'
import { BOOK, PROB, chName, findProblem } from './core/selectors.js'
import { openDB } from './storage/db.js'
import {
  createProblem, deleteProblem, loadAll, saveMetaSoon, saveProblem
} from './storage/repo.js'

import { go, render, renderAll, openProblem } from './ui/render.js'
import { bookMenu, newBook } from './ui/topbar.js'
import { addChapter, chapterAct, chapterMenu, toggleCollapse } from './ui/tree.js'
import { imgAct, insertSnip, nav, openNote, renderDetail, renderSide } from './ui/detail.js'
import { renderStats } from './ui/stats.js'
import { printFlow } from './ui/print.js'
import { settingsModal, importBackupFile } from './ui/settings.js'
import { blobsFrom, flashPaste, ingest, ingestSmart } from './ui/ingest.js'
import { lightbox } from './ui/lightbox.js'
import { ask, confirmBox } from './ui/modal.js'
import { toast } from './ui/toast.js'
import { bindKeys } from './ui/keys.js'

// 这些模块靠 import 副作用把渲染函数注册进事件总线
import './ui/list.js'
import './ui/filters.js'
import './ui/ai-progress.js'

import { loadKeys } from './ai/config.js'
import { applyTheme, cycleTheme, paintThemeBtn } from './ui/theme.js'
import { handleAIPanelClick, sendChat } from './ui/ai-panel.js'
import { tocImportFlow, tocPasteImage } from './ui/toc-import.js'
import { clearSel, handleSelClick, selClick, selMode, toggleSelMode } from './ui/select.js'
import { canAutoBackup, scheduleBackup } from './ui/autobackup.js'
import { bindZoom } from './ui/zoom.js'

let pendingSlot = 'q'

/* ============================================================
   点击委托
   ============================================================ */
function bindClicks () {
  document.addEventListener('click', async e => {
    const t = e.target
    const hit = s => t.closest(s)

    /* ---- 顶栏 ---- */
    if (hit('#bookPick')) { bookMenu($('#bookPick')); return }
    if (hit('[data-newbook]')) { newBook(); return }
    if (hit('#btnAddCh')) { addChapter(null); return }
    if (hit('#btnImportToc')) { tocImportFlow(); return }
    if (hit('#btnStats')) {
      go('stats')
      $$('#scopeSeg button').forEach(b => b.classList.toggle('on', b.dataset.sc === S.scope))
      renderStats()
      return
    }
    if (hit('#btnStatsBack') || hit('#btnBack')) { go('list'); render('list'); return }
    if (hit('#btnPrint')) { printFlow(false); return }
    if (hit('#btnSet')) { settingsModal(); return }
    if (hit('#btnSel')) { toggleSelMode(); return }

    // 批量工具条（全选、各项批量操作）
    if (handleSelClick(t)) return
    if (hit('#btnTheme')) { cycleTheme(); saveMetaSoon(); return }
    if (hit('#btnDetPrint')) { printFlow(true); return }
    if (hit('#btnDetDel')) { await removeProblem(S.problemId); return }
    if (hit('#btnNew')) {
      if (!BOOK()) { await newBook(); if (!BOOK()) return }
      const p = await createProblem([], 'q')
      if (p) { renderAll(); openProblem(p.id); toast('已新建空白题', '粘贴截图或点选文件') }
      return
    }

    /* ---- 分段控件 ---- */
    const sc = hit('#scopeSeg button')
    if (sc) {
      S.scope = sc.dataset.sc
      $$('#scopeSeg button').forEach(b => b.classList.toggle('on', b === sc))
      renderStats()
      return
    }
    const so = hit('#sortSeg button')
    if (so) {
      S.sort = so.dataset.s
      $$('#sortSeg button').forEach(b => b.classList.toggle('on', b === so))
      saveMetaSoon(); render('list')
      return
    }
    const sz = hit('#sizeSeg button')
    if (sz) {
      S.size = sz.dataset.z
      $$('#sizeSeg button').forEach(b => b.classList.toggle('on', b === sz))
      saveMetaSoon(); render('list')
      return
    }

    /* ---- 大纲树 ---- */
    const node = hit('.node')
    if (node) {
      const cid = node.dataset.cid
      if (hit('[data-tw]') && cid) { await toggleCollapse(cid); return }
      const chb = hit('[data-ch]')
      if (chb) {
        if (chb.dataset.ch === 'add') addChapter(cid)
        else chapterMenu(chb, cid)
        return
      }
      S.chapterId = node.dataset.all ? null : (node.dataset.un ? '' : cid)
      // 换了章节，之前选中的题已经不在视野里了，留着容易误操作
      if (selMode()) clearSel()
      go('list'); saveMetaSoon(); render('tree', 'list')
      return
    }

    /* ---- 筛选 ----
       注意：卡片和 .dots 也带 data-d / data-m，必须靠 .chip 类名区分 */
    const f = S.f
    const tog = (arr, v) => { const i = arr.indexOf(v); i < 0 ? arr.push(v) : arr.splice(i, 1) }
    let changed = false
    const cr = hit('[data-r]')
    const cd = hit('[data-d]')
    const cm = hit('[data-m]')
    const ck = hit('[data-k]')

    if (cr) {
      tog(f.reasons, cr.dataset.r); changed = true
    } else if (cd?.classList.contains('chip')) {
      tog(f.diff, +cd.dataset.d); changed = true
    } else if (cm?.classList.contains('chip')) {
      tog(f.mastery, +cm.dataset.m); changed = true
    } else if (ck) {
      f.kind = f.kind === ck.dataset.k ? '' : ck.dataset.k; changed = true
    } else if (hit('[data-star]')) {
      f.star = !f.star; changed = true
    } else if (hit('[data-noans]')) {
      f.noAnswer = !f.noAnswer; changed = true
    } else if (hit('[data-notext]')) {
      f.noText = !f.noText; changed = true
    } else if (hit('[data-noai]')) {
      f.noAI = !f.noAI; changed = true
    } else if (hit('[data-clr]')) {
      S.f = emptyFilters(); changed = true
    }

    if (changed) {
      if (S.view !== 'list') go('list')
      render('filters', 'list')
      return
    }

    /* ---- 卡片 ---- */
    const card = hit('.card')
    if (card) {
      // 批量模式下点卡片是选中，不是打开
      if (selClick(card.dataset.pid, e.shiftKey)) return
      openProblem(card.dataset.pid)
      return
    }

    /* ---- 详情主体 ---- */
    if (hit('#btnPrev') || hit('#btnNext')) { nav(hit('#btnPrev') ? -1 : 1); return }
    if (hit('#pStar')) {
      const p = PROB()
      p.starred = !p.starred
      await saveProblem(p)
      renderDetail(); render('list')
      return
    }
    const os = hit('[data-opensec]')
    if (os) { openSecs.add(os.dataset.opensec); renderDetail(); return }

    const sf = hit('[data-shotfold]')
    if (sf) {
      const k = sf.dataset.shotfold
      openShots.has(k) ? openShots.delete(k) : openShots.add(k)
      renderDetail()
      return
    }
    if (hit('[data-editnote]') && !$('#noteEdit')) { openNote(); return }

    const snip = hit('[data-snip]')
    if (snip) { insertSnip(+snip.dataset.snip); return }

    const pick = hit('[data-pick]')
    if (pick) { pendingSlot = pick.dataset.pick; $('#filePick').click(); return }

    const iv = hit('[data-imv]')
    if (iv) { e.stopPropagation(); imgAct(iv.dataset.imv, iv.dataset.id); return }

    // LaTeX 提取 / 编辑、AI 分析与采纳
    if (handleAIPanelClick(t)) return

    if (t.closest('.shot') && t.tagName === 'IMG') { lightbox(t.dataset.img); return }

    const slot = hit('.slot[data-slot]')
    if (slot) {
      S.armedSlot = slot.dataset.slot
      $$('.slot[data-slot]').forEach(s => s.classList.toggle('armed', s === slot))
    }

    /* ---- 详情侧栏 ---- */
    const p = PROB()
    if (!p) return

    const dd = hit('[data-diff]'); const mm = hit('[data-mast]'); const kk = hit('[data-kind]')
    if (dd) {
      p.difficulty = +dd.dataset.diff
      p.difficultyManual = true // 手动定过难度后，AI 分析不再覆盖
      await saveProblem(p); renderSide(); render('list')
      return
    }
    if (mm) { p.mastery = +mm.dataset.mast; await saveProblem(p); renderSide(); render('list', 'filters'); return }
    if (kk) { p.kind = kk.dataset.kind; await saveProblem(p); renderSide(); render('list'); return }

    const rmr = hit('[data-rmr]'); const rmt = hit('[data-rmt]')
    if (rmr) {
      p.reasons = p.reasons.filter(x => x !== rmr.dataset.rmr)
      await saveProblem(p); renderSide(); render('list', 'filters')
      return
    }
    if (rmt) {
      p.topics = p.topics.filter(x => x !== rmt.dataset.rmt)
      await saveProblem(p); renderSide(); render('list')
      return
    }

    const ar = hit('[data-addreason]'); const at = hit('[data-addtopic]')
    if (ar) {
      if (!p.reasons.includes(ar.dataset.addreason)) p.reasons.push(ar.dataset.addreason)
      await saveProblem(p); renderSide(); render('list', 'filters')
      return
    }
    if (at) {
      if (!p.topics.includes(at.dataset.addtopic)) p.topics.push(at.dataset.addtopic)
      await saveProblem(p); renderSide(); render('list')
      return
    }

    if (hit('[data-addr]')) {
      const v = await ask('添加错因', '', '自己的说法也行，比如「三角恒等变形不熟」')
      if (v && !p.reasons.includes(v)) {
        p.reasons.push(v)
        await saveProblem(p); renderSide(); render('list', 'filters')
      }
      return
    }
    if (hit('[data-addt]')) {
      const v = await ask('添加知识点', '', '比如：洛必达法则')
      if (v && !p.topics.includes(v)) {
        p.topics.push(v)
        await saveProblem(p); renderSide(); render('list')
      }
      return
    }
    if (hit('#pReview')) {
      p.reviewCount = (p.reviewCount || 0) + 1
      p.lastReviewAt = Date.now()
      await saveProblem(p); renderSide()
      toast('已记录复习', '第 ' + p.reviewCount + ' 次')
    }
  })

  // 点批注工具条时保持 textarea 焦点，否则按钮会随失焦重建而点空
  document.addEventListener('mousedown', e => {
    if (e.target.closest('.snip')) e.preventDefault()
  })
}

async function removeProblem (id) {
  const p = findProblem(id)
  if (!p) return
  const ok = await confirmBox('删除这道题', `#${String(p.no).padStart(3, '0')} 及其 ${p.images.length} 张截图将被永久删除。`)
  if (!ok) return
  await deleteProblem(id)
  if (S.problemId === id) { S.problemId = null; go('list') }
  renderAll()
  toast('已删除')
}

/* ============================================================
   表单 / 文件 / 粘贴 / 拖拽
   ============================================================ */
function bindForms () {
  document.addEventListener('keydown', e => {
    // 对话框：Enter 发送，Shift+Enter 换行
    if (e.target.id === 'chatBox' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendChat()
    }
  })

  $('#q').addEventListener('input', debounce(e => {
    S.q = e.target.value
    if (S.view !== 'list') go('list')
    render('list')
  }, 160))

  const saveSoon = debounce(p => saveProblem(p), 380)
  const listSoon = debounce(() => render('list'), 480)

  document.addEventListener('input', e => {
    const p = PROB()
    if (!p) return
    if (e.target.id === 'pTitle') { p.title = e.target.value.trim(); saveSoon(p); listSoon() }
    if (e.target.id === 'pSource') { p.source = e.target.value.trim(); saveSoon(p) }
  })

  document.addEventListener('change', async e => {
    if (e.target.id === 'pChapter') {
      const p = PROB()
      if (!p) return
      p.chapterId = e.target.value || null
      await saveProblem(p)
      renderDetail(); render('tree', 'list')
    }
    if (e.target.id === 'filePick') {
      const fs = Array.from(e.target.files || [])
      e.target.value = ''
      if (fs.length) await ingest(fs, { slot: pendingSlot, merge: S.view === 'detail' })
    }
    if (e.target.id === 'jsonPick') {
      const f = e.target.files[0]
      e.target.value = ''
      if (f) importBackupFile(f)
    }
  })
}

function bindPaste () {
  window.addEventListener('paste', async e => {
    const blobs = blobsFrom(e.clipboardData)
    // 在输入框里粘贴纯文本时不拦截
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '') && !blobs.length) return
    if (!blobs.length) return
    e.preventDefault()

    // 目录导入弹窗开着时，图片归它处理
    if (tocPasteImage(blobs[0])) return

    flashPaste()
    await ingestSmart(blobs)
  })
}

function bindDrag () {
  let depth = 0
  const hasFiles = dt => dt && Array.from(dt.types || []).includes('Files')

  window.addEventListener('dragenter', e => {
    if (hasFiles(e.dataTransfer)) { depth++; document.body.classList.add('dragging') }
  })
  window.addEventListener('dragleave', () => {
    if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging') }
  })
  window.addEventListener('dragover', e => { if (hasFiles(e.dataTransfer)) e.preventDefault() })

  window.addEventListener('drop', async e => {
    const blobs = blobsFrom(e.dataTransfer)
    depth = 0
    document.body.classList.remove('dragging')
    if (!blobs.length) return
    e.preventDefault()
    const dz = e.target.closest('[data-pick]')
    if (dz && S.view === 'detail') { await ingest(blobs, { slot: dz.dataset.pick }); return }
    await ingestSmart(blobs)
  })

  /* 把卡片拖到章节上归类 */
  document.addEventListener('dragstart', e => {
    const c = e.target.closest('.card')
    if (c) {
      e.dataTransfer.setData('text/pid', c.dataset.pid)
      e.dataTransfer.effectAllowed = 'move'
    }
  })
  document.addEventListener('dragover', e => {
    const n = e.target.closest('.node')
    if (n && Array.from(e.dataTransfer.types || []).includes('text/pid')) {
      e.preventDefault()
      n.classList.add('drop')
    }
  })
  document.addEventListener('dragleave', e => {
    e.target.closest('.node')?.classList.remove('drop')
  })
  document.addEventListener('drop', async e => {
    const n = e.target.closest('.node')
    if (!n) return
    const pid = e.dataTransfer.getData('text/pid')
    if (!pid) return
    e.preventDefault()
    n.classList.remove('drop')
    const p = findProblem(pid)
    if (!p) return
    // 拖到「全部题目」不改归属
    if (!n.dataset.all) p.chapterId = n.dataset.un ? null : n.dataset.cid
    await saveProblem(p)
    render('tree', 'list')
    toast('已移到「' + (p.chapterId ? chName(p.chapterId) : '未归类') + '」')
  })
}

function bindUnload () {
  window.addEventListener('beforeunload', () => {
    const ta = $('#noteEdit')
    const p = PROB()
    if (ta && p && ta.value !== p.note) {
      p.note = ta.value
      saveProblem(p)
    }
  })
}

/* ============================================================
   启动
   ============================================================ */
function fatal (err) {
  document.body.innerHTML = `<div class="empty" style="height:100vh">
    <div class="k">浏览器不让这个页面存数据</div>
    <div class="s">错题本需要 IndexedDB 保存截图。<br>
    请确认没有开启无痕模式、没有屏蔽本地存储。<br>
    <span class="mono" style="font-size:11.5px;color:#94A3AC">${String(err?.message || err)}</span></div></div>`
}

async function boot () {
  try {
    await openDB()
  } catch (err) {
    fatal(err)
    return
  }

  try { navigator.storage?.persist?.() } catch (_) {}

  await loadAll()
  await loadKeys()

  applyTheme()
  paintThemeBtn()

  $$('#sortSeg button').forEach(b => b.classList.toggle('on', b.dataset.s === S.sort))
  $$('#sizeSeg button').forEach(b => b.classList.toggle('on', b.dataset.z === S.size))
  $$('#scopeSeg button').forEach(b => b.classList.toggle('on', b.dataset.sc === S.scope))

  bindClicks()
  bindForms()
  bindPaste()
  bindDrag()
  bindUnload()
  bindKeys()
  bindZoom()

  renderAll()
  scheduleBackup()

  // 自动备份接管之后就不用再唠叨了
  if (!canAutoBackup() || !S.settings.backup.enabled) {
    if (S.problems.length >= 15 && Date.now() - S.lastBackup > 12 * 864e5) {
      setTimeout(() => toast('好久没备份了', '设置 → 备份 → 导出全部'), 1600)
    }
  }
}

boot()
