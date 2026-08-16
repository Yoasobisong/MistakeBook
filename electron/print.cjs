/**
 * 导出 PDF（主进程）。
 *
 * 为什么不用渲染进程的 window.print()：
 * 那条路必然经过 Chromium 的打印对话框，而对话框里的「布局」下拉框
 * 决定纸张框，优先级高于 CSS 的 @page size。于是会出现
 * 「内容按横向排好了、纸却还是竖的」—— 横向内容被旋转 90° 塞进竖版纸，
 * 得在 PDF 阅读器里手动转一下才能看。
 *
 * printToPDF 直接由代码指定 landscape 和纸张，绕开对话框，
 * 顺带省掉「选打印机 → 另存为 PDF」那两步。
 *
 * 网页只读版没有这条通道，仍旧走 window.print()。
 */
const fs = require('node:fs')
const path = require('node:path')

/** mm → in，printToPDF 的边距单位是英寸 */
const mm = v => v / 25.4

function registerPrint (ipcMain, app, dialog, BrowserWindow) {
  /**
   * @param opts.landscape 横向
   * @param opts.name      建议的文件名（不含扩展名）
   * @param opts.margin    页边距，毫米
   */
  ipcMain.handle('print:pdf', async (evt, { landscape = false, name = '错题本', margin = 12 } = {}) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win) return { ok: false, error: '找不到窗口' }

    try {
      // 先问路径再渲染：用户取消的话就不用白跑一遍排版
      const r = await dialog.showSaveDialog(win, {
        title: '导出 PDF',
        defaultPath: path.join(app.getPath('documents'), name.replace(/[\\/:*?"<>|]/g, '_') + '.pdf'),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (r.canceled || !r.filePath) return { ok: false, canceled: true }

      // printToPDF 走的是打印媒体，@media print 里的规则照常生效，
      // 所以 #printRoot 会显示、主界面会隐藏，和 window.print() 一致
      const data = await evt.sender.printToPDF({
        landscape,
        pageSize: 'A4',
        printBackground: true,
        margins: { top: mm(margin), bottom: mm(margin), left: mm(margin), right: mm(margin) }
      })

      fs.writeFileSync(r.filePath, data)
      return { ok: true, file: r.filePath, size: data.length }
    } catch (e) {
      return { ok: false, error: String(e?.message || e) }
    }
  })

  ipcMain.handle('print:reveal', (_e, file) => {
    require('electron').shell.showItemInFolder(file)
    return true
  })
}

module.exports = { registerPrint }
