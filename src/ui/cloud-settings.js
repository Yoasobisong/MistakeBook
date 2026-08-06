/**
 * 设置弹窗「云同步」分页 —— 仅可写模式显示（桌面版 / 开发浏览器）。
 *
 * 桌面版是唯一写入方：在这里填 API 地址和推送令牌，点「立即推送」
 * 把本地改动推上去；网页版永远只读，不需要这页。
 */
import { $, esc } from '../core/dom.js'
import { S } from '../core/state.js'
import { fmtDT } from '../core/fmt.js'
import { testCloud, pushToCloud, cloudReady } from './cloud.js'
import { saveMeta } from '../storage/repo.js'
import { toast } from './toast.js'

export function cloudPaneHTML () {
  const c = S.settings.cloud
  const ready = cloudReady()
  return `<div style="font-size:13.5px;line-height:1.9;color:var(--ink2)">
    <div class="mt-l" style="margin-bottom:7px">桌面版把数据推送到云端，手机浏览器随时打开看（只读镜像）。</div>
    <label class="fld">API 地址</label>
    <input class="inp" id="clApi" value="${esc(c.apiBase)}" placeholder="https://cuotiben-api.你的域名.workers.dev" spellcheck="false">
    <div style="margin-top:9px">
      <label class="fld">推送令牌</label>
      <input class="inp" id="clToken" type="password" value="${esc(c.token)}" placeholder="与 Worker 的 PUSH_TOKEN 一致" spellcheck="false">
    </div>
    <label style="display:block;margin:10px 0 4px"><input type="checkbox" id="clAuto" ${c.autoPush ? 'checked' : ''}> 改动后自动推送（后台静默同步）</label>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <button class="btn" data-clact="test">测试连接</button>
      <button class="btn primary" data-clact="push">立即推送</button>
    </div>
    <div style="font-size:12px;color:var(--ink3);margin-top:10px;line-height:1.8">
      ${ready ? '配置已就绪' : '还没填地址 / 令牌'}
      ${c.lastPush ? ` · 上次推送：${fmtDT(c.lastPush)}` : ''}<br>
      单向同步：桌面版推、网页端只读，没有冲突。图片只传云端缺的那几张，断了下次自动补。</div>
  </div>`
}

/** 弹窗关闭前同步取值 */
export function readCloud () {
  const c = S.settings.cloud
  c.apiBase = ($('#clApi').value || '').trim().replace(/\/+$/, '')
  c.token = $('#clToken').value.trim()
  c.autoPush = $('#clAuto').checked
}

/** 分页内的按钮点击（测试连接 / 立即推送）。返回 true 表示已处理 */
export async function handleCloudClick (t) {
  const act = t.dataset.clact
  if (!act) return false
  readCloud()
  await saveMeta()
  if (act === 'test') {
    const r = await testCloud()
    if (r.ok) toast('连接正常', r.text)
    else toast('连接失败', (r.error || '').slice(0, 50))
  } else {
    const r = await pushToCloud()
    if (!r.ok) toast('推送失败', (r.error || '').slice(0, 50))
  }
  return true
}
