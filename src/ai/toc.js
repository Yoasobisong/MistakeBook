/**
 * 目录解析：把一段目录文本切成带层级的章节列表。
 *
 * 先本地正则跑一遍 —— 绝大多数教材目录格式规整，正则瞬间出结果且不花 token。
 * 解析得不理想时界面上再提供「AI 重排」兜底。
 */

/** 剥掉尾部的点导线和页码：「第1讲 函数极限与连续......48」→「第1讲 函数极限与连续」 */
const stripPage = s => s
  .replace(/[.·．…\s]{2,}\s*\d+\s*$/, '')
  .replace(/\s+\d{1,4}\s*$/, '')
  .replace(/[.·．…]+\s*$/, '')
  .trim()

/**
 * 层级判定。
 * 顺序有讲究：先认「第N章/讲/部分」「附录N」这类顶层标记，
 * 再看 1.2.3 这种小节编号的点数，最后才退回缩进。
 */
function levelOf (raw, title) {
  if (/^(第\s*[0-9一二三四五六七八九十百]+\s*[章讲篇部单元]|附录|绪论|前言|序言|导论|总论)/.test(title)) return 0
  if (/^[Pp]art\s|^Chapter\s/i.test(title)) return 0

  const num = title.match(/^(\d+(?:\.\d+)+)/)
  if (num) return Math.min(3, num[1].split('.').length - 1)

  if (/^\d+[、.]\s*\D/.test(title)) return 1
  if (/^[（(]?[一二三四五六七八九十]+[）)、]/.test(title)) return 1
  if (/^[（(]\d+[）)]/.test(title)) return 2

  // 没有编号线索就看缩进，每 2 个空格算一级
  const indent = raw.match(/^[\s　]*/)[0].replace(/　/g, '  ').length
  return Math.min(3, Math.floor(indent / 2))
}

/**
 * @returns [{title, depth}]
 */
export function parseTOC (text) {
  const out = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const title = stripPage(raw)
    if (!title) continue
    // 纯页码行、纯符号行直接丢
    if (/^[\d\s.·．…—-]+$/.test(title)) continue
    if (title.length > 80) continue
    out.push({ title, depth: levelOf(raw, title) })
  }

  // 首层不一定从 0 开始（比如整份目录都缩进了），整体抬平
  const min = out.reduce((m, x) => Math.min(m, x.depth), 9)
  if (min > 0 && min < 9) out.forEach(x => { x.depth -= min })

  // 层级不能跳着涨：0 之后直接冒出 2 会导致建树时找不到父节点
  let prev = -1
  for (const x of out) {
    if (x.depth > prev + 1) x.depth = prev + 1
    prev = x.depth
  }
  return out
}

/** 扁平列表转嵌套，仅用于预览 */
export function toTree (flat) {
  const roots = []
  const stack = []
  for (const item of flat) {
    const node = { ...item, children: [] }
    while (stack.length > node.depth) stack.pop()
    if (!stack.length) roots.push(node)
    else stack[stack.length - 1].children.push(node)
    stack.push(node)
  }
  return roots
}
