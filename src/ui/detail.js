/** 详情视图：三个图片槽位、批注编辑器、右侧元信息栏 */
import { $, esc } from '../core/dom.js'
import { on } from '../core/bus.js'
import { ago, fmtD, pad } from '../core/fmt.js'
import { S, openSecs, openShots } from '../core/state.js'
import { READONLY } from '../core/env.js'
import { DIFF_LABEL, MASTERY, NOTE_SNIPS, REASONS, SLOTS, slotName } from '../core/consts.js'
import { PROB, byCountDesc, chName, chTree, filtered, findProblem, topicCounts } from '../core/selectors.js'
import { mdRender } from '../core/md.js'
import { deleteImage, saveProblem } from '../storage/repo.js'
import { POLARITIES, POLARITY_LABEL, hydrate, polarityOf, setPolarity } from '../storage/images.js'
import { confirmBox } from './modal.js'
import { toast } from './toast.js'
import { go, render } from './render.js'
import { aiButtonHTML, chatHTML, latexActionsHTML, latexBodyHTML, revisePanelHTML } from './ai-panel.js'

const masteryLabel = v => (MASTERY[v | 0] || MASTERY[0]).t

/* ---------- 打开与翻页 ---------- */

export function openProblem (id) {
  const p = findProblem(id)
  if (!p) return
  S.problemId = id
  // 每次进题都收起答案、补充和批注 —— 想重做时不该被剧透
  openSecs.clear()
  // 有题干没解析时，默认把粘贴目标对准「答案解析」槽
  S.armedSlot = (p.images.some(i => i.slot === 'q') && !p.images.some(i => i.slot === 'a')) ? 'a' : 'q'
  go('detail')
  renderDetail()
  $('#detMain').scrollTop = 0
}

export function nav (d) {
  const arr = filtered()
  const i = arr.findIndex(x => x.id === S.problemId)
  const j = i + d
  if (j < 0 || j >= arr.length) return
  openProblem(arr[j].id)
}

/**
 * 展开 / 收起某个槽位（答案、补充）。
 *
 * 文字和截图一起开、一起关 —— 按快捷键是想「看答案」这一件事，
 * 展开后还要再点一次「原始截图」才看得全，等于把一个动作拆成两个。
 */
export function toggleSlot (k) {
  const p = PROB()
  if (!p) return

  const has = p.images.some(i => i.slot === k) || (p.latex?.[k] || '').trim()
  if (!has) { toast(`这道题还没有${slotName(k)}`); return }

  if (openSecs.has(k)) {
    openSecs.delete(k)
    openShots.delete(k)
  } else {
    openSecs.add(k)
    openShots.add(k)
  }
  renderDetail()
}

/* ---------- 主体 ---------- */

function shotsHTML (p, s, imgs) {
  return `<div class="shots">
    ${imgs.map((im, ix) => `<figure class="shot" data-im="${im.id}">
        <img data-img="${im.id}" data-kind="full" alt="${esc(s.nm)}">
        ${READONLY ? '' : `<div class="shot-t">
          ${ix > 0 ? `<button class="btn sm icon" data-imv="up" data-id="${im.id}" title="上移">↑</button>` : ''}
          ${ix < imgs.length - 1 ? `<button class="btn sm icon" data-imv="dn" data-id="${im.id}" title="下移">↓</button>` : ''}
          <button class="btn sm icon" data-imv="mono" data-id="${im.id}" title="底色极性：浅底 / 深底 / 彩色">◐</button>
          <button class="btn sm" data-imv="move" data-id="${im.id}" title="移到其它区">移动</button>
          <button class="btn sm icon danger" data-imv="del" data-id="${im.id}" title="删除">✕</button>
        </div>`}
        ${im.cap ? `<figcaption class="shot-cap">${esc(im.cap)}</figcaption>` : ''}
      </figure>`).join('')}
    ${READONLY ? '' : `<div class="drop-z" data-pick="${s.k}">${imgs.length ? '再加一张 · 点击选文件，或拖图片到这里' : '粘贴 / 拖入 / 点击选择截图'}</div>`}
  </div>`
}

/**
 * 文字版是主体，截图退居可折叠区。
 * 截图是固定比例的位图，排版上远不如文字灵活；
 * 但没提取出文字之前截图仍然默认展开，否则这一区就是空的。
 */
function slotHTML (p, s) {
  const imgs = p.images.filter(i => i.slot === s.k)
  const hasText = !!(p.latex?.[s.k] || '').trim()
  if (!imgs.length && !hasText) return emptySlotHTML(p, s)

  // 题干永远展开；答案、补充默认折叠，避免重做时被剧透
  const folded = s.k !== 'q' && S.settings.foldAnswer && !openSecs.has(s.k)
  const shotKey = s.k
  const shotsOpen = !hasText || openShots.has(shotKey)

  return `<section class="slot ${S.armedSlot === s.k ? 'armed' : ''}" data-slot="${s.k}">
    <div class="slot-h">
      <span class="nm">${s.nm}</span>
      <span class="hint">${hasText ? (p.latex[s.k].length + ' 字') : ''}${hasText && imgs.length ? ' · ' : ''}${imgs.length ? imgs.length + ' 张图' : ''}</span>
      <div class="spacer"></div>
      ${!READONLY && S.armedSlot === s.k ? '<span class="hint" style="color:var(--accent)">Ctrl+V 粘到这里</span>' : ''}
      ${folded ? '' : latexActionsHTML(p, s.k, imgs.length)}
      ${READONLY ? '' : `<button class="btn sm" data-pick="${s.k}">选文件</button>`}
    </div>

    ${folded
      ? `<button class="fold" data-opensec="${s.k}">▸ 点开${s.nm}${imgs.length || hasText ? `（${[hasText ? '文字版' : '', imgs.length ? imgs.length + ' 张图' : ''].filter(Boolean).join(' + ')}）` : ''}</button>`
      : `${latexBodyHTML(p, s.k)}
         ${revisePanelHTML(s.k)}
         ${imgs.length
          ? `<button class="shotfold ${shotsOpen ? 'on' : ''}" data-shotfold="${s.k}">
               ${shotsOpen ? '▾' : '▸'} 原始截图（${imgs.length} 张）
             </button>
             ${shotsOpen ? shotsHTML(p, s, imgs) : ''}`
          : READONLY
            ? '<div class="no-shot">没有截图</div>'
            : `<div class="drop-z" data-pick="${s.k}">粘贴 / 拖入 / 点击选择截图</div>`}`}
  </section>`
}

/** 完全空的槽位：只读版给个占位提示，可写版留拖放区 */
function emptySlotHTML (p, s) {
  return `<section class="slot ${S.armedSlot === s.k ? 'armed' : ''}" data-slot="${s.k}">
    <div class="slot-h">
      <span class="nm">${s.nm}</span>
      <span class="hint">${s.hint}</span>
      <div class="spacer"></div>
      ${!READONLY && S.armedSlot === s.k ? '<span class="hint" style="color:var(--accent)">Ctrl+V 粘到这里</span>' : ''}
      ${READONLY ? '' : `<button class="btn sm" data-pick="${s.k}">选文件</button>`}
    </div>
    ${READONLY
      ? '<div class="shots"><div class="no-shot">没有截图</div></div>'
      : '<div class="shots"><div class="drop-z" data-pick="' + s.k + '">粘贴 / 拖入 / 点击选择截图</div></div>'}
  </section>`
}

export function renderDetail () {
  if (S.view !== 'detail') return
  const p = PROB()
  if (!p) { go('list'); return }

  const arr = filtered()
  const ix = arr.findIndex(x => x.id === p.id)
  $('#detPos').textContent = ix >= 0 ? (ix + 1) + ' / ' + arr.length : ''
  $('#btnPrev').disabled = ix <= 0
  $('#btnNext').disabled = ix < 0 || ix >= arr.length - 1

  $('#detMain').innerHTML = `<div class="det-wrap">
    <div class="det-h">
      <div class="tt">
        ${READONLY
          ? `<div class="det-title ro">${esc(p.title) || '（无标题）'}</div>`
          : `<input class="det-title" id="pTitle" value="${esc(p.title)}" placeholder="给这道题起个名（可留空）">`}
        <div class="det-sub">
          <span>#${pad(p.no || 0)}</span><span>·</span>
          <span>${esc(p.chapterId ? chName(p.chapterId) : '未归类')}</span><span>·</span>
          <span>${fmtD(p.createdAt)}</span>${Date.now() - p.createdAt > 7 * 864e5 ? `<span>·</span><span>${ago(p.createdAt)}</span>` : ''}
          ${p.source ? `<span>·</span><span>${esc(p.source)}</span>` : ''}
        </div>
      </div>
      ${READONLY
        ? (p.starred ? '<span class="badge" style="background:var(--amber-weak);color:var(--amber);border-color:var(--amber-line)">★ 已标记</span>' : '')
        : `<button class="btn" id="pStar" style="${p.starred ? 'color:var(--amber);border-color:var(--amber-line);background:var(--amber-weak)' : ''}">${p.starred ? '★ 已标记' : '☆ 标记'}</button>`}
    </div>
    ${SLOTS.map(s => slotHTML(p, s)).join('')}
    ${noteSectionHTML(p)}
    ${chatHTML(p)}
  </div>`

  hydrate($('#detMain'))
  renderSide()
}

/* ---------- 批注 ---------- */

/** 批注里通常写着正解思路，和答案一样默认折叠 */
function noteSectionHTML (p) {
  const has = !!(p.note || '').trim()
  const folded = has && S.settings.foldAnswer && !openSecs.has('note')

  return `<section class="slot">
    <div class="slot-h"><span class="nm">批注</span>
      <span class="hint">错因、正解思路 —— 打字记下来</span><div class="spacer"></div>
      ${folded || READONLY ? '' : '<button class="btn sm" data-editnote>编辑</button>'}</div>
    ${folded
      ? '<button class="fold" data-opensec="note">▸ 点开批注</button>'
      : `<div id="noteHost">${noteViewHTML(p)}</div>`}
  </section>`
}

function noteViewHTML (p) {
  const h = mdRender(p.note)
  if (READONLY) {
    return h
      ? `<div class="note-view">${h}</div>`
      : '<div class="note-view ph">还没有批注。</div>'
  }
  return h
    ? `<div class="note-view" data-editnote>${h}</div>`
    : '<div class="note-view ph" data-editnote>还没有批注。点这里开始写 —— 建议至少记清「为什么错」和「正确的切入点」。</div>'
}

/**
 * 批注的键盘入口：折叠着就先展开，已经展开才进编辑。
 *
 * 批注默认是收起的，一按键就跳进编辑框会跳过「先看一眼原来写了什么」这一步；
 * 而且那时候 #noteHost 还不存在，openNote() 会直接抛空指针。
 */
export function noteStep () {
  const p = PROB()
  if (!p) return

  const has = !!(p.note || '').trim()
  const folded = has && S.settings.foldAnswer && !openSecs.has('note')
  if (folded) {
    openSecs.add('note')
    renderDetail()
    return
  }
  // 只读版展开就到头了，没有编辑这一步
  if (READONLY) return
  openNote()
}

export function openNote () {
  const p = PROB()
  const host = $('#noteHost')
  // 批注折叠时没有 #noteHost。走 noteStep 进来不会碰上，
  // 但这里是导出函数，留个兜底比让调用方记规矩可靠
  if (!p || !host) return
  host.innerHTML = `
    <div class="note-h">
      ${NOTE_SNIPS.map((s, i) => `<button class="snip" data-snip="${i}">${s.t}</button>`).join('')}
      <div class="spacer"></div>
      <span style="font-size:11.5px;color:var(--ink3)">Markdown · $x^2$ 公式 · Esc 保存</span>
    </div>
    <textarea id="noteEdit" placeholder="### 错因分析&#10;把当时的想法写下来：卡在哪一步、误用了什么条件…&#10;&#10;### 正解思路&#10;…">${esc(p.note || '')}</textarea>`

  const ta = $('#noteEdit')
  ta.focus()
  ta.setSelectionRange(ta.value.length, ta.value.length)
  ta.addEventListener('blur', () => closeNote())
  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); ta.blur() }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.blur() }
  })
}

export async function closeNote () {
  const p = PROB()
  const ta = $('#noteEdit')
  if (!p || !ta) return
  if (ta.value !== p.note) { p.note = ta.value; await saveProblem(p); render('list') }
  const host = $('#noteHost')
  if (!host) return
  host.innerHTML = noteViewHTML(p)
}

export function insertSnip (i) {
  const ta = $('#noteEdit')
  if (!ta) return
  const s = NOTE_SNIPS[i].v
  const a = ta.selectionStart
  const b = ta.selectionEnd
  const pre = ta.value.slice(0, a)
  const post = ta.value.slice(b)
  const lead = (pre && !/\n$/.test(pre) && s.startsWith('###')) ? '\n\n' : ''
  ta.value = pre + lead + s + post
  const cur = (pre + lead + s).length - (s.startsWith('$$') ? 3 : 0)
  ta.focus()
  ta.setSelectionRange(cur, cur)
}

/**
 * 删掉一个错因 / 知识点标签。
 * 左键点那个 ✕ 和右键点整个标签走同一条路 —— ✕ 太小，鼠标得瞄。
 *
 * @param kind 'reason' | 'topic'
 */
export async function removeTag (kind, value) {
  const p = PROB()
  if (!p || READONLY) return

  if (kind === 'reason') {
    p.reasons = (p.reasons || []).filter(x => x !== value)
    await saveProblem(p)
    renderSide()
    // 错因同时是左栏的筛选项，得跟着重画
    render('list', 'filters')
  } else {
    p.topics = (p.topics || []).filter(x => x !== value)
    await saveProblem(p)
    renderSide()
    render('list')
  }
}

/* ---------- 右侧元信息 ---------- */

export function renderSide () {
  const p = PROB()
  if (!p) return

  // 网页只读版：侧栏只展示，不提供任何编辑控件
  if (READONLY) {
    $('#detSide').innerHTML = `
      <div class="mt"><div class="mt-l">难度 · ${DIFF_LABEL[p.difficulty || 3]}${p.difficultyManual ? '' : (p.ai?.difficulty ? ' <span class="byai">AI</span>' : '')}</div>
        ${!p.difficultyManual && p.ai?.difficultyReason ? `<div class="why">${esc(p.ai.difficultyReason)}</div>` : ''}</div>
      <div class="mt"><div class="mt-l">掌握程度</div><div class="ro-val">${masteryLabel(p.mastery)}</div></div>
      <div class="mt"><div class="mt-l">类型</div><div class="ro-val">${p.kind === 'good' ? '好题' : '错题'}</div></div>
      <div class="sep"></div>
      <div class="mt"><div class="mt-l">错因</div>
        <div class="tagbox">${(p.reasons || []).length ? (p.reasons || []).map(r => `<span class="t">${esc(r)}</span>`).join('') : '<span class="ph">无</span>'}</div></div>
      <div class="mt"><div class="mt-l">知识点</div>
        <div class="tagbox k">${(p.topics || []).length ? (p.topics || []).map(t => `<span class="t">${esc(t)}</span>`).join('') : '<span class="ph">无</span>'}</div></div>
      <div class="sep"></div>
      <div class="mt"><div class="mt-l">所属章节</div><div class="ro-val">${esc(p.chapterId ? chName(p.chapterId) : '未归类')}</div></div>
      ${p.source ? `<div class="mt"><div class="mt-l">来源（页码 / 卷次）</div><div class="ro-val">${esc(p.source)}</div></div>` : ''}
      <div class="sep"></div>
      <div class="mt"><div class="mt-l">复习</div>
        <div class="ro-val">${p.reviewCount ? `已复习 ${p.reviewCount} 次` : '还没复习过'}${p.lastReviewAt ? `<br><span class="mono" style="font-size:11.5px;color:var(--ink3)">上次 ${fmtD(p.lastReviewAt)} · ${ago(p.lastReviewAt)}</span>` : ''}</div></div>`
    return
  }

  const chs = chTree(S.bookId)
  const known = topicCounts()
  const topSug = byCountDesc(known).filter(t => !(p.topics || []).includes(t)).slice(0, 6)
  const rSug = REASONS.filter(r => !(p.reasons || []).includes(r)).slice(0, 10)

  $('#detSide').innerHTML = `
    ${aiButtonHTML(p)}
    <div class="sep"></div>
    <div class="mt"><div class="mt-l">难度 · ${DIFF_LABEL[p.difficulty || 3]}${p.difficultyManual ? '' : (p.ai?.difficulty ? ' <span class="byai">AI</span>' : '')}</div>
      <div class="dsel">${[1, 2, 3, 4, 5].map(d => `<button data-v="${d}" data-diff="${d}" class="${p.difficulty === d ? 'on' : ''}">${d}</button>`).join('')}</div>
      ${!p.difficultyManual && p.ai?.difficultyReason ? `<div class="why">${esc(p.ai.difficultyReason)}</div>` : ''}</div>
    <div class="mt"><div class="mt-l">掌握程度</div>
      <div class="msel">${MASTERY.map(m => `<button data-v="${m.v}" data-mast="${m.v}" class="${(p.mastery | 0) === m.v ? 'on' : ''}">${m.t}</button>`).join('')}</div></div>
    <div class="mt"><div class="mt-l">类型</div>
      <div class="msel"><button data-kind="wrong" class="${p.kind !== 'good' ? 'on' : ''}" data-v="0" style="${p.kind !== 'good' ? 'background:var(--red-weak);border-color:var(--red-line);color:var(--red);font-weight:600' : ''}">错题</button>
      <button data-kind="good" class="${p.kind === 'good' ? 'on' : ''}" data-v="2" style="${p.kind === 'good' ? 'background:var(--accent-weak);border-color:var(--accent-line);color:var(--accent);font-weight:600' : ''}">好题</button></div></div>
    <div class="sep"></div>
    <div class="mt"><div class="mt-l">错因</div>
      <div class="tagbox">${(p.reasons || []).map(r => `<span class="t">${esc(r)}<button data-rmr="${esc(r)}">✕</button></span>`).join('')}
        <button class="add" data-addr>＋ 自定义</button></div>
      ${rSug.length ? `<div class="sugg">${rSug.map(r => `<button data-addreason="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}
    </div>
    <div class="mt"><div class="mt-l">知识点</div>
      <div class="tagbox k">${(p.topics || []).map(t => `<span class="t">${esc(t)}<button data-rmt="${esc(t)}">✕</button></span>`).join('')}
        <button class="add" data-addt>＋ 添加</button></div>
      ${topSug.length ? `<div class="sugg k">${topSug.map(t => `<button data-addtopic="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
    </div>
    <div class="sep"></div>
    <div class="mt"><div class="mt-l">所属章节</div>
      <select class="inp" id="pChapter">
        <option value="">未归类</option>
        ${chs.map(({ c, depth }) => `<option value="${c.id}" ${p.chapterId === c.id ? 'selected' : ''}>${'　'.repeat(depth)}${esc(c.title)}</option>`).join('')}
      </select></div>
    <div class="mt"><div class="mt-l">来源（页码 / 卷次）</div>
      <input class="inp" id="pSource" value="${esc(p.source || '')}" placeholder="如 P128 第 7 题"></div>
    <div class="sep"></div>
    <div class="mt"><div class="mt-l">复习</div>
      <button class="btn" style="width:100%" id="pReview">✓ 记一次复习${p.reviewCount ? `（已 ${p.reviewCount} 次）` : ''}</button>
      ${p.lastReviewAt ? `<div style="font-size:11.5px;color:var(--ink3);margin-top:5px" class="mono">上次 ${fmtD(p.lastReviewAt)} · ${ago(p.lastReviewAt)}</div>` : ''}
    </div>`
}

/* ---------- 图片操作 ---------- */

export async function imgAct (a, imgId) {
  const p = PROB()
  if (!p || READONLY) return
  const i = p.images.findIndex(x => x.id === imgId)
  if (i < 0) return
  const cur = p.images[i]

  if (a === 'del') {
    const ok = await confirmBox('删除截图', '这张图会被永久删除。')
    if (!ok) return
    await deleteImage(p, imgId)
    renderDetail(); render('list')
    return
  }

  if (a === 'mono') {
    // 三态循环：浅底 → 深底 → 彩色，自动判断错了就手动拨过来
    const cur = polarityOf(imgId)
    const next = POLARITIES[(POLARITIES.indexOf(cur) + 1) % POLARITIES.length]
    await setPolarity(imgId, next)
    renderDetail(); render('list')
    toast(POLARITY_LABEL[next])
    return
  }

  if (a === 'up' || a === 'dn') {
    const same = p.images.filter(x => x.slot === cur.slot)
    const j = same.indexOf(cur)
    const k = a === 'up' ? j - 1 : j + 1
    if (k < 0 || k >= same.length) return
    const other = same[k]
    const ia = p.images.indexOf(cur)
    const ib = p.images.indexOf(other)
    p.images[ia] = other
    p.images[ib] = cur
  }

  if (a === 'move') {
    const order = ['q', 'a', 'x']
    const next = order[(order.indexOf(cur.slot) + 1) % 3]
    cur.slot = next
    toast('已移到「' + slotName(next) + '」')
  }

  await saveProblem(p)
  renderDetail()
  render('list')
}

on('render:detail', renderDetail)
on('render:side', renderSide)
on('problem:open', openProblem)
