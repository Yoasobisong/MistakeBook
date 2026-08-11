/** 打印 / 导出 PDF：把题目重排成 A4 版式塞进隐藏的 #printRoot */
import { $, $$, esc, waitImages } from '../core/dom.js'
import { fmtD, pad, today } from '../core/fmt.js'
import { S } from '../core/state.js'
import { MASTERY } from '../core/consts.js'
import { BOOK, PROB, bookProblems, chName, chTree, descendants, filtered } from '../core/selectors.js'
import { mdRender } from '../core/md.js'
import { hydrate } from '../storage/images.js'
import { modal } from './modal.js'
import { toast } from './toast.js'

const masteryLabel = v => (MASTERY[v | 0] || MASTERY[0]).t

async function askOptions () {
  return modal({
    title: '导出打印版',
    okText: '生成并打印',
    wide: true,
    body: `
      <div style="font-size:13px;color:var(--ink2);line-height:1.9">
        <div class="mt-l" style="margin-bottom:6px">范围</div>
        <label style="display:block;margin-bottom:4px"><input type="radio" name="sc" value="filter" checked> 当前列表（含筛选与搜索结果，${filtered().length} 题）</label>
        <label style="display:block;margin-bottom:4px"><input type="radio" name="sc" value="chapter"> 当前章节</label>
        <label style="display:block;margin-bottom:10px"><input type="radio" name="sc" value="book"> 整本书</label>

        <div class="mt-l" style="margin-bottom:6px">版式</div>
        <label style="display:block;margin-bottom:4px"><input type="radio" name="fm" value="text" checked> 文字版<span style="color:var(--ink3)">（用提取出的 LaTeX 排版，可选中、可搜索、体积小；没提取过的题自动回退到截图）</span></label>
        <label style="display:block;margin-bottom:10px"><input type="radio" name="fm" value="img"> 截图版<span style="color:var(--ink3)">（原样保留排版）</span></label>

        <div class="mt-l" style="margin-bottom:6px">内容</div>
        <label style="display:block"><input type="checkbox" name="ans" checked> 包含答案解析<span style="color:var(--ink3)">（取消勾选＝生成一份纯练习卷）</span></label>
        <label style="display:block"><input type="checkbox" name="note" checked> 包含批注</label>
      </div>
      <div style="margin-top:12px;font-size:12px;color:var(--ink3);line-height:1.8">
        接下来会打开系统打印窗口。想存成 PDF，把「目标打印机」选成 <b>另存为 PDF</b> 即可。</div>`,
    onOk: w => ({
      scope: w.querySelector('[name=sc]:checked').value,
      format: w.querySelector('[name=fm]:checked').value,
      ans: w.querySelector('[name=ans]').checked,
      note: w.querySelector('[name=note]').checked
    })
  })
}

function collect (single, opt) {
  if (single) return [PROB()]
  if (opt.scope === 'book') return bookProblems()
  if (opt.scope === 'chapter') {
    const set = S.chapterId ? descendants(S.chapterId) : null
    return bookProblems().filter(x =>
      S.chapterId === '' ? !x.chapterId : (!set || set.includes(x.chapterId)))
  }
  return filtered()
}

/**
 * 渲染一个槽位。
 * 文字版优先，但只在真的提取过的槽位上生效 ——
 * 没提取过的题目回退到截图，不能让它在打印稿里变成一片空白。
 */
function slotBody (x, slotKey, opt) {
  const txt = (x.latex?.[slotKey] || '').trim()
  if (opt.format === 'text' && txt) return `<div class="pr-tex">${mdRender(txt, { repairMath: true })}</div>`
  return x.images
    .filter(im => im.slot === slotKey)
    .map(im => `<img data-img="${im.id}" data-kind="full">`)
    .join('')
}

export async function printFlow (single) {
  const p = single ? PROB() : null
  if (single && !p) return

  let opt = { scope: 'filter', format: 'text', ans: true, note: true }
  if (!single) {
    const r = await askOptions()
    if (!r) return
    opt = r
  }

  let list = collect(single, opt)
  if (!list.length) { toast('没有可导出的题'); return }
  toast('正在生成…', list.length + ' 题')

  // 按章节顺序排，未归类沉底
  const order = chTree(S.bookId).map(x => x.c.id)
  const rank = cid => { const i = order.indexOf(cid); return i < 0 ? 9e9 : i }
  list = list.slice().sort((x, y) => rank(x.chapterId) - rank(y.chapterId) || x.no - y.no)

  const b = BOOK()
  let h = `<div class="pr-head"><h1>${esc(b ? b.name : '错题本')}${single ? ' · 第 ' + pad(p.no) + ' 题' : ''}</h1>
    <div class="m">${list.length} 题 · 导出于 ${today()}${opt.ans ? '' : ' · 练习卷（未含解析）'}</div></div>`

  let curCh = ''
  for (const x of list) {
    const ck = x.chapterId || ''
    if (!single && ck !== curCh) {
      curCh = ck
      h += `<div class="pr-ch">${esc(ck ? chName(ck) : '未归类')}</div>`
    }
    const hasAnswer = x.images.some(im => im.slot === 'a') || (x.latex?.a || '').trim()

    h += `<div class="pr-item">
      <div class="pr-t"><span class="n">${pad(x.no)}</span>
        <span>${esc(x.title || '')}</span>
        <span class="d">难度 ${x.difficulty || 3} · ${masteryLabel(x.mastery)}${x.source ? ' · ' + esc(x.source) : ''} · ${fmtD(x.createdAt)}</span></div>
      ${slotBody(x, 'q', opt)}
      ${slotBody(x, 'x', opt)}
      ${(x.reasons || []).length || (x.topics || []).length
        ? `<div class="pr-tags">${(x.reasons || []).length ? '错因：' + x.reasons.map(esc).join(' · ') : ''}${
            (x.topics || []).length ? (x.reasons || []).length ? '　知识点：' + x.topics.map(esc).join(' · ') : '知识点：' + x.topics.map(esc).join(' · ') : ''}</div>`
        : ''}
      ${opt.ans && hasAnswer ? '<div class="pr-sep">— 解析 —</div>' + slotBody(x, 'a', opt) : ''}
      ${opt.note && x.note ? `<div class="pr-note">${mdRender(x.note)}</div>` : ''}
    </div>`
  }

  const root = $('#printRoot')
  root.innerHTML = h
  await hydrate(root)
  await waitImages($$('img', root))

  setTimeout(() => {
    window.print()
    setTimeout(() => { root.innerHTML = '' }, 800)
  }, 260)
}
