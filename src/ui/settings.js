/** 设置与备份弹窗（分页：通用 / AI / 备份） */
import { $, esc } from '../core/dom.js'
import { bytes, fmtDT } from '../core/fmt.js'
import { S } from '../core/state.js'
import { BOOK } from '../core/selectors.js'
import { saveMeta, markBackedUp } from '../storage/repo.js'
import { applyBackup, backupName, buildBackup, downloadBlob, readBackup } from '../storage/backup.js'
import { modal } from './modal.js'
import { toast } from './toast.js'
import { renderAll } from './render.js'
import { aiPaneHTML, applyAI, handleAIClick, readAI } from './ai-settings.js'
import { keyStorageSafe } from '../ai/config.js'
import { trashCount, trashModal } from './trash.js'
import { canAutoBackup, restoreFromFolder, runBackup } from './autobackup.js'
import { MODES, applyTheme } from './theme.js'

async function storageLine () {
  let used = '—'
  try {
    const e = await navigator.storage.estimate()
    used = bytes(e.usage || 0)
  } catch (_) { /* 某些浏览器不支持 estimate，忽略 */ }
  let persisted = false
  try { persisted = await navigator.storage?.persisted?.() } catch (_) {}
  return `已占用 ${used}${persisted ? ' · 已申请持久化存储' : ''}`
}

const PANES = [
  { k: 'general', t: '通用' },
  { k: 'ai', t: 'AI' },
  { k: 'backup', t: '备份' }
]

export async function settingsModal (startTab = 'general') {
  const line = await storageLine()
  const safeKeys = await keyStorageSafe()
  const bk = S.settings.backup

  const body = `
    <div class="tabs" style="margin:-16px -18px 14px">
      ${PANES.map(p => `<button data-tab="${p.k}" class="${p.k === startTab ? 'on' : ''}">${p.t}</button>`).join('')}
    </div>

    <div class="tabpane ${startTab === 'general' ? 'on' : ''}" data-pane="general">
      <div style="font-size:13.5px;line-height:1.9;color:var(--ink2)">
        <div style="margin:0 0 9px">主题
          <select class="inp" id="setTheme" style="width:130px;display:inline-block;height:26px">
            ${MODES.map(m => `<option value="${m.v}" ${(S.settings.theme || 'auto') === m.v ? 'selected' : ''}>${m.t}</option>`).join('')}
          </select>
          <span style="color:var(--ink3);font-size:12px">黑白截图在暗色下会自动反相；彩色图不动</span></div>
        <label style="display:block"><input type="checkbox" id="setTrim" ${S.settings.autoTrim ? 'checked' : ''}> 粘贴时自动裁掉截图四周的纯色白边</label>
        <label style="display:block"><input type="checkbox" id="setFold" ${S.settings.foldAnswer ? 'checked' : ''}> 进入题目时只展开题干，答案 / 补充 / 批注默认折叠（先自己重做一遍）</label>
        <div style="margin:9px 0 4px">截图最大宽度
          <select class="inp" id="setW" style="width:110px;display:inline-block;height:26px">
            ${[1200, 1600, 2000, 2600].map(w => `<option value="${w}" ${S.settings.maxW === w ? 'selected' : ''}>${w}px</option>`).join('')}
          </select>
          <span style="color:var(--ink3);font-size:12px">越大越清晰，占用也越大</span></div>
        <div class="sep"></div>
        <div class="mt-l" style="margin-bottom:6px">快捷键</div>
        <div class="mono" style="font-size:12px;color:var(--ink3);line-height:2">
          Ctrl+V 粘贴截图录题　·　/ 搜索　·　N 新建空白题<br>
          详情页：1–5 设难度　·　S 星标　·　E 写批注　·　←/→ 上下一题　·　Esc 返回</div>
      </div>
    </div>

    <div class="tabpane ${startTab === 'ai' ? 'on' : ''}" data-pane="ai">
      ${aiPaneHTML(safeKeys)}
    </div>

    <div class="tabpane ${startTab === 'backup' ? 'on' : ''}" data-pane="backup">
      <div style="font-size:13.5px;line-height:1.9;color:var(--ink2)">
        <div class="mt-l" style="margin-bottom:7px">${line}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" data-act="exp1">导出当前这本书</button>
          <button class="btn" data-act="expall">导出全部（含图片）</button>
          <button class="btn" data-act="imp">从备份恢复</button>
          <button class="btn" data-act="trash">回收站${trashCount() ? `（${trashCount()}）` : ''}</button>
        </div>
        <div style="font-size:12px;color:var(--ink3);margin-top:8px;line-height:1.8">
          数据存在浏览器本地。清理浏览数据、换电脑、重装系统都会丢，<b>建议每周导出一次</b>放到网盘。</div>

        <div class="sep"></div>
        <div class="mt-l" style="margin-bottom:7px">自动备份</div>
        ${canAutoBackup()
          ? `<label style="display:block;margin-bottom:7px">
               <input type="checkbox" id="bkOn" ${bk.enabled ? 'checked' : ''}> 启动时自动备份到本地文件夹（含图片）</label>
             <div style="display:flex;gap:7px;align-items:center;margin-bottom:7px">
               <input class="inp" id="bkDir" value="${esc(bk.dir)}" placeholder="还没选择目录" readonly style="flex:1">
               <button class="btn sm" data-act="bkdir">选择…</button>
               ${bk.dir ? '<button class="btn sm" data-act="bkopen">打开</button>' : ''}
             </div>
             <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
               <div style="flex:0 0 110px">
                 <label class="fld">保留份数</label>
                 <input class="inp" id="bkKeep" type="number" min="1" max="30" value="${bk.keep}">
               </div>
               <div style="flex:0 0 110px">
                 <label class="fld">间隔（天）</label>
                 <input class="inp" id="bkDays" type="number" min="1" max="30" value="${bk.everyDays}">
               </div>
               <button class="btn sm" data-act="bknow">立即备份一次</button>
               <button class="btn sm" data-act="bkrestore">从备份文件夹恢复</button>
             </div>
             <div style="font-size:11.5px;color:var(--ink3);margin-top:7px;line-height:1.7">
               ${bk.lastAt ? `上次备份：${fmtDT(bk.lastAt)}` : '还没有备份过'}<br>
               增量格式：图片按 id 拆成独立文件只写一次，之后每次只追加新增的。<br>
               把目录设成<b>网盘的同步文件夹</b>，同步客户端就只传新题的截图，不会每天重传几百 MB。
             </div>`
          : '<div style="font-size:12px;color:var(--ink3);line-height:1.8">浏览器版碰不到文件系统，自动备份只能在桌面版里用。</div>'}
      </div>
    </div>`

  const result = await modal({
    title: '设置',
    okText: '完成',
    cancelText: '',
    wide: true,
    noEnter: true, // AI 页有一堆输入框，打字时顺手回车不该关窗
    body,
    onClick: (target, wrap) => {
      const tab = target.closest('[data-tab]')
      if (tab) {
        wrap.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b === tab))
        wrap.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('on', p.dataset.pane === tab.dataset.tab))
        return true
      }
      const act = target.closest('[data-act]')
      if (act) {
        handleBackupAction(act.dataset.act, wrap)
        return true
      }
      return handleAIClick(target, wrap)
    },
    // onOk 必须同步取值：它返回之后弹窗 DOM 立刻被移除
    onOk: w => ({
      autoTrim: $('#setTrim', w).checked,
      foldAnswer: $('#setFold', w).checked,
      maxW: +$('#setW', w).value,
      theme: $('#setTheme', w).value,
      backup: canAutoBackup()
        ? {
            enabled: $('#bkOn', w).checked,
            keep: +$('#bkKeep', w).value,
            everyDays: +$('#bkDays', w).value
          }
        : null,
      ai: readAI(w)
    })
  })

  if (!result) return
  S.settings.autoTrim = result.autoTrim
  S.settings.foldAnswer = result.foldAnswer
  S.settings.maxW = result.maxW
  S.settings.theme = result.theme
  if (result.backup) {
    const b = S.settings.backup
    b.enabled = result.backup.enabled
    b.keep = Math.max(1, Math.min(30, result.backup.keep || 5))
    b.everyDays = Math.max(1, Math.min(30, result.backup.everyDays || 1))
  }
  applyTheme()
  await applyAI(result.ai)
  await saveMeta()
}

async function handleBackupAction (a, wrap) {
  if (a === 'trash') { trashModal(); return }
  if (a === 'imp') { $('#jsonPick').click(); return }

  if (a === 'bkdir') {
    const dir = await window.native.backup.pickDir()
    if (!dir) return
    S.settings.backup.dir = dir
    await saveMeta()
    const inp = wrap?.querySelector('#bkDir')
    if (inp) inp.value = dir
    toast('备份目录已设置', dir)
    return
  }
  if (a === 'bkopen') { window.native.backup.reveal(S.settings.backup.dir); return }
  if (a === 'bkrestore') { restoreFromFolder(); return }
  if (a === 'bknow') {
    if (!S.settings.backup.dir) { toast('先选择备份目录'); return }
    toast('正在打包…')
    await runBackup()
    await saveMeta()
    return
  }

  if (a === 'exp1' && !S.bookId) { toast('先选一本书'); return }

  const all = a === 'expall'
  toast('正在打包…')
  try {
    const blob = await buildBackup(all)
    downloadBlob(blob, backupName(all))
    await markBackedUp()
    toast('已导出', bytes(blob.size))
  } catch (e) {
    console.error(e)
    toast('导出失败：' + e.message)
  }
}

/** 由 main.js 的 #jsonPick change 事件调用 */
export async function importBackupFile (file) {
  try {
    const data = await readBackup(file)
    const ok = await modal({
      title: '恢复备份',
      okText: '导入',
      body: `<div style="font-size:13.5px;line-height:1.9;color:var(--ink2)">
        文件里有 <b>${data.books.length}</b> 本书、<b>${data.problems.length}</b> 道题、${data.images.length} 张图。<br>
        将作为新书籍追加进来，不会覆盖现有内容。</div>`
    })
    if (!ok) return

    toast('正在导入…')
    const { books, problems } = await applyBackup(data)
    if (books[0]) S.bookId = books[0].id
    renderAll()
    toast('导入完成', problems.length + ' 题')
  } catch (e) {
    console.error(e)
    toast('导入失败：' + e.message)
  }
}
