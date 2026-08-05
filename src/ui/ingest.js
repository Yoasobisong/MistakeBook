/** 截图录入：粘贴 / 拖拽 / 选文件，以及多图时的「每张一题 vs 合并一题」 */
import { $ } from '../core/dom.js'
import { S } from '../core/state.js'
import { slotName } from '../core/consts.js'
import { PROB, BOOK } from '../core/selectors.js'
import { importImage } from '../storage/images.js'
import { createProblem, saveProblem } from '../storage/repo.js'
import { toast } from './toast.js'
import { renderAll, render, openProblem } from './render.js'
import { newBook } from './topbar.js'
import { autoPipeline } from '../ai/tasks.js'

let busy = false

/** 从 DataTransfer / ClipboardData 里挑出图片 */
export function blobsFrom (dt) {
  const out = []
  if (!dt) return out
  if (dt.files?.length) {
    Array.from(dt.files).forEach(f => { if (f.type.startsWith('image/')) out.push(f) })
  }
  if (!out.length && dt.items) {
    Array.from(dt.items).forEach(it => {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) out.push(f)
      }
    })
  }
  return out
}

export function flashPaste () {
  const d = document.createElement('div')
  d.className = 'paste-fx'
  document.body.appendChild(d)
  setTimeout(() => d.remove(), 520)
}

/**
 * 导入一批图片。
 *   详情页内 → 全部塞进当前题的指定槽位
 *   opts.merge → 新建一道题，多张图按顺序排在题干里
 *   否则       → 一张图建一道题
 */
export async function ingest (blobs, opts) {
  if (busy || !blobs.length) return
  busy = true
  const merge = opts?.merge
  const slot = opts?.slot || (S.view === 'detail' ? S.armedSlot : 'q')

  try {
    if (S.view === 'detail' && PROB()) {
      const p = PROB()
      const recs = []
      for (const b of blobs) recs.push(await importImage(b))
      recs.forEach(r => p.images.push({ id: r.id, slot, cap: '' }))
      await saveProblem(p)
      render('detail')
      toast(`已加入「${slotName(slot)}」`, recs.length > 1 ? recs.length + ' 张' : '')
      autoPipeline(p)
      return
    }

    if (!BOOK()) { await newBook(); if (!BOOK()) return }

    if (merge) {
      const recs = []
      for (const b of blobs) recs.push(await importImage(b))
      const p = await createProblem(recs, 'q')
      if (p) { renderAll(); openProblem(p.id); toast('已新建 1 题', recs.length + ' 张图') }
      autoPipeline(p)
    } else {
      const made = []
      for (const b of blobs) {
        const r = await importImage(b)
        made.push(await createProblem([r], 'q'))
      }
      const last = made[made.length - 1]
      renderAll()
      if (blobs.length === 1 && last) openProblem(last.id)
      toast(`已录入 ${blobs.length} 道题`)
      autoPipeline(made)
    }
  } catch (e) {
    console.error(e)
    toast('导入失败：' + e.message)
  } finally {
    busy = false
  }
}

/** 多张图时问一下意图，返回 'each' | 'merge' | null */
export function askMulti (n) {
  return new Promise(res => {
    const w = document.createElement('div')
    w.className = 'mask'
    w.innerHTML = `<div class="modal"><div class="modal-h"><b>收到 ${n} 张图</b><div class="spacer"></div>
      <button class="btn icon ghost" data-a="" data-x>✕</button></div>
      <div class="modal-b" style="display:flex;flex-direction:column;gap:9px">
        <button class="btn" data-a="each" style="height:auto;padding:11px 13px;text-align:left;display:block">
          <b style="color:var(--ink);font-size:13.5px">每张一题</b>
          <div style="font-size:12px;color:var(--ink3);margin-top:2px">一张图就是一道完整的题，建 ${n} 道</div></button>
        <button class="btn" data-a="merge" style="height:auto;padding:11px 13px;text-align:left;display:block">
          <b style="color:var(--ink);font-size:13.5px">合并为一题</b>
          <div style="font-size:12px;color:var(--ink3);margin-top:2px">一道长题分了几屏截图，按顺序拼在同一题里</div></button>
      </div></div>`

    $('#layer').appendChild(w)
    const done = v => { w.remove(); res(v) }
    w.addEventListener('click', e => {
      const b = e.target.closest('[data-a]')
      if (b) done(b.dataset.a || null)
      else if (e.target === w) done(null)
    })
  })
}

/** 粘贴与拖拽共用的分流逻辑 */
export async function ingestSmart (blobs) {
  if (blobs.length > 1 && S.view !== 'detail') {
    const m = await askMulti(blobs.length)
    if (!m) return
    await ingest(blobs, { merge: m === 'merge' })
  } else {
    await ingest(blobs, { merge: blobs.length > 1 })
  }
}
