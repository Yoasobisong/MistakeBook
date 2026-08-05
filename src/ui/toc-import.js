/**
 * 从目录批量建章节。
 *
 * 两种入口：直接粘目录文本，或粘目录截图让视觉模型转成文本。
 * 解析走本地正则（免费、瞬时），结果不理想再点「AI 重排」。
 */
import { esc } from '../core/dom.js'
import { S } from '../core/state.js'
import { BOOK } from '../core/selectors.js'
import { createChapter } from '../storage/repo.js'
import { blobForVision } from '../storage/images.js'
import { parseTOC, toTree } from '../ai/toc.js'
import { chat } from '../ai/client.js'
import { isConfigured } from '../ai/config.js'
import { EXTRACT_SYS } from '../ai/prompts.js'
import { modal } from './modal.js'
import { toast } from './toast.js'
import { renderAll } from './render.js'

const TOC_HINT = `第1讲 函数极限与连续..............48
第2讲 数列极限....................123
第3讲 一元函数微分学的概念........146

直接从 PDF 目录页复制粘贴即可，页码和点导线会自动剥掉。
也可以把目录截图粘进来（Ctrl+V），让视觉模型转成文字。`

/** 预览树。缩进用 padding 表示层级，每行可删 */
function previewHTML (flat) {
  if (!flat.length) return '<div class="toc-empty">还没有内容</div>'
  const tree = toTree(flat)
  let i = -1
  const walk = nodes => nodes.map(n => {
    i++
    return `<div class="toc-row" data-ix="${i}" style="padding-left:${8 + n.depth * 18}px">
      <span class="lv">L${n.depth + 1}</span>
      <span class="tt">${esc(n.title)}</span>
      <button class="x" data-tocdel="${i}" title="不要这一条">✕</button>
    </div>${walk(n.children)}`
  }).join('')
  return walk(tree)
}

function repaint (wrap, flat) {
  wrap.querySelector('[data-tocpreview]').innerHTML = previewHTML(flat)
  wrap.querySelector('[data-toccount]').textContent =
    flat.length ? `将建立 ${flat.length} 个章节` : '还没有解析出内容'
}

/**
 * 当前打开的导入会话。
 * 粘贴图片是从 main.js 的全局 paste 里进来的，拿不到 modal 闭包，
 * 所以把 wrap 和 flat 提到模块级共享，否则识别结果会写进另一个数组里丢掉。
 */
let session = null

/** 视觉模型读目录截图 */
async function extractFromImage (blob) {
  if (!session) return
  if (!isConfigured('extract')) { toast('提取槽还没配模型', '设置 → AI'); return }

  const { wrap, flat } = session
  const status = wrap.querySelector('[data-tocstatus]')
  if (status) status.textContent = '正在识别目录截图…'

  const dataURL = await blobForVision(blob)
  const r = await chat('extract', [
    { role: 'system', content: EXTRACT_SYS },
    {
      role: 'user',
      content: [
        { type: 'text', text: '这是一本教材的目录页。请逐行转录出目录条目，保留原有的编号与缩进层次。不要转录页码。每条一行，不要加任何解释。' },
        { type: 'image_url', image_url: { url: dataURL } }
      ]
    }
  ], { temperature: 0.1 })

  // 识别期间弹窗可能已经被关掉了
  if (!session || !wrap.isConnected) return
  if (!r.ok) { if (status) status.textContent = '识别失败：' + r.error; return }

  const ta = wrap.querySelector('[data-tocinput]')
  ta.value = (ta.value ? ta.value + '\n' : '') + r.text.trim()
  if (status) status.textContent = ''
  flat.length = 0
  flat.push(...parseTOC(ta.value))
  repaint(wrap, flat)
}

export async function tocImportFlow () {
  if (!BOOK()) { toast('先选一本书'); return }

  const flat = []

  const dialog = modal({
    title: '从目录建章节',
    okText: '建立章节',
    wide: true,
    noEnter: true,
    body: `
      <div class="toc-wrap">
        <div class="toc-left">
          <label class="fld">目录内容</label>
          <textarea class="toc-input" data-tocinput placeholder="${esc(TOC_HINT)}"></textarea>
          <div class="toc-bar">
            <button class="btn sm" data-tocact="parse">解析</button>
            <button class="btn sm" data-tocact="clear">清空</button>
            <span class="toc-status" data-tocstatus></span>
          </div>
        </div>
        <div class="toc-right">
          <label class="fld" data-toccount>还没有解析出内容</label>
          <div class="toc-preview" data-tocpreview><div class="toc-empty">左边粘贴目录后点「解析」</div></div>
        </div>
      </div>`,

    onClick: (t, wrap) => {
      const act = t.closest('[data-tocact]')
      if (act) {
        const ta = wrap.querySelector('[data-tocinput]')
        if (act.dataset.tocact === 'clear') {
          ta.value = ''
          flat.length = 0
        } else {
          flat.length = 0
          flat.push(...parseTOC(ta.value))
        }
        repaint(wrap, flat)
        return true
      }

      const del = t.closest('[data-tocdel]')
      if (del) {
        flat.splice(+del.dataset.tocdel, 1)
        repaint(wrap, flat)
        return true
      }
      return false
    },

    onOk: () => (flat.length ? flat.slice() : null)
  })

  // 弹窗此刻已经进 DOM 了，立刻建立会话 —— 用户很可能一打开就直接粘图
  const wrap = document.querySelector('.toc-wrap')?.closest('.mask')
  if (wrap) session = { wrap, flat }

  const result = await dialog
  session = null
  if (!result || !result.length) return

  toast('正在建立章节…', result.length + ' 个')
  const idByDepth = {}
  let n = 0
  for (const item of result) {
    const parent = item.depth > 0 ? (idByDepth[item.depth - 1] || null) : null
    const c = await createChapter(S.bookId, parent, item.title)
    if (!c) continue
    idByDepth[item.depth] = c.id
    // 建深一层的节点时不能再挂到已经失效的更深层父节点上
    for (const k of Object.keys(idByDepth)) if (+k > item.depth) delete idByDepth[k]
    n++
  }

  renderAll()
  toast('已建立 ' + n + ' 个章节', '接下来录题会自动归类到这里')
}

/** 供 main.js 在粘贴时调用：目录弹窗开着就把图片截走 */
export function tocPasteImage (blob) {
  if (!session) return false
  extractFromImage(blob)
  return true
}
