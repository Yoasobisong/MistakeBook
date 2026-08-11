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

    // 每次推送后都清理云端孤儿图：
    //  1) 本地已删题目的图
    //  2) 历史上传过的题目(q)截图 —— 现在题目图不上云，云端 problems.images 里
    //     如果还残留 q 槽引用，prune 会把它们当"活图"保留，所以要先把引用剥掉
    //     再让 prune 判断（worker 的 prune 只看云端 problems 表里的引用）
    const cleaned = []
    for (const p of S.problems) {
      if (p.deletedAt) continue
      cleaned.push({ ...p, images: (p.images || []).filter(im => im.slot !== 'q') })
    }
    if (cleaned.length) {
      await postJSON('/api/push', { problems: cleaned }).catch(() => {})
    }
    await postJSON('/api/prune', {}).catch(() => {})

    c.lastPush = Date.now()
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

export async function testCloud (override) {
  const c = { ...cfg(), ...(override || {}) }
  if (!c.apiBase) return { ok: false, error: '还没填 API 地址' }
  try {
    const r = await fetch(c.apiBase.replace(/\/+$/, '') + '/api/stat')
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` }
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
