/** 打印 / 导出 PDF：把题目重排成 A4 版式塞进隐藏的 #printRoot */
import { $, $$, esc, waitImages } from '../core/dom.js'
import { fmtD, bytes, pad, today } from '../core/fmt.js'
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
        <div class="mt-l" style="margin-bottom:6px">用途</div>
        <label style="display:block;margin-bottom:4px"><input type="radio" name="md" value="normal" checked> 复习本<span style="color:var(--ink3)">（连续排版，可带解析与批注）</span></label>
        <label style="display:block;margin-bottom:10px"><input type="radio" name="md" value="book"> 做题本<span style="color:var(--ink3)">（横向 · 一题一页 · 只留题干，空白处直接做）</span></label>

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
        <div style="font-size:12px;color:var(--ink3);margin-top:5px">选了「做题本」时这两项自动关闭。</div>
      </div>
      <div style="margin-top:12px;font-size:12px;color:var(--ink3);line-height:1.8">
        ${window.native?.print
          ? '接下来会让你选保存位置，直接生成 PDF —— 不经过打印对话框，纸张方向由程序设定。'
          : '接下来会打开系统打印窗口。想存成 PDF，把「目标打印机」选成 <b>另存为 PDF</b>；<br>选了「做题本」记得把<b>布局改成横向</b>，浏览器里的对话框设置会盖过程序的设定。'}</div>`,
    onOk: w => {
      const mode = w.querySelector('[name=md]:checked').value
      const book = mode === 'book'
      return {
        mode,
        scope: w.querySelector('[name=sc]:checked').value,
        format: w.querySelector('[name=fm]:checked').value,
        // 做题本就是拿来做的，带上答案和批注等于白印
        ans: book ? false : w.querySelector('[name=ans]').checked,
        note: book ? false : w.querySelector('[name=note]').checked
      }
    }
  })
}

/**
 * 临时覆盖 @page 规则，打印完撤掉。
 *
 * @page 是 at-rule，没法用类名限定作用域，只能整条插进 <head>；
 * 它比 print.css 晚进文档，同优先级下后来者胜。
 * 刻意不套 @media print —— @page 本来就只对分页媒体生效，
 * 顶层声明是规范写法，嵌套形式在部分引擎里会被忽略。
 */
function setPageCSS (css) {
  document.getElementById('prPage')?.remove()
  if (!css) return
  const st = document.createElement('style')
  st.id = 'prPage'
  st.textContent = css
  document.head.appendChild(st)
}

/** 导出的默认文件名 */
function pdfName (b, one, book) {
  const base = b ? b.name : '错题本'
  return one
    ? `${base}_第${pad(one.no)}题`
    : `${base}_${book ? '做题本' : '复习本'}_${today()}`
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

  let opt = { mode: 'normal', scope: 'filter', format: 'text', ans: true, note: true }
  if (!single) {
    const r = await askOptions()
    if (!r) return
    opt = r
  }
  const book = opt.mode === 'book'

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

  // 哨兵值必须是 ck 取不到的东西：ck 恒为字符串（chapterId || ''），
  // 用 '' 的话「未归类」排在首位时会被判成「和上一组相同」，标题就不输出了
  let curCh = null
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
      ${book ? '' : slotBody(x, 'x', opt)}
      ${(x.reasons || []).length || (x.topics || []).length
        ? `<div class="pr-tags">${(x.reasons || []).length ? '错因：' + x.reasons.map(esc).join(' · ') : ''}${
            (x.topics || []).length ? (x.reasons || []).length ? '　知识点：' + x.topics.map(esc).join(' · ') : '知识点：' + x.topics.map(esc).join(' · ') : ''}</div>`
        : ''}
      ${opt.ans && hasAnswer ? '<div class="pr-sep">— 解析 —</div>' + slotBody(x, 'a', opt) : ''}
      ${opt.note && x.note ? `<div class="pr-note">${mdRender(x.note)}</div>` : ''}
    </div>`
  }

  const root = $('#printRoot')
  root.className = book ? 'pr-book' : ''
  root.innerHTML = h
  await hydrate(root)
  await waitImages($$('img', root))

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    root.innerHTML = ''
    root.className = ''
    setPageCSS(null)
  }

  /* ---------- 桌面版：直接生成 PDF，不经过打印对话框 ----------
     对话框里的「布局」下拉框决定纸张框，优先级高于 CSS 的 @page size，
     所以走那条路会出现「内容横排、纸还是竖的」。printToPDF 由代码指定方向。

     纸张和边距全部交给 printToPDF，CSS 这边必须让位 ——
     留着 print.css 里那条 @page{size:A4} 会和 API 的 landscape 打架。 */
  if (window.native?.print) {
    setPageCSS('@page{size:auto;margin:0}')
    // 等一帧，确保刚插入的 DOM 和样式都已经生效再去渲染
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

    const r = await window.native.print.toPDF({
      landscape: book,
      margin: book ? 12 : 14,
      name: pdfName(b, single ? p : null, book)
    })
    cleanup()

    if (r.canceled) return
    if (!r.ok) { toast('导出失败', (r.error || '').slice(0, 50)); return }
    toast('已导出 PDF', bytes(r.size))
    return
  }

  /* ---------- 浏览器：只能走打印对话框 ---------- */
  setPageCSS(book ? '@page{size:A4 landscape;margin:12mm}' : null)
  // 靠 afterprint 而不是定时器：window.print() 未必阻塞，
  // 盲等固定毫秒数可能在预览还开着时就把样式撤走
  window.addEventListener('afterprint', cleanup, { once: true })
  setTimeout(() => {
    window.print()
    setTimeout(cleanup, 60000) // 兜底：万一不发 afterprint
  }, 260)
}
