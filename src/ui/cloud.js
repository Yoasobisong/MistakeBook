/**
 * 推送到云端（仅 Electron）。
 *
 * 单向：桌面版是唯一写入方，网页端只读，所以不需要冲突处理。
 * 只推 updatedAt 变过的记录，图片先问云端有哪些、只传缺的。
 *
 * 图片上传逐个进行而不是打包 —— 单张失败只影响那一张，
 * 下次推送会自动补上；打成一个大包则是全有或全无。
 */
import { S } from '../core/state.js'
import { bytes } from '../core/fmt.js'
import { READONLY } from '../core/env.js'
import { dbGet } from '../storage/db.js'
import { saveMeta } from '../storage/repo.js'
import { emit, on } from '../core/bus.js'
import { debounce } from '../core/dom.js'
import { toast } from './toast.js'

const cfg = () => S.settings.cloud

export const cloudReady = () => !!(cfg()?.apiBase && cfg()?.token)

function headers (extra) {
  return { 'x-push-token': cfg().token, ...(extra || {}) }
}

const api = path => cfg().apiBase.replace(/\/+$/, '') + path

async function postJSON (path, body) {
  const r = await fetch(api(path), {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body)
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

/** 本次要推的记录：改动过的，含墓碑（云端要跟着删） */
function changedSince (ts) {
  const pick = arr => arr.filter(r => (r.updatedAt || 0) > ts)
  return {
    books: pick(S.books),
    chapters: pick(S.chapters),
    problems: pick(S.problems)
  }
}

export async function pushToCloud (silent) {
  if (!cloudReady()) return { ok: false, error: '还没配置云端地址和令牌' }

  const c = cfg()
  const since = c.lastPush || 0
  /**
   * 水位线必须取「开始推送」的时刻，不能等推完再 Date.now()。
   *
   * 图片上传可能跑几分钟，这期间的任何编辑都掉进一条缝里：
   * 它不在下面这份 delta 里（delta 是此刻筛的），又会被下次的 since 过滤掉
   * （updatedAt < 结束时刻），于是永远推不上去。
   * 删除的墓碑尤其致命 —— 本地删了云端还在，而它再也不会被改动，
   * updatedAt 永远追不上水位线，这个不一致是永久的。
   *
   * 记开始时刻，最坏只是下次把同一条重复推一遍；
   * worker 那边是 INSERT OR REPLACE，完全幂等。
   */
  const startedAt = Date.now()
  const delta = changedSince(since)
  const total = delta.books.length + delta.chapters.length + delta.problems.length

  try {
    emit('cloud:state', { busy: true, text: '正在比对图片…' })

    // 活着的题目引用的图片 —— 只传答案解析(a)和补充(x)的截图，
    // 题目(q)截图不上云（网页端题目只显示提取出的文字）
    const wanted = new Set()
    for (const p of S.problems) {
      if (p.deletedAt) continue
      for (const im of p.images || []) {
        if (im.slot !== 'q') wanted.add(im.id)
      }
    }

    const ids = [...wanted]
    const { have } = ids.length ? await postJSON('/api/haveimg', { ids }) : { have: [] }
    const missing = ids.filter(id => !have.includes(id))

    // 逐张上传缺失的图
    let sent = 0
    let sentBytes = 0
    const imgMeta = []

    for (const id of missing) {
      const rec = await dbGet('images', id)
      if (!rec) continue
      const blob = rec.full || rec.thumb
      if (!blob) continue

      emit('cloud:state', { busy: true, text: `上传截图 ${sent + 1}/${missing.length}` })

      const r = await fetch(api('/api/img/' + id), {
        method: 'PUT',
        headers: headers({ 'content-type': blob.type || 'image/webp' }),
        body: blob
      })
      if (!r.ok) throw new Error(`上传图片失败 HTTP ${r.status}`)

      imgMeta.push({
        id,
        w: rec.w, h: rec.h,
        polarity: rec.polarity || (rec.mono === false ? 'color' : 'light'),
        ext: (blob.type === 'image/jpeg' ? 'jpg' : 'webp'),
        size: blob.size,
        createdAt: rec.createdAt || Date.now()
      })
      sent++
      sentBytes += blob.size
    }

    emit('cloud:state', { busy: true, text: '推送元数据…' })
    const r = await postJSON('/api/push', { ...delta, images: imgMeta })

    /**
     * 一次性清理：早期版本连题目(q)截图的引用一起推过，云端老行里还留着。
     * 不清掉的话，网页端会为这些取不到的图渲染出一排碎图标。
     *
     * 这段以前是**每次同步都跑**，把上面的增量推送整个抵消掉了 ——
     * 几百题的话每次白传 ~1MB。它其实是个数据迁移，跑一次就够，
     * 所以拿 qCleanedAt 记住。失败就让它抛出去，标记不置位，下次再来。
     *
     * 新数据不需要它：worker 写入时剥 q、prune 判断时跳过 q、
     * snapshot 返回时再剥一道，三层都挡住了。
     */
    if (!c.qCleanedAt) {
      const cleaned = S.problems
        .filter(p => !p.deletedAt)
        .map(p => ({ ...p, images: (p.images || []).filter(im => im.slot !== 'q') }))
      if (cleaned.length) {
        emit('cloud:state', { busy: true, text: '清理云端历史数据…' })
        await postJSON('/api/push', { problems: cleaned })
      }
      c.qCleanedAt = startedAt
    }
    await postJSON('/api/prune', {}).catch(() => {})

    c.lastPush = startedAt
    await saveMeta()
    emit('cloud:state', { busy: false })

    if (!silent) {
      const bits = [`${r.problems} 题`]
      if (sent) bits.push(`${sent} 张图 · ${bytes(sentBytes)}`)
      toast(total || sent ? '已同步到云端' : '没有新变化', bits.join(' · '))
    }
    return { ok: true, ...r, images: sent }
  } catch (e) {
    emit('cloud:state', { busy: false })
    const msg = String(e?.message || e)
    if (!silent) toast('同步失败', msg.slice(0, 60))
    return { ok: false, error: msg }
  }
}

/**
 * 强制全量推送：把水位线归零后再推一次。
 *
 * changedSince(0) 会捞出所有 updatedAt > 0 的记录，**包括墓碑** ——
 * 所以它能修复「本地删了、云端还留着」这类历史不一致
 * （早期版本的水位线竞态会漏推墓碑，漏掉之后那条记录再也不会被改动，
 * updatedAt 永远追不上水位线，不主动全量推就永远对不齐）。
 *
 * 图片不受影响：haveimg 每次都是按云端实际有什么来算增量，
 * 已经传上去的不会重传。
 */
export async function pushAll (silent) {
  const c = cfg()
  if (!cloudReady()) return { ok: false, error: '还没配置云端地址和令牌' }
  c.lastPush = 0
  await saveMeta()
  return pushToCloud(silent)
}

export async function testCloud (override) {
  const c = { ...cfg(), ...(override || {}) }
  if (!c.apiBase) return { ok: false, error: '还没填 API 地址' }
  try {
    // 必须带上令牌：/api/stat 是读接口，配了 VIEW_KEY 登录墙之后会拦。
    // 桌面版没有 VIEW_KEY，靠 worker 那边「PUSH_TOKEN 也放行读接口」的规则过
    const r = await fetch(c.apiBase.replace(/\/+$/, '') + '/api/stat', {
      headers: c.token ? { 'x-push-token': c.token } : {}
    })
    if (!r.ok) {
      return {
        ok: false,
        error: r.status === 401
          ? '令牌不对（401）—— 检查推送令牌和 Worker 的 PUSH_TOKEN 是否一致'
          : `HTTP ${r.status}`
      }
    }
    const d = await r.json()
    return { ok: true, text: `云端有 ${d.problems} 题 · ${d.images} 张图 · ${bytes(d.bytes || 0)}` }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

/* ============================================================
   自动推送 & 顶栏按钮状态（模块副作用，main.js import 即生效）
   ============================================================ */

// 本地数据有变、开了自动推送时，静默推一次。防抖 12s 把连续编辑合并成一次推送。
on('data:saved', debounce(() => {
  if (READONLY) return
  if (!S.settings.cloud.autoPush || !cloudReady()) return
  pushToCloud(true)
}, 12000))

// 顶栏云同步按钮：推送期间禁用并显示进度
on('cloud:state', st => {
  const b = document.getElementById('btnCloud')
  if (!b) return
  b.disabled = !!st.busy
  const label = b.querySelector('span')
  if (label) label.textContent = st.busy ? '同步中…' : '云同步'
})
