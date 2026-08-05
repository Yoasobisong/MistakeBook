/** 业务预设常量 */

export const REASONS = [
  '概念不清', '公式记错', '计算失误', '审题不清', '思路卡壳',
  '方法不熟', '条件遗漏', '步骤跳跃', '粗心笔误', '时间不够'
]

export const DIFF_LABEL = { 1: '很简单', 2: '较简单', 3: '中等', 4: '较难', 5: '很难' }

export const MASTERY = [
  { v: 0, t: '未掌握' },
  { v: 1, t: '半懂' },
  { v: 2, t: '已掌握' }
]

/** 一道题的三个图片槽位 */
export const SLOTS = [
  { k: 'q', nm: '题目', hint: '从 PDF 截图粘贴题干' },
  { k: 'a', nm: '答案解析', hint: '标准答案 / 解析截图' },
  { k: 'x', nm: '补充', hint: '相关知识点、同类题' }
]

export const SLOT_KEYS = SLOTS.map(s => s.k)
export const slotName = k => (SLOTS.find(s => s.k === k) || { nm: k }).nm

/** 批注编辑器的快捷片段 */
export const NOTE_SNIPS = [
  { t: '错因分析', v: '### 错因分析\n' },
  { t: '正解思路', v: '### 正解思路\n' },
  { t: '易错点', v: '### 易错点\n' },
  { t: '举一反三', v: '### 举一反三\n' },
  { t: '重点', v: '==重点==' },
  { t: '公式', v: '$$  $$' }
]
