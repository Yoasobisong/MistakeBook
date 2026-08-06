/**
 * 网页版端到端冒烟测试：
 *   1. 起一个本地 mock API(静态文件 + /api/snapshot、/api/img/:id、/api/stat)
 *   2. 用隐藏的 Electron 窗口加载 dist-web,执行 JS 检查只读模式行为
 *   3. 打印检查结果,有失败则非零退出
 *
 * 用法:node scripts/web-smoke.cjs  (需先 npm run build:web)
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.join(__dirname, '..')
const WEB = path.join(ROOT, 'dist-web')
const PORT = 8901

/* ---------- mock 数据 ---------- */

const NOW = Date.now()
const mk = (id, patch) => ({
  id, bookId: 'bk1', chapterId: 'ch1', no: 1, title: '', kind: 'wrong',
  difficulty: 3, difficultyManual: 0, mastery: 0, starred: 0, source: '',
  note: '', reasons: [], topics: [], latex: { q: '', a: '', x: '' },
  ai: { extractedAt: 0, analyzedAt: 0, topics: [], difficulty: 0, error: null },
  images: [], reviewCount: 0, lastReviewAt: 0,
  createdAt: NOW, updatedAt: NOW, deletedAt: 0,
  ...patch
})

const problems = [
  mk('p1', { no: 1, title: '极限计算', kind: 'wrong', difficulty: 4, mastery: 2,
    starred: 1, reasons: ['洛必达误用'], topics: ['洛必达法则', '等价无穷小'],
    latex: { q: '求 $\\lim_{x\\to 0}\\frac{\\sin 3x}{x}$', a: '3', x: '' },
    images: [{ id: 'img1', slot: 'q', cap: '' }] }),
  mk('p2', { no: 2, title: '线代特征值', difficulty: 2, mastery: 1,
    note: '### 错因\n忘了特征向量正交。',
    latex: { q: '求矩阵的特征值。', a: '', x: '' } }),
  mk('p3', { no: 3, title: '', chapterId: null }),
  // 只有截图、没有文字版的题:卡片应显示缩略图
  mk('p4', { no: 4, title: '纯图题', chapterId: 'ch2', images: [{ id: 'img1', slot: 'q', cap: '' }] })
]

const snapshot = {
  at: NOW,
  books: [{ id: 'bk1', name: '高等数学 上', seq: 1, createdAt: NOW, updatedAt: NOW, deletedAt: 0 }],
  chapters: [
    { id: 'ch1', bookId: 'bk1', parentId: null, title: '极限与连续', order: 0, collapsed: 0, createdAt: NOW, updatedAt: NOW, deletedAt: 0 },
    { id: 'ch2', bookId: 'bk1', parentId: null, title: '导数', order: 1, collapsed: 0, createdAt: NOW, updatedAt: NOW, deletedAt: 0 }
  ],
  problems,
  images: [
    { id: 'img1', w: 60, h: 40, polarity: 'light', ext: 'png', size: 68, createdAt: NOW }
  ]
}

// 1x1 红色 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64')

/* ---------- mock 服务器 ---------- */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png' }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1:' + PORT)
  const p = u.pathname

  if (p === '/api/snapshot') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(snapshot))
    return
  }
  if (p === '/api/stat') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ problems: 3, images: 1, bytes: 68, lastPush: NOW }))
    return
  }
  if (p.startsWith('/api/img/')) {
    const id = p.slice('/api/img/'.length)
    if (id === 'img1') {
      res.setHeader('content-type', 'image/png')
      res.setHeader('cache-control', 'public, max-age=31536000, immutable')
      res.end(PNG)
    } else {
      res.statusCode = 404
      res.end('not found')
    }
    return
  }

  // 静态文件
  let file = path.join(WEB, p === '/' ? 'index.html' : p)
  if (!file.startsWith(WEB)) { res.statusCode = 403; res.end('forbidden'); return }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; res.end('not found'); return }
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream')
    res.end(buf)
  })
})

/* ---------- Electron 驱动 ---------- */

const CHECKS = `
(async () => {
  const out = {}
  const $ = s => document.querySelector(s)
  out.readonlyClass = document.body.classList.contains('readonly')
  out.roBadgeVisible = !!$('#roBadge') && !$('#roBadge').classList.contains('hidden')
  out.roBadgeText = $('#roBadge')?.textContent
  out.btnCloudHidden = !!$('#btnCloud') && $('#btnCloud').classList.contains('hidden')
  out.writeBtnsGone = ['btnNew','btnSel','btnAddCh','btnImportToc','btnDetDel'].every(id => !document.getElementById(id))
  out.cards = document.querySelectorAll('#cards .card').length
  out.treeNodes = document.querySelectorAll('#tree .node').length
  out.treeActsGone = !document.querySelector('#tree [data-ch]')
  out.bookName = $('#bookName')?.textContent
  const imgs = Array.from(document.querySelectorAll('#cards img[data-img]'))
  out.cardImgSrc = imgs[0] ? (imgs[0].getAttribute('src') || '').slice(0, 60) : ''
  out.cardImgPol = imgs[0] ? imgs[0].className : ''
  out.cardImgDone = imgs[0] ? imgs[0].dataset.done : ''
  out.cardImgOuter = imgs[0] ? imgs[0].outerHTML.slice(0, 260) : ''
  out.cardImgCount = imgs.length
  // 打开第一题详情
  const card = document.querySelector('#cards .card')
  if (card) { card.click() }
  await new Promise(r => setTimeout(r, 800))
  out.view = $('#viewDetail')?.classList.contains('hidden') ? 'list' : 'detail'
  out.titleIsReadonly = !!$('.det-title.ro')
  out.pStarGone = !$('#pStar')
  const sideWriteSel = '#detSide [data-diff],#detSide [data-mast],#detSide [data-kind],#detSide [data-addr],#detSide [data-addt],#detSide #pChapter,#detSide #pSource,#detSide #pReview,#detSide [data-aiact]'
  out.sideWriteGone = !document.querySelector(sideWriteSel)
  out.sideWriteLeft = Array.from(document.querySelectorAll(sideWriteSel)).map(el => el.outerHTML.slice(0, 80))
  out.sideShowsReasons = document.querySelectorAll('#detSide .tagbox .t').length
  out.shotToolbarGone = !document.querySelector('.shot-t')
  // 有文字版时截图默认折叠,点开折叠按钮再看图片
  const shotfold = document.querySelector('[data-shotfold]')
  out.shotFoldBtn = !!shotfold
  if (shotfold) { shotfold.click(); await new Promise(r => setTimeout(r, 600)) }
  out.shotImgSrc = ($('#detMain img[data-img]')?.getAttribute('src') || '').slice(0, 60)
  out.shotImgPol = $('#detMain img[data-img]')?.className || ''
  out.noteEditGone = !document.querySelector('[data-editnote]')
  // 设置弹窗:应该只有「通用」一个 tab
  $('#btnSet')?.click()
  await new Promise(r => setTimeout(r, 300))
  out.settingsTabs = Array.from(document.querySelectorAll('[data-tab]')).map(b => b.textContent)
  document.querySelector('[data-x]')?.click()
  return out
})()
`

async function main () {
  server.listen(PORT, '127.0.0.1')
  await new Promise(r => server.once('listening', r))

  const { app, BrowserWindow } = require('electron')
  await app.whenReady()
  const win = new BrowserWindow({ show: false, width: 1280, height: 900 })

  const errors = []
  win.webContents.on('console-message', (e, level, msg) => {
    // 忽略 Electron 对 http 页面无 CSP 的开发警告 —— 与业务无关
    if (level >= 2 && !String(msg).includes('Content-Security-Policy') && !String(msg).includes('Insecure Content')) errors.push(msg.slice(0, 200))
  })
  win.webContents.on('render-process-gone', (e, d) => errors.push('renderer gone: ' + d.reason))

  await win.loadURL('http://127.0.0.1:' + PORT + '/')
  // 等 hydrate 和首帧渲染
  await new Promise(r => setTimeout(r, 1500))
  const result = await win.webContents.executeJavaScript(CHECKS, true)

  console.log(JSON.stringify({ result, errors }, null, 2))

  let fail = 0
  const expect = {
    readonlyClass: true, roBadgeVisible: true, writeBtnsGone: true,
    cards: 4, treeNodes: 4, treeActsGone: true, bookName: '高等数学 上'
  }
  for (const [k, v] of Object.entries(expect)) {
    if (result[k] !== v) { console.error('FAIL:', k, 'expected', v, 'got', result[k]); fail++ }
  }
  if (result.btnCloudHidden !== true) { console.error('FAIL: btnCloudHidden (只读版云同步按钮应隐藏)', result.btnCloudHidden); fail++ }
  if (!result.titleIsReadonly) { console.error('FAIL: titleIsReadonly'); fail++ }
  if (!result.sideWriteGone) { console.error('FAIL: sideWriteGone'); fail++ }
  if (!result.shotToolbarGone) { console.error('FAIL: shotToolbarGone'); fail++ }
  if (result.cardImgCount !== 1) { console.error('FAIL: cardImgCount (纯图题应有缩略图)', result.cardImgCount); fail++ }
  if (!result.cardImgSrc.includes('/api/img/')) { console.error('FAIL: cardImgSrc remote', result.cardImgSrc); fail++ }
  if (!result.shotImgSrc.includes('/api/img/')) { console.error('FAIL: shotImgSrc remote', result.shotImgSrc); fail++ }
  if (!result.shotImgPol.includes('pol-light')) { console.error('FAIL: shotImgPol polarity class', result.shotImgPol); fail++ }
  if (!result.settingsTabs || result.settingsTabs.length !== 1 || result.settingsTabs[0] !== '通用') { console.error('FAIL: settingsTabs', result.settingsTabs); fail++ }
  if (errors.length) { console.error('CONSOLE ERRORS:'); errors.forEach(e => console.error('  ', e)); fail++ }
  if (result.view !== 'detail') { console.error('FAIL: open detail'); fail++ }

  console.log(fail ? `\n${fail} FAILURES` : '\nALL PASS')
  server.close()
  app.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
