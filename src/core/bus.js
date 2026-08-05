/**
 * 极简事件总线。
 *
 * 存在的唯一理由：打断 UI 模块之间的循环依赖。
 * 比如改了章节归属，tree 需要触发 list 重画；而 list 点卡片又要触发 detail 打开。
 * 若各模块直接 import 对方的渲染函数就会成环，改走事件即可保持单向。
 *
 * 约定中的事件：
 *   render:topbar | render:tree | render:filters | render:list | render:detail | render:side | render:stats
 *   problem:open  (id)      打开某道题的详情
 *   view:go       (name)    切换 list / detail / stats
 *   ai:progress   (state)   任务队列进度变化
 */

const map = new Map()

export function on (evt, fn) {
  let set = map.get(evt)
  if (!set) map.set(evt, set = new Set())
  set.add(fn)
  return () => off(evt, fn)
}

export function off (evt, fn) {
  map.get(evt)?.delete(fn)
}

/** 单个监听器抛错不应中断其它监听器 */
export function emit (evt, ...args) {
  const set = map.get(evt)
  if (!set) return
  for (const fn of Array.from(set)) {
    try { fn(...args) } catch (e) { console.error('[bus]', evt, e) }
  }
}
