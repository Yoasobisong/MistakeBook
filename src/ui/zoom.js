/**
 * 正文缩放：Ctrl + 滚轮。
 *
 * 用 CSS zoom 而不是改 font-size —— 全站样式都是 px 写死的，
 * 改根字号级联不下去；zoom 能等比缩放包括 KaTeX 公式在内的一切。
 */
import { $ } from '../core/dom.js'
import { S } from '../core/state.js'
import { saveMetaSoon } from '../storage/repo.js'
import { toast } from './toast.js'

const MIN = 0.7
const MAX = 2.0
const STEP = 0.1

const clampZoom = z => Math.round(Math.max(MIN, Math.min(MAX, z)) * 100) / 100

export function applyZoom () {
  document.documentElement.style.setProperty('--zoom', S.settings.zoom || 1)
}

export function setZoom (z, announce) {
  const next = clampZoom(z)
  if (next === S.settings.zoom) return
  S.settings.zoom = next
  applyZoom()
  saveMetaSoon()
  if (announce) toast('正文缩放 ' + Math.round(next * 100) + '%', 'Ctrl+0 复位')
}

export function bindZoom () {
  applyZoom()

  // passive:false —— 要 preventDefault 挡掉浏览器自身的页面缩放
  window.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return
    if (!e.target.closest('#detMain, #cards, #viewStats')) return
    e.preventDefault()
    setZoom(S.settings.zoom + (e.deltaY < 0 ? STEP : -STEP), true)
  }, { passive: false })

  window.addEventListener('keydown', e => {
    if (!e.ctrlKey && !e.metaKey) return
    if (/INPUT|TEXTAREA/.test(e.target.tagName || '')) return
    if (e.key === '0') { e.preventDefault(); setZoom(1, true) }
    else if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom(S.settings.zoom + STEP, true) }
    else if (e.key === '-') { e.preventDefault(); setZoom(S.settings.zoom - STEP, true) }
  })
}
