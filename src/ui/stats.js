/** 统计看板：KPI、章节薄弱度、错因/知识点/难度分布、录入趋势 */
import { $, esc } from '../core/dom.js'
import { on } from '../core/bus.js'
import { fmtD } from '../core/fmt.js'
import { S } from '../core/state.js'
import { DIFF_LABEL } from '../core/consts.js'
import { BOOK, allBooks, allProblems, chTree, descendants } from '../core/selectors.js'

const scoped = () => allProblems().filter(p => S.scope === 'all' || p.bookId === S.bookId)

function bar (nm, v, max, red) {
  return `<div class="brow"><span class="nm">${esc(nm)}</span>
    <span class="tr"><span class="fl ${red ? 'r' : ''}" style="width:${max ? Math.round(v / max * 100) : 0}%"></span></span>
    <span class="vv">${v}</span></div>`
}

const tally = (ps, key) => {
  const m = {}
  for (const p of ps) for (const v of p[key] || []) m[v] = (m[v] || 0) + 1
  return m
}

export function renderStats () {
  const ps = scoped()
  $('#statsBook').textContent = S.scope === 'all' ? '全部书籍' : (BOOK() ? BOOK().name : '')

  if (!ps.length) {
    $('#statsWrap').innerHTML = `<div class="empty" style="height:50vh">
      <div class="k">还没有数据</div>
      <div class="s">录入几道题之后，这里会显示错因分布、薄弱章节和录入趋势。</div></div>`
    return
  }

  const now = Date.now()
  const week = ps.filter(p => now - p.createdAt < 7 * 864e5).length
  const unmastered = ps.filter(p => (p.mastery | 0) === 0).length
  const noAns = ps.filter(p => !p.images.some(i => i.slot === 'a')).length
  const avgD = (ps.reduce((s, p) => s + (p.difficulty || 3), 0) / ps.length).toFixed(1)
  const starred = ps.filter(p => p.starred).length

  const rc = tally(ps, 'reasons')
  const rk = Object.keys(rc).sort((a, b) => rc[b] - rc[a]).slice(0, 10)
  const rmax = rk.length ? rc[rk[0]] : 0

  const tc = tally(ps, 'topics')
  const tk = Object.keys(tc).sort((a, b) => tc[b] - tc[a]).slice(0, 8)
  const tmax = tk.length ? tc[tk[0]] : 0

  const dc = [0, 0, 0, 0, 0]
  ps.forEach(p => dc[(p.difficulty || 3) - 1]++)
  const dmax = Math.max(...dc)

  // 薄弱度：本书按顶层章节，全部书籍则按书
  const rows = []
  const stat = (nm, sub) => ({
    nm,
    n: sub.length,
    bad: sub.filter(p => (p.mastery | 0) === 0).length,
    mid: sub.filter(p => (p.mastery | 0) === 1).length
  })

  if (S.scope === 'book') {
    for (const { c, depth } of chTree(S.bookId)) {
      if (depth > 0) continue
      const set = descendants(c.id)
      const sub = ps.filter(p => set.includes(p.chapterId))
      if (sub.length) rows.push(stat(c.title, sub))
    }
    const un = ps.filter(p => !p.chapterId)
    if (un.length) rows.push(stat('未归类', un))
  } else {
    for (const b of allBooks()) {
      const sub = ps.filter(p => p.bookId === b.id)
      if (sub.length) rows.push(stat(b.name, sub))
    }
  }
  rows.sort((a, b) => (b.bad / b.n) - (a.bad / a.n))
  const rowMax = Math.max(1, ...rows.map(r => r.n))

  // 近 30 天
  const days = []
  for (let i = 29; i >= 0; i--) days.push(fmtD(now - i * 864e5))
  const cnt = {}
  ps.forEach(p => { const k = fmtD(p.createdAt); cnt[k] = (cnt[k] || 0) + 1 })
  const dayMax = Math.max(1, ...days.map(d => cnt[d] || 0))

  $('#statsWrap').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="v">${ps.length}</div><div class="l">总题数</div></div>
      <div class="kpi acc"><div class="v">${week}</div><div class="l">近 7 天新增</div></div>
      <div class="kpi red"><div class="v">${unmastered}</div><div class="l">未掌握</div></div>
      <div class="kpi green"><div class="v">${Math.round(ps.filter(p => (p.mastery | 0) === 2).length / ps.length * 100)}%</div><div class="l">已掌握占比</div></div>
      <div class="kpi"><div class="v">${avgD}</div><div class="l">平均难度</div></div>
      <div class="kpi"><div class="v">${noAns}</div><div class="l">缺解析</div></div>
      <div class="kpi"><div class="v">${starred}</div><div class="l">星标</div></div>
    </div>

    <div class="panel"><h3>${S.scope === 'book' ? '章节' : '书籍'}薄弱度<span>按未掌握比例排序，红色越长越该回头看</span></h3>
      <div class="heat">
        ${rows.length
          ? rows.map(r => {
            const w = Math.round(r.n / rowMax * 100)
            const bad = Math.round(r.bad / r.n * 100)
            const mid = Math.round(r.mid / r.n * 100)
            return `<div class="heat-row"><span class="hn" title="${esc(r.nm)}">${esc(r.nm)}</span>
            <div class="heat-cells">
              <span class="htrack"><span class="hc" style="width:${w}%">
                <i style="flex:${bad};background:var(--red)"></i>
                <i style="flex:${mid};background:var(--amber)"></i>
                <i style="flex:${Math.max(0, 100 - bad - mid)};background:var(--green)"></i>
              </span></span>
              <span class="hnum">${r.bad}/${r.n}</span>
            </div></div>`
          }).join('')
          : '<div style="color:var(--ink3);font-size:12.5px">还没有分章节的数据</div>'}
      </div>
      <div class="legend"><span><b style="background:var(--red)"></b>未掌握</span><span><b style="background:var(--amber)"></b>半懂</span><span><b style="background:var(--green)"></b>已掌握</span></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="panel"><h3>错因分布<span>最常栽在哪</span></h3>
        ${rk.length ? rk.map(r => bar(r, rc[r], rmax, true)).join('') : '<div style="color:var(--ink3);font-size:12.5px">还没有打错因标签</div>'}</div>
      <div class="panel"><h3>知识点分布<span>出现最多的考点</span></h3>
        ${tk.length ? tk.map(t => bar(t, tc[t], tmax)).join('') : '<div style="color:var(--ink3);font-size:12.5px">还没有打知识点标签</div>'}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="panel"><h3>难度分布</h3>
        ${dc.map((v, i) => bar(i + 1 + ' · ' + DIFF_LABEL[i + 1], v, dmax, i >= 3)).join('')}</div>
      <div class="panel"><h3>近 30 天录入<span>共 ${days.reduce((s, d) => s + (cnt[d] || 0), 0)} 题</span></h3>
        <div class="spark">${days.map(d => `<i class="${(cnt[d] || 0) >= dayMax ? 'hot' : ''}" style="height:${Math.round((cnt[d] || 0) / dayMax * 100) || 2}%" title="${d} · ${cnt[d] || 0} 题"></i>`).join('')}</div>
        <div class="mono" style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--ink3);margin-top:6px">
          <span>${days[0].slice(5)}</span><span>${days[29].slice(5)}</span></div></div>
    </div>`
}

on('render:stats', renderStats)
