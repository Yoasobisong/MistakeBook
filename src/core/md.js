/**
 * 轻量 Markdown 渲染 + KaTeX 排版。
 *
 * 刻意不引 markdown-it 之类的完整实现：批注只用到标题、列表、引用、
 * 粗斜体、行内码、==高亮== 和公式，自己写一版体积小且行为可控。
 *
 * 关键顺序：先把公式和代码块抠出来占位，再做 HTML 转义与分行，最后放回。
 * 少了这一步会出两种问题：\frac{a}{b} 里的字符被转义、
 * 多行的 \begin{cases} 被按行拆开塞进 <br> 导致 KaTeX 解析失败。
 *
 * 公式在这里就渲染成 HTML 字符串，不再依赖事后扫描 DOM ——
 * 那种做法每次重画都要把整个列表的公式重排一遍，几百张卡片时会明显卡顿。
 * 渲染成字符串之后 mdRender 是纯函数，可以直接按源文本缓存。
 */
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { esc } from './dom.js'

/** 占位符用私有区字符，正文里不可能出现。写成转义形式，避免编辑器把它吃掉 */
const PH = ''

/**
 * 四种定界符都要认。
 * 应用自己写的是 $ / $$，但大模型习惯输出 LaTeX 标准的 \( \) 与 \[ \]，
 * 两套都得支持，否则同一份内容时而渲染、时而裸奔。
 * 顺序不能改：长的必须排在短的前面。
 *
 * 单 $ 分支必须允许跨行：分段函数、矩阵这类 \begin{matrix}...\end{matrix}
 * 模型就是用单 $ 包起来、内部照常换行的，卡死在一行等于整段公式裸奔。
 * 但也不能放任 [\s\S] —— 正文里一个落单的 $ 会一路吃到下一个 $，
 * 所以用两条缰绳勒住：遇到空行（段落边界）就断，且最长 800 字符。
 */
const MATH_RE = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?:[^$\n]|\n(?![ \t]*\n)){1,800}?\$/g

/** 围栏代码块。必须比行内码先处理，否则行内码正则会从第三个反引号一路吃到文末 */
const FENCE_RE = /```[a-zA-Z0-9+-]*[ \t]*\r?\n([\s\S]*?)```/g

/** 剥掉定界符，顺带判断是行内还是独立成行 */
function renderMath (raw) {
  let body
  let display = false

  if (raw.startsWith('$$')) {
    body = raw.slice(2, -2)
    display = true
  } else if (raw.startsWith('\\[')) {
    body = raw.slice(2, -2)
    display = true
  } else if (raw.startsWith('\\(')) {
    body = raw.slice(2, -2)
  } else {
    body = raw.slice(1, -1)
  }

  try {
    return katex.renderToString(body.trim(), {
      displayMode: display,
      throwOnError: false,
      errorColor: '#BE3A32',
      strict: false
    })
  } catch (_) {
    // 连 throwOnError:false 都拦不住的输入，原样显示也比整段崩掉强
    return esc(raw)
  }
}

/**
 * 渲染结果缓存。键就是源文本 —— mdRender 是纯函数，同样输入必然同样输出。
 * 列表页反复重画（每敲一个搜索字符就重画一次）时，
 * 这个缓存把 KaTeX 的开销压到只有首次。
 */
const cache = new Map()
const CACHE_MAX = 600

export function mdRender (src) {
  if (!src || !src.trim()) return ''

  const hit = cache.get(src)
  if (hit !== undefined) return hit

  const html = build(src)

  // 超量就丢掉最早插入的四分之一。Map 天然保持插入顺序，够用了
  if (cache.size >= CACHE_MAX) {
    let i = 0
    for (const k of cache.keys()) {
      cache.delete(k)
      if (++i >= CACHE_MAX / 4) break
    }
  }
  cache.set(src, html)
  return html
}

function build (src) {
  // 抠出来的片段先存好，等 HTML 转义和分行都做完再原样放回
  const held = []
  const keep = html => { held.push(html); return PH + (held.length - 1) + PH }

  let s = String(src)
    .replace(FENCE_RE, (_, body) => keep('<pre><code>' + esc(body) + '</code></pre>'))
    .replace(MATH_RE, m => keep(renderMath(m)))

  s = esc(s)

  const lines = s.split(/\r?\n/)
  const out = []
  let list = null
  let para = []
  const flushP = () => { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = [] } }
  const flushL = () => { if (list) { out.push('</' + list + '>'); list = null } }

  for (const ln of lines) {
    const t = ln.trim()
    if (!t) { flushP(); flushL(); continue }
    let m
    if ((m = t.match(/^#{1,4}\s+(.*)$/))) {
      flushP(); flushL(); out.push('<h4>' + m[1] + '</h4>')
    } else if (/^(---|\*\*\*)$/.test(t)) {
      flushP(); flushL(); out.push('<hr>')
    } else if ((m = t.match(/^&gt;\s?(.*)$/))) {
      flushP(); flushL(); out.push('<blockquote>' + m[1] + '</blockquote>')
    } else if ((m = t.match(/^[-*]\s+(.*)$/))) {
      flushP()
      if (list !== 'ul') { flushL(); out.push('<ul>'); list = 'ul' }
      out.push('<li>' + m[1] + '</li>')
    } else if ((m = t.match(/^(\d+)[.)]\s+(.*)$/))) {
      flushP()
      if (list !== 'ol') { flushL(); out.push('<ol>'); list = 'ol' }
      // 序号必须原样保留：这里的数字是题号（「7.」就该显示 7），
      // 而 <ol> 的自动编号永远从 1 数起，第 7 题会显示成第 1 题。
      // 用 <li value> 把真实题号钉死，跳号的题（7. 接 9.）也不会被改写。
      out.push('<li value="' + m[1] + '">' + m[2] + '</li>')
    } else {
      flushL(); para.push(t)
    }
  }
  flushP(); flushL()

  let html = out.join('')
  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    // 不能跨行：否则一个落单的反引号会把后面整篇文档都吞进 <code>
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')

  return html.replace(new RegExp(PH + '(\\d+)' + PH, 'g'), (_, i) => held[+i] ?? '')
}

/** 内容被外部改写（导入备份、清库）后调用，避免缓存留着旧结果 */
export const clearMdCache = () => cache.clear()
