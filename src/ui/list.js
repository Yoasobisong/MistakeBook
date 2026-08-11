/** 主区列表：卡片网格与空状态 */
import { $, esc } from '../core/dom.js'
import { on } from '../core/bus.js'
import { fmtD, pad } from '../core/fmt.js'
import { S } from '../core/state.js'
import { MASTERY } from '../core/consts.js'
import { BOOK, chName, filtered, isFiltering } from '../core/selectors.js'
import { mdRender } from '../core/md.js'
import { hydrate } from '../storage/images.js'
import { sel, selBarHTML, selMode } from './select.js'

const masteryLabel = v => (MASTERY[v | 0] || MASTERY[0]).t

/**
 * 卡片上的正文预览。
 * 按空行切块后整块累加，不在字符数上硬截断 ——
 * 从公式中间切开会把 LaTeX 断成两半，KaTeX 直接渲染失败。
 */
function previewMd (txt, maxChars = 200) {
  const blocks = txt.trim().split(/\n\s*\n/)
  const out = []
  let n = 0
  for (const b of blocks) {
    out.push(b)
    n += b.length
    if (n >= maxChars) break
  }
  return out.join('\n\n')
}

export function cardHTML (p) {
  const q = p.images.find(i => i.slot === 'q') || p.images[0]
  const txt = (p.latex?.q || '').trim()
  const rs = (p.reasons || []).slice(0, 3)
  const label = p.title ? esc(p.title) : (rs.length ? rs.map(esc).join(' · ') : '待整理')
  const d = p.difficulty || 3

  const preview = txt
    ? `<div class="c-tex">${mdRender(previewMd(txt), { repairMath: true })}</div>`
    : q
      ? `<img class="c-thumb" data-img="${q.id}" data-kind="thumb" alt="">`
      : '<div class="c-empty">还没有截图</div>'

  const on = selMode() && sel.has(p.id)

  return `<article class="card ${p.id === S.problemId ? 'sel' : ''} ${selMode() ? 'pick' : ''} ${on ? 'on' : ''}" data-d="${d}" data-pid="${p.id}" draggable="${!selMode()}">
    ${selMode() ? `<span class="ckbox">${on ? '✓' : ''}</span>` : ''}
    <div class="c-h">
      <span class="c-id">#${pad(p.no || 0)}</span>
      <span class="c-kind ${p.kind === 'good' ? 'good' : ''}">${p.kind === 'good' ? '好题' : '错题'}</span>
      <span class="dots" data-d="${d}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= d ? 'f' : ''}"></i>`).join('')}</span>
      <div class="spacer"></div>
      ${p.starred ? '<span class="c-star">★</span>' : ''}
      <span class="mst" data-m="${p.mastery | 0}" title="${masteryLabel(p.mastery)}"></span>
    </div>
    ${preview}
    <div class="c-b">
      <div class="c-t ${p.title ? '' : 'dim'}">${label}</div>
      <div class="c-m">
        ${p.chapterId ? `<span class="tag">${esc(chName(p.chapterId))}</span>` : ''}
        ${(p.topics || []).slice(0, 2).map(t => `<span class="tag k">${esc(t)}</span>`).join('')}
        ${p.images.some(i => i.slot === 'a') ? '' : '<span class="tag r">缺解析</span>'}
        <span class="date">${fmtD(p.createdAt).slice(5)}</span>
      </div>
    </div></article>`
}

export function renderList () {
  const b = BOOK()
  $('#crumb').innerHTML = !b
    ? ''
    : `<b>${esc(b.name)}</b>${S.chapterId !== null ? `<span class="sl">/</span>${esc(S.chapterId === '' ? '未归类' : chName(S.chapterId))}` : ''}`

  const arr = filtered()
  $('#listCount').textContent = arr.length ? arr.length + ' 题' : ''
  $('#selBar').innerHTML = selBarHTML()

  const box = $('#cards')
  box.className = 'grid ' + (S.size === 'md' ? '' : S.size)

  if (!b) {
    box.className = ''
    box.innerHTML = `<div class="empty" style="height:60vh">
      <div class="k">先建一本书</div>
      <div class="s">一本书对应一套题集，比如《高等数学 上册》《线代 期末真题》。<br>建好后按 <kbd>Ctrl</kbd>+<kbd>V</kbd> 粘贴截图就能录题。</div>
      <button class="btn primary" data-newbook style="margin-top:6px">＋ 新建书籍</button></div>`
    return
  }

  if (!arr.length) {
    box.className = ''
    const f = isFiltering()
    box.innerHTML = `<div class="empty" style="height:56vh">
      <div class="k">${f ? '没有符合条件的题' : '这里还是空的'}</div>
      <div class="s">${f
        ? '换个筛选条件试试，或点左栏「清除」。'
        : '在 PDF 里截好图，直接按 <kbd>Ctrl</kbd>+<kbd>V</kbd> 粘贴，会自动新建一道题。<br>也可以把图片文件拖进来，支持一次拖多张。'}</div></div>`
    return
  }

  box.innerHTML = arr.map(cardHTML).join('')
  hydrate(box)
}

on('render:list', renderList)
