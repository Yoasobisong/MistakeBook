/**
 * md.js 渲染规则的快速自检（临时脚本，验证完可删）。
 *
 * md.js 本身 import 了 katex 和它的 CSS，plain node 跑不起来，
 * 所以这里复制了同样的规则实现。改了 md.js 记得同步过来，
 * 它验的是「算法对不对」，不是「md.js 里那份对不对」。
 *
 *   node scripts/md-check.mjs
 */

/* ---------- 复制自 md.js ---------- */

const MATH_RE = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?:[^$\n]|\n(?![ \t]*\n)){1,800}?\$/g
const LIST_RE = /^(\d+)[.)]\s+(.*)$/

function isCJK (ch) {
  const c = ch.charCodeAt(0)
  return (c >= 0x3000 && c <= 0x303F) ||
         (c >= 0x3400 && c <= 0x4DBF) ||
         (c >= 0x4E00 && c <= 0x9FFF) ||
         (c >= 0xFF00 && c <= 0xFFEF)
}

const MATHY_RE = /\\[a-zA-Z]+|[\^_]\{|[\^_][A-Za-z0-9]/
const HAS_DELIM_RE = /\$|\\\(|\\\[/

function wrapRun (s) {
  if (!MATHY_RE.test(s)) return s
  let a = 0
  let b = s.length
  while (a < b && /[\s,;:]/.test(s[a])) a++
  while (b > a && /[\s,;:.]/.test(s[b - 1])) b--
  const core = s.slice(a, b)
  if (!core || !MATHY_RE.test(core)) return s
  return s.slice(0, a) + '$' + core + '$' + s.slice(b)
}

function repairLine (line) {
  if (/^\s*\[图/.test(line) || /^\s*\|/.test(line)) return line
  let out = ''
  let buf = ''
  for (const ch of line) {
    if (isCJK(ch)) { out += wrapRun(buf) + ch; buf = '' } else buf += ch
  }
  return out + wrapRun(buf)
}

function repairMath (src) {
  const s = String(src || '')
  if (HAS_DELIM_RE.test(s) || !MATHY_RE.test(s)) return s
  let fence = false
  return s.split('\n').map(line => {
    if (/^\s*```/.test(line)) { fence = !fence; return line }
    return fence ? line : repairLine(line)
  }).join('\n')
}

/* ---------- 用例 ---------- */

let pass = 0
let fail = 0

function check (name, got, want) {
  const ok = got === want
  ok ? pass++ : fail++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`)
  if (!ok) {
    console.log(`        实际: ${JSON.stringify(got)}`)
    console.log(`        期望: ${JSON.stringify(want)}`)
  }
}

console.log('\n===== 一、跨行公式必须能匹配 =====')
const matrix = `6.【答案】$\\left\\{\\begin{matrix}
x^{3},&x>1,\\\\
1,&-1\\leqslant x\\leqslant1,\\\\
-x^{3},&x<-1
\\end{matrix}\\right.$`
check('跨行矩阵匹配成 1 段', (matrix.match(MATH_RE) || []).length, 1)
check('一行多个公式各自配对', ('设 $a$ 与 $b$ 满足 $a+b=1$'.match(MATH_RE) || []).length, 3)
check('$$ 独立公式', ('$$\\int_0^1 x dx$$'.match(MATH_RE) || []).length, 1)
check('标准 \\[ \\]', ('\\[x^2+y^2=1\\]'.match(MATH_RE) || []).length, 1)
check('落单 $ 跨段落不该被吞',
  ('价格是 $5 元。\n\n下一段还有 $3 元。'.match(MATH_RE) || []).length, 0)

console.log('\n===== 二、题号不能被 <ol> 重编号 =====')
const li = s => { const m = s.match(LIST_RE); return m ? `<li value="${m[1]}">` : '普通段落' }
check('7. → value=7', li('7. 设数列满足'), '<li value="7">')
check('10) → value=10', li('10) 第十题'), '<li value="10">')
check('1.7. 不是列表', li('1.7. 设数列'), '普通段落')
check('6.【答案】不是列表', li('6.【答案】前缀'), '普通段落')
check('(A) 不是列表', li('(A) 单调不减'), '普通段落')

console.log('\n===== 三、缺 $ 定界符的兜底修复 =====')
check('本次报的那道解析',
  repairMath('10.【解析】e^{b_n}-e^{a_n}=a_n>0, 又 e^x 为单调递增函数, 故\\lim_{n \\to \\infty}b_n=0.'),
  '10.【解析】$e^{b_n}-e^{a_n}=a_n>0$, 又 $e^x$ 为单调递增函数, 故 $\\lim_{n \\to \\infty}b_n=0$.')
check('已经有 $ 的一律不碰',
  repairMath('当 $x>1$ 时 e^x 递增'), '当 $x>1$ 时 e^x 递增')
check('纯中文不动', repairMath('这道题考察夹逼准则'), '这道题考察夹逼准则')
check('题号 10. 不该被包起来',
  repairMath('10. 又 a_n>0'), '10. 又 $a_n>0$')
check('[图：…] 描述整行放过',
  repairMath('[图：直角三角形 ABC，∠C=90，AC=3]\nx^2 递增'),
  '[图：直角三角形 ABC，∠C=90，AC=3]\n$x^2$ 递增')
check('表格行放过',
  repairMath('| a_1 | b_1 |'), '| a_1 | b_1 |')

console.log(`\n===== ${pass} 通过 · ${fail} 失败 =====\n`)
process.exit(fail ? 1 : 0)
