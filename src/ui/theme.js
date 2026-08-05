/**
 * 主题切换。
 *
 * 'auto' 跟随系统，'light' / 'dark' 手动锁定。
 * 实际生效的值写到 <html data-theme>，样式全部由 tokens.css 里的变量承接。
 */
import { S } from '../core/state.js'
import { emit, on } from '../core/bus.js'

const mq = window.matchMedia('(prefers-color-scheme: dark)')

export const MODES = [
  { v: 'auto', t: '跟随系统' },
  { v: 'light', t: '白天' },
  { v: 'dark', t: '黑夜' }
]

/** 用户设的可能是 auto，这里算出真正要用的那个 */
export const resolved = () => {
  const m = S.settings.theme || 'auto'
  return m === 'auto' ? (mq.matches ? 'dark' : 'light') : m
}

export function applyTheme () {
  const t = resolved()
  document.documentElement.dataset.theme = t
  // 同步给浏览器，原生滚动条和表单控件才会跟着变
  document.documentElement.style.colorScheme = t
  // 镜像一份到 localStorage：设置存在 IndexedDB 里是异步的，
  // 首屏那段空窗期靠 index.html 的内联脚本读这个值，避免闪一下亮色
  try { localStorage.setItem('mb.theme', S.settings.theme || 'auto') } catch (_) {}
  emit('theme', t)
}

/** 只有停留在 auto 时才跟随系统变化 */
mq.addEventListener('change', () => {
  if ((S.settings.theme || 'auto') === 'auto') applyTheme()
})

export function cycleTheme () {
  const order = ['auto', 'light', 'dark']
  const i = order.indexOf(S.settings.theme || 'auto')
  S.settings.theme = order[(i + 1) % order.length]
  applyTheme()
  return S.settings.theme
}

/* ---------- 顶栏按钮 ---------- */

const ICON = {
  // 跟随系统：半明半暗的圆
  auto: '<circle cx="12" cy="12" r="8.4"/><path d="M12 3.6a8.4 8.4 0 0 0 0 16.8z" fill="currentColor" stroke="none"/>',
  // 白天：太阳
  light: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.4v2.4M12 19.2v2.4M21.6 12h-2.4M4.8 12H2.4M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7M18.8 18.8l-1.7-1.7M6.9 6.9L5.2 5.2"/>',
  // 黑夜：月牙
  dark: '<path d="M20 14.4A8.6 8.6 0 0 1 9.6 4a8.7 8.7 0 1 0 10.4 10.4z"/>'
}

const LABEL = { auto: '跟随系统', light: '白天', dark: '黑夜' }

export function paintThemeBtn () {
  const b = document.getElementById('btnTheme')
  if (!b) return
  const m = S.settings.theme || 'auto'
  b.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${ICON[m]}</svg>`
  b.title = `主题：${LABEL[m]}${m === 'auto' ? `（当前 ${LABEL[resolved()]}）` : ''} · 点击切换`
}

on('theme', paintThemeBtn)
