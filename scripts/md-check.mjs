/**
 * md.js 渲染规则的快速自检（临时脚本，验证完可删）。
 * 只复制 md.js 里的两条正则，不引 katex，因此能直接 node 跑。
 */
const MATH_RE = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?:[^$\n]|\n(?![ \t]*\n)){1,800}?\$/g
const LIST_RE = /^(\d+)[.)]\s+(.*)$/

const cases = {
  '跨行矩阵（本次要修的）': `6.【答案】$\\left\\{\\begin{matrix}
x^{3},&x>1,\\\\
1,&-1\\leqslant x\\leqslant1,\\\\
-x^{3},&x<-1
\\end{matrix}\\right.$`,
  '普通行内': '当$x > 1$时, $\\lim_{n\\to\\infty}$ 收敛',
  '一行多个不粘连': '设 $a$ 与 $b$ 满足 $a+b=1$',
  'display $$': '$$\\int_0^1 x dx$$',
  '标准 \\[ \\]': '\\[x^2+y^2=1\\]',
  '落单 $ 跨段落（不该吞）': `价格是 $5 元。

下一段还有 $3 元。`
}

for (const [k, v] of Object.entries(cases)) {
  const hits = v.match(MATH_RE) || []
  console.log(`\n[${k}] 匹配 ${hits.length} 段`)
  hits.forEach(h => console.log('   >>> ' + JSON.stringify(h.length > 70 ? h.slice(0, 70) + '…' : h)))
}

console.log('\n===== 有序列表编号 =====')
for (const line of ['7. 设数列 $\\{x_n\\}$ 满足', '1.7. 设数列', '6.【答案】前缀', '10) 第十题', '(A) 单调不减']) {
  const m = line.match(LIST_RE)
  console.log(m ? `  "${line}"  ->  <li value="${m[1]}">${m[2]}</li>` : `  "${line}"  ->  普通段落（原样输出）`)
}
