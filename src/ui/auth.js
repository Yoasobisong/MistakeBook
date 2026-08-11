/**
 * 登录墙（网页只读版）。
 *
 * Worker 配了 VIEW_KEY 后，读接口要求 x-view-key 头。
 * 打开时先显示全屏登录页，输对密码存 sessionStorage，
 * 之后所有请求自动带头。输错给错误提示，不打断输入。
 *
 * 桌面版不 import 本模块，永远不会出现登录页。
 */
import { $ } from '../core/dom.js'

const $screen = () => $('#authScreen')

export function showAuth () {
  $screen()?.classList.remove('hidden')
  // 球体视频有 580KB，写死在 src 里会让每个访客都白下一遍 ——
  // index.html 里存成 data-src，到这里（确认真的要登录）才接上去开始拉流
  const orb = $('.auth-orb')
  if (orb && !orb.src && orb.dataset.src) orb.src = orb.dataset.src
  const input = $('#authPass')
  if (input) setTimeout(() => { input.focus() }, 60)
}

export function hideAuth () {
  $screen()?.classList.add('hidden')
}

function fail () {
  const err = $('#authErr')
  err?.classList.remove('on')
  // 强制重排让动画能重放
  void err?.offsetWidth
  err?.classList.add('on')
  const input = $('#authPass')
  if (input) { input.select(); input.focus() }
}

/**
 * 绑定登录表单。onOk(password) 返回 Promise<boolean> ——
 * true 表示密码通过（隐藏登录页），false 表示失败（抖动提示）。
 */
export function bindAuthForm (onOk) {
  const form = $('#authForm')
  if (!form) return
  form.addEventListener('submit', async e => {
    e.preventDefault()
    const input = $('#authPass')
    const pwd = input?.value || ''
    if (!pwd) { fail(); return }
    const ok = await onOk(pwd)
    if (ok) {
      hideAuth()
    } else {
      fail()
      if (input) input.value = ''
    }
  })
}
