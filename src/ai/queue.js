/**
 * AI 任务队列。
 *
 * 存在的理由很实际：本地 7B 视觉模型处理一张图要几十秒，
 * 录完一批题后一张张点会疯；而并发跑本地模型又会把显存打爆。
 * 所以默认串行（concurrency=1），云端模型可以调高。
 *
 * 进度通过 bus 的 ai:progress 事件推给顶栏。
 */
import { emit } from '../core/bus.js'
import { S } from '../core/state.js'
import { abort as abortRequest } from './client.js'

const pending = []
const inflight = new Set() // 正在跑的请求 id，取消时用
let running = 0
let total = 0
let done = 0
let failed = 0
let label = ''
let cancelled = false

/** 跑完之后让完成态多停一会儿的定时器，见 finish() */
let holdTimer = null

export const queueState = () => ({
  busy: total > 0, total, done, failed, running, label, cancelled
})

const notify = () => emit('ai:progress', queueState())

function reset () {
  clearTimeout(holdTimer)
  holdTimer = null
  total = done = failed = 0
  label = ''
  cancelled = false
  inflight.clear()
  notify()
}

/**
 * 队列跑空了：先把「N/N」这一帧播出去，停留一下再收起进度条。
 *
 * 以前是直接 reset()，而 reset 会先把计数清零再 notify —— 于是
 * done === total 的那一帧从来没被发出去过，进度条永远停在 N-1/N 就消失，
 * 进度槽也永远填不满。
 */
function finish () {
  notify()
  clearTimeout(holdTimer)
  holdTimer = setTimeout(reset, 900)
}

/**
 * 把一批任务排进队列。
 * @param jobs  [(ctx) => Promise<{ok:boolean, ...}>]，ctx.register(reqId) 用来登记可取消的请求
 * @param lbl   顶栏显示的文案，如「提取」「分析」
 * @returns 各任务结果的数组，顺序与 jobs 一致
 */
export function push (jobs, lbl) {
  if (!jobs.length) return Promise.resolve([])

  // 上一批刚跑完、正停在完成态上。这批是全新的，把残留计数清干净再开始，
  // 否则「提取 3/3」后面紧跟的分析会显示成「分析 3/6」，两轮数字混在一起。
  // autoPipeline 的提取→分析正好每次都撞上这个窗口。
  if (holdTimer) reset()

  if (total === 0) { done = failed = 0; cancelled = false }
  if (lbl) label = lbl
  total += jobs.length

  const results = jobs.map(job => new Promise(res => pending.push({ job, res })))
  pump()
  return Promise.all(results)
}

const ctx = {
  register (id) { if (id) inflight.add(id) },
  release (id) { inflight.delete(id) },
  get cancelled () { return cancelled }
}

function pump () {
  const cap = Math.max(1, S.settings.ai.concurrency | 0)

  while (running < cap && pending.length) {
    const { job, res } = pending.shift()
    running++

    Promise.resolve()
      .then(() => (cancelled ? { ok: false, error: '已取消' } : job(ctx)))
      .catch(e => ({ ok: false, error: String(e?.message || e) }))
      .then(r => {
        running--
        done++
        if (!r || !r.ok) failed++
        res(r)
        if (!pending.length && !running) finish()
        else { notify(); pump() }
      })
  }

  notify()
}

/** 取消：中断在途请求，并把还没开跑的全部丢弃 */
export function cancelAll () {
  cancelled = true
  for (const id of inflight) abortRequest(id)
  inflight.clear()

  const drained = pending.splice(0, pending.length)
  drained.forEach(({ res }) => { done++; failed++; res({ ok: false, error: '已取消' }) })

  if (!running) reset()
  else notify()
}
