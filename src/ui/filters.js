/** 左栏筛选面板：类型 / 星标 / 缺解析 / 待处理 / 难度 / 掌握 / 错因 */
import { $, esc } from '../core/dom.js'
import { on } from '../core/bus.js'
import { S } from '../core/state.js'
import { MASTERY, REASONS } from '../core/consts.js'
import { byCountDesc, isFiltering, reasonCounts } from '../core/selectors.js'

export function renderFilters () {
  const rc = reasonCounts()
  const used = byCountDesc(rc)
  const list = used.concat(REASONS.filter(r => !rc[r]))
  const f = S.f

  $('#filters').innerHTML = `
    <div class="fgroup"><div class="flabel" style="display:flex;align-items:center">筛选
      ${isFiltering() ? '<button class="btn sm ghost" data-clr style="margin-left:auto;height:19px;font-size:11px">清除</button>' : ''}</div>
      <div class="chips">
        <button class="chip ${f.kind === 'wrong' ? 'on red' : ''}" data-k="wrong">错题</button>
        <button class="chip ${f.kind === 'good' ? 'on' : ''}" data-k="good">好题</button>
        <button class="chip ${f.star ? 'on' : ''}" data-star>★ 星标</button>
        <button class="chip ${f.noAnswer ? 'on' : ''}" data-noans>缺解析</button>
      </div></div>
    <div class="fgroup"><div class="flabel">待处理</div><div class="chips">
      <button class="chip ${f.noText ? 'on' : ''}" data-notext title="有截图但还没提取出文字">未提取</button>
      <button class="chip ${f.noAI ? 'on' : ''}" data-noai title="有文字但还没让 AI 分析过考点">未分析</button>
    </div></div>
    <div class="fgroup"><div class="flabel">难度</div><div class="chips">
      ${[1, 2, 3, 4, 5].map(d => `<button class="chip dstar ${f.diff.includes(d) ? 'on' : ''}" data-d="${d}"
         style="${f.diff.includes(d) ? 'background:var(--d' + d + ');border-color:var(--d' + d + ')' : ''}">${d}</button>`).join('')}
    </div></div>
    <div class="fgroup"><div class="flabel">掌握</div><div class="chips">
      ${MASTERY.map(m => `<button class="chip ${f.mastery.includes(m.v) ? 'on' : ''}" data-m="${m.v}">${m.t}</button>`).join('')}
    </div></div>
    <div class="fgroup"><div class="flabel">错因</div><div class="chips">
      ${list.slice(0, 14).map(r => `<button class="chip ${f.reasons.includes(r) ? 'on red' : ''}" data-r="${esc(r)}">${esc(r)}${rc[r] ? `<span class="n">${rc[r]}</span>` : ''}</button>`).join('')}
    </div></div>`
}

on('render:filters', renderFilters)
