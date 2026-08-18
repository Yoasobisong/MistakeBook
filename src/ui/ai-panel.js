/**
 * AI 相关界面：槽位正文的提取/编辑、右栏的分析按钮、正文下方的对话区。
 *
 * 分析结果不再走「建议 → 采纳」两步，直接写进 p.topics 和 p.chapterId。
 * 但有两条保护：知识点只增不删（不会抹掉手工加的），
 * 章节只在空着时才填（手动归过类的不被模型改掉）。
 */
import { $, esc } from '../core/dom.js'
import { S, chatLog, openMore } from '../core/state.js'
import { READONLY } from '../core/env.js'
import { slotName, textFirst } from '../core/consts.js'
import { PROB, chName } from '../core/selectors.js'
import { fmtDT } from '../core/fmt.js'
import { mdRender } from '../core/md.js'
import { saveProblem } from '../storage/repo.js'
import { isConfigured } from '../ai/config.js'
import { analyzeProblem, chatAbout, extractSlot, reviseSlot } from '../ai/tasks.js'
import { toast } from './toast.js'
import { render } from './render.js'

const EMPTY_HINT = '还没有文字版。点右上角「提取文字」，让视觉模型把截图转成 LaTeX。'

/**
 * 答案和补充的文字版默认是折起来的，动它之前先摊开。
 *
 * 下面三个入口都要往 [data-lxbody] 里写东西 —— 提取要往里流式输出、
 * 编辑要把它换成 textarea、改写要在它下面挂面板。折着的时候这个节点
 * 根本不存在，不先展开就是静悄悄什么都不发生。
 * 题目槽的文字本来就在最上面，不用管。
 */
function openText (slotKey) {
  if (textFirst(slotKey) || openMore.has(slotKey)) return
  openMore.add(slotKey)
  render('detail')
}

/* ============================================================
   槽位正文
   ============================================================ */

export function latexActionsHTML (p, slotKey, hasImages) {
  // 网页只读版没有「编辑 / 提取 / 改写」
  if (READONLY) return ''
  const has = !!(p.latex?.[slotKey] || '').trim()
  return `${has ? `<button class="btn sm" data-lxact="edit" data-slot="${slotKey}">编辑文字</button>` : ''}
    ${has ? `<button class="btn sm" data-lxact="revise" data-slot="${slotKey}" title="用一句话说哪里认错了，让 AI 改">AI 改写</button>` : ''}
    ${hasImages ? `<button class="btn sm" data-lxact="extract" data-slot="${slotKey}">${has ? '重新提取' : '提取文字'}</button>` : ''}`
}

export function latexBodyHTML (p, slotKey) {
  const txt = p.latex?.[slotKey] || ''
  if (!txt.trim()) {
    return READONLY
      ? `<div class="lx-b empty" data-lxbody="${slotKey}"><span class="ph">还没有文字版。</span></div>`
      : `<div class="lx-b empty" data-lxbody="${slotKey}"><span class="ph">${EMPTY_HINT}</span></div>`
  }
  return `<div class="lx-b" data-lxbody="${slotKey}">${mdRender(txt, { repairMath: true })}</div>`
}

export async function doExtract (slotKey) {
  const p = PROB()
  if (!p) return
  if (!isConfigured('extract')) { toast('提取槽还没配模型', '设置 → AI'); return }

  openText(slotKey)
  const body = document.querySelector(`[data-lxbody="${slotKey}"]`)
  if (body) { body.classList.add('streaming'); body.textContent = '正在识别…' }

  let acc = ''
  const r = await extractSlot(p, slotKey, null, chunk => {
    acc += chunk
    const el = document.querySelector(`[data-lxbody="${slotKey}"]`)
    if (!el) return
    el.classList.add('streaming')
    el.textContent = acc
    el.scrollTop = el.scrollHeight
  })

  if (!r.ok) {
    if (body) { body.classList.remove('streaming'); body.innerHTML = `<span class="err">${esc(r.error)}</span>` }
    toast('提取失败', r.error.slice(0, 40))
    return
  }

  render('detail', 'list')
  toast(slotName(slotKey) + ' 提取完成', r.text.length + ' 字')

  if (S.settings.ai.autoAnalyze && isConfigured('analyze')) doAnalyze(true)
}

export function openLatexEditor (slotKey) {
  const p = PROB()
  if (!p) return
  openText(slotKey)
  const host = document.querySelector(`[data-lxbody="${slotKey}"]`)
  if (!host) return

  host.classList.remove('streaming')
  host.innerHTML = `<textarea class="lx-edit" data-lxedit="${slotKey}"
    placeholder="Markdown + LaTeX，行内 $x^2$，独立 $$...$$">${esc(p.latex[slotKey] || '')}</textarea>`

  const ta = host.querySelector('textarea')
  ta.focus()
  ta.addEventListener('blur', async () => {
    if (ta.value !== p.latex[slotKey]) {
      p.latex[slotKey] = ta.value
      await saveProblem(p)
      render('list')
    }
    host.innerHTML = mdRender(p.latex[slotKey], { repairMath: true }) || `<span class="ph">${EMPTY_HINT}</span>`
    host.classList.toggle('empty', !p.latex[slotKey].trim())
  })
  ta.addEventListener('keydown', e => { if (e.key === 'Escape') ta.blur() })
}

/* ============================================================
   AI 改写：用一句话说哪里认错了，模型给出修正后的完整文本
   ============================================================ */

/**
 * 面板状态放模块作用域，而不是塞进 DOM ——
 * renderDetail() 是整段 innerHTML 重画，写在 DOM 里的状态会被冲掉。
 *
 * base 是本轮修改的基准：第一次是库里的原文，点「再说一句」之后
 * 变成上一轮的结果，这样可以连着改好几处而不用每次都先应用。
 */
const revise = { slot: null, base: '', text: '', result: '', error: '', busy: false }

export function revisePanelHTML (slotKey) {
  if (READONLY || revise.slot !== slotKey) return ''
  const ready = isConfigured('analyze')

  if (revise.result) {
    const d = revise.result.length - revise.base.length
    // 模型被要求输出完整文本，就有顺手重写别处的风险。
    // 字数变化过大先提醒一句，剩下的靠人眼看预览 —— 这也是不直接落库的理由
    const big = Math.abs(d) > Math.max(24, revise.base.length * 0.3)
    return `<div class="rv">
      <div class="rv-h"><b>改好了，确认一下</b>
        <span class="rv-n">${revise.base.length} → ${revise.result.length} 字${d ? `（${d > 0 ? '+' : ''}${d}）` : ''}</span></div>
      ${big ? '<div class="rv-warn">字数变化不小，模型可能动了你没提到的地方 —— 看仔细再应用。</div>' : ''}
      <div class="rv-out">${mdRender(revise.result, { repairMath: true })}</div>
      <div class="rv-f">
        <button class="btn sm primary" data-rvact="apply">应用到题目</button>
        <button class="btn sm" data-rvact="again">在这基础上再改</button>
        <div class="spacer"></div>
        <button class="btn sm ghost" data-rvact="close">放弃</button>
      </div>
    </div>`
  }

  return `<div class="rv">
    <div class="rv-h"><b>说说哪里不对</b>
      <span class="rv-n">改「${slotName(slotKey)}」的文字，确认之后才写进题目</span></div>
    <textarea class="rv-in" id="rvBox" rows="2" ${ready && !revise.busy ? '' : 'disabled'}
      placeholder="${ready ? '比如：这里不是乘以 n 的 r 次方，而是开 n 次根号　·　Enter 发送' : '先到 设置 → AI 配置分析槽'}">${esc(revise.text)}</textarea>
    ${revise.error ? `<div class="rv-err">${esc(revise.error)}</div>` : ''}
    <div class="rv-f">
      <button class="btn sm primary" data-rvact="send" ${ready && !revise.busy ? '' : 'disabled'}>${revise.busy ? '正在改…' : '让 AI 改'}</button>
      <div class="spacer"></div>
      <button class="btn sm ghost" data-rvact="close">取消</button>
    </div>
  </div>`
}

function openRevise (slotKey) {
  const p = PROB()
  if (!p) return
  openText(slotKey)
  Object.assign(revise, {
    slot: slotKey,
    base: (p.latex?.[slotKey] || '').trim(),
    text: '', result: '', error: '', busy: false
  })
  render('detail')
  setTimeout(() => $('#rvBox')?.focus(), 40)
}

function closeRevise () {
  Object.assign(revise, { slot: null, base: '', text: '', result: '', error: '', busy: false })
  render('detail')
}

export async function doRevise () {
  const p = PROB()
  if (!p || !revise.slot || revise.busy) return

  // 输入框是每次重画都新建的，发送前先把内容取回来
  const box = $('#rvBox')
  if (box) revise.text = box.value
  if (!revise.text.trim()) return

  revise.busy = true
  revise.error = ''
  render('detail')

  const r = await reviseSlot(p, revise.slot, revise.text, revise.base)
  revise.busy = false

  if (!r.ok) {
    revise.error = r.error
    render('detail')
    return
  }
  revise.result = r.text
  render('detail')
}

async function applyRevise () {
  const p = PROB()
  if (!p || !revise.slot || !revise.result) return
  const slot = revise.slot
  p.latex[slot] = revise.result
  await saveProblem(p)
  closeRevise()
  render('list')
  toast('已应用修改', slotName(slot))
}

/** 拿上一轮结果当新基准，接着改下一处 */
function reviseAgain () {
  revise.base = revise.result
  revise.result = ''
  revise.text = ''
  revise.error = ''
  render('detail')
  setTimeout(() => $('#rvBox')?.focus(), 40)
}

/* ============================================================
   右栏：一个按钮，没有卡片
   ============================================================ */

export function aiButtonHTML (p) {
  // 网页只读版不提供 AI 分析（改了也没法保存）
  if (READONLY) return ''
  const a = p.ai || {}
  const ready = isConfigured('analyze')
  const hasText = !!((p.latex?.q || '') + (p.latex?.a || '')).trim()

  return `<div class="mt">
    <div class="mt-l">AI</div>
    <button class="btn" style="width:100%" data-aiact="analyze" ${ready && hasText ? '' : 'disabled'}>
      ${a.analyzedAt ? '重新分析考点' : '分析考点'}
    </button>
    ${!ready
      ? '<div class="aihint">先到 设置 → AI 配置分析槽</div>'
      : !hasText
          ? '<div class="aihint">需要先提取出文字内容</div>'
          : a.analyzedAt
              ? `<div class="aihint">${esc(a.summary || '')}${a.summary ? '<br>' : ''}${fmtDT(a.analyzedAt)} · ${esc(a.analyzeModel || '')}</div>`
              : ''}
    ${a.error ? `<div class="aierr">${esc(a.error)}</div>` : ''}
  </div>`
}

export async function doAnalyze (silent) {
  const p = PROB()
  if (!p) return
  if (!isConfigured('analyze')) { toast('分析槽还没配模型', '设置 → AI'); return }

  const btn = document.querySelector('[data-aiact="analyze"]')
  if (btn) { btn.disabled = true; btn.textContent = '正在分析…' }

  const r = await analyzeProblem(p)
  render('detail', 'tree', 'list', 'filters')

  if (!r.ok) { toast('分析失败', r.error.slice(0, 40)); return }
  if (silent) return

  const bits = []
  if (r.added.length) bits.push('考点 ' + r.added.join('、'))
  if (r.diffSet) bits.push('难度 ' + p.difficulty)
  if (r.chapterSet) bits.push('归到「' + chName(p.chapterId) + '」')
  toast(bits.length ? '分析完成' : '分析完成，无新增', bits.join(' · ') || p.ai.summary)
}

/* ============================================================
   对话区
   ============================================================ */

export function chatHTML (p) {
  // 网页只读版不提供 AI 对话
  if (READONLY) return ''
  const msgs = chatLog.get(p.id) || []
  const ready = isConfigured('analyze')

  return `<section class="slot chat">
    <div class="slot-h"><span class="nm">和 AI 讨论</span>
      <span class="hint">${msgs.length
        ? Math.ceil(msgs.length / 2) + ' 轮 · 关掉应用就清空'
        : '问思路、问为什么、说你的做法让它挑错'}</span>
      <div class="spacer"></div>
      ${msgs.length ? '<button class="btn sm" data-chatact="clear">清空</button>' : ''}
    </div>

    ${msgs.length
      ? `<div class="chat-log" id="chatLog">${msgs.map(m =>
          `<div class="msg ${m.role}"><div class="bub">${
            m.role === 'user' ? esc(m.content) : mdRender(m.content)
          }</div></div>`).join('')}</div>
         <div class="chat-note">对话不会保存 —— 觉得有用的结论，顺手写进上面的批注里。</div>`
      : ''}

    <div class="chat-in">
      <textarea id="chatBox" rows="2" ${ready ? '' : 'disabled'}
        placeholder="${ready ? '问它这道题…　Enter 发送，Shift+Enter 换行' : '先到 设置 → AI 配置分析槽'}"></textarea>
      <button class="btn primary" data-chatact="send" ${ready ? '' : 'disabled'}>发送</button>
    </div>
  </section>`
}

export async function sendChat () {
  const p = PROB()
  const box = $('#chatBox')
  if (!p || !box) return

  const text = box.value.trim()
  if (!text) return

  const msgs = chatLog.get(p.id) || []
  chatLog.set(p.id, msgs)

  box.value = ''
  msgs.push({ role: 'user', content: text })
  render('detail')

  const log = $('#chatLog')
  if (log) {
    log.insertAdjacentHTML('beforeend', '<div class="msg assistant pending"><div class="bub">思考中…</div></div>')
    log.scrollTop = log.scrollHeight
  }

  const r = await chatAbout(p, text)
  msgs.push({
    role: 'assistant',
    content: r.ok ? r.text : '（出错了：' + r.error + '）'
  })
  if (!r.ok) toast('对话失败', r.error.slice(0, 40))

  render('detail')
  const l2 = $('#chatLog')
  if (l2) l2.scrollTop = l2.scrollHeight
}

function clearChat () {
  const p = PROB()
  if (!p) return
  chatLog.delete(p.id)
  render('detail')
}

/* ============================================================
   点击路由
   ============================================================ */

export function handleAIPanelClick (t) {
  const lx = t.closest('[data-lxact]')
  if (lx) {
    const a = lx.dataset.lxact
    if (a === 'extract') doExtract(lx.dataset.slot)
    else if (a === 'revise') openRevise(lx.dataset.slot)
    else openLatexEditor(lx.dataset.slot)
    return true
  }

  const rv = t.closest('[data-rvact]')
  if (rv) {
    const a = rv.dataset.rvact
    if (a === 'send') doRevise()
    else if (a === 'apply') applyRevise()
    else if (a === 'again') reviseAgain()
    else closeRevise()
    return true
  }

  if (t.closest('[data-aiact]')) { doAnalyze(); return true }

  const c = t.closest('[data-chatact]')
  if (c) {
    if (c.dataset.chatact === 'send') sendChat()
    else clearChat()
    return true
  }

  return false
}
