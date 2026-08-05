/**
 * 轻量 Markdown 渲染 + KaTeX 排版。
 *
 * 刻意不引 markdown-it 之类的完整实现：批注只用到标题、列表、引用、
 * 粗斜体、行内码、==高亮== 和公式，自己写一版体积小且行为可控。
 *
 * 关键顺序：先把 $...$ / $$...$$ 抠出来占位，再做 HTML 转义，
 * 最后把公式原样放回 —— 否则 \frac{a}{b} 里的字符会被转义掉。
 */
import renderMathInElement from 'katex/contrib/auto-render'
import 'katex/dist/katex.min.css'
import { esc } from './dom.js'

const PH = '' // 公式占位符，正文里不可能出现

/**
 * 四种定界符都要认。
 * 应用自己写的是 $ / $$，但大模型习惯输出 LaTeX 标准的 \( \) 与 \[ \]，
 * 两套都得支持，否则同一份内容时而渲染、时而裸奔。
 * 顺序不能改：长的必须排在短的前面。
 */
const MATH_RE = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$/g

/** 围栏代码块。必须比行内码先处理，否则行内码正则会从第三个反引号一路吃到文末 */
const FENCE_RE = /```[a-zA-Z0-9+-]*[ \t]*\r?\n([\s\S]*?)```/g

export function mdRender (src) {
  if (!src || !src.trim()) return ''

  // 抠出来的片段先存好，等 HTML 转义和分行都做完再原样放回
  const held = []
  const keep = html => { held.push(html); return PH + (held.length - 1) + PH }

  let s = String(src)
    .replace(FENCE_RE, (_, body) => keep('<pre><code>' + esc(body) + '</code></pre>'))
    .replace(MATH_RE, m => keep(esc(m)))

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
    } else if ((m = t.match(/^\d+[.)]\s+(.*)$/))) {
      flushP()
      if (list !== 'ol') { flushL(); out.push('<ol>'); list = 'ol' }
      out.push('<li>' + m[1] + '</li>')
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

/** 就地把元素里的公式渲染出来，四种定界符都认 */
export function typeset (el) {
  if (!el) return
  try {
    renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false }
      ],
      // 中文题干里的「$」不会成对出现，忽略即可，别整段报红
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      throwOnError: false,
      errorColor: '#BE3A32'
    })
  } catch (e) {
    console.warn('[katex]', e)
  }
}
