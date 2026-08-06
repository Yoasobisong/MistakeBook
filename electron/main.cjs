const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, shell } = require('electron')
const path = require('node:path')
const { registerAI } = require('./ai-proxy.cjs')
const { registerSecrets } = require('./secrets.cjs')
const { registerBackup } = require('./backup.cjs')

const DEV_URL = process.env.DEV_SERVER_URL

// 单实例：IndexedDB 同时被两个窗口打开会互相阻塞
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win = null

/**
 * 菜单栏默认隐藏（Alt 唤出），但必须存在。
 * Electron 里剪贴板快捷键依赖菜单的 role 注册 —— 没有菜单，Ctrl+V 粘贴截图会失效，
 * 而粘贴正是这个应用最核心的录入方式。
 */
function buildMenu () {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        { role: 'close', label: '关闭' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    }
  ]))
}

function createWindow () {
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#F3F5F6',
    title: '错题本',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  if (DEV_URL) {
    win.loadURL(DEV_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist-app', 'index.html'))
  }

  // 外链交给系统浏览器，不在应用内开窗
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => { win = null })
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.whenReady().then(() => {
  registerSecrets(ipcMain, app, safeStorage)
  registerAI(ipcMain)
  registerBackup(ipcMain, app, dialog, BrowserWindow)
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
