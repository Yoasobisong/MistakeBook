/**
 * 渲染协调器。
 *
 * 各 UI 模块通过 bus 注册自己的渲染函数，其它模块只调用这里的 render()，
 * 从而不必互相 import —— 这是打断 UI 层循环依赖的关键。
 */
import { $ } from '../core/dom.js'
import { emit } from '../core/bus.js'
import { S } from '../core/state.js'

/** 切换主视图：list / detail / stats */
export function go (v) {
  S.view = v
  $('#viewList').classList.toggle('hidden', v !== 'list')
  $('#viewDetail').classList.toggle('hidden', v !== 'detail')
  $('#viewStats').classList.toggle('hidden', v !== 'stats')
}

/** render('list','tree') —— 触发指定部分重画 */
export const render = (...parts) => parts.forEach(p => emit('render:' + p))

export const renderAll = () => render('topbar', 'tree', 'filters', 'list', 'detail')

/** 打开某题详情（由 detail.js 监听） */
export const openProblem = id => emit('problem:open', id)
