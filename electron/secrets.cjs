/**
 * API Key 存储。
 *
 * 用 Electron 的 safeStorage 做系统级加密（Windows 走 DPAPI，绑当前用户账户），
 * 密文落到 userData/secrets.json，不进 IndexedDB。
 *
 * 某些精简的 Linux 桌面环境拿不到密钥环，safeStorage 会不可用；
 * 那种情况下降级为明文存储并在返回值里标记，让界面能提示用户。
 */
const fs = require('node:fs')
const path = require('node:path')

let file = null
let cache = null

function load (app) {
  if (cache) return cache
  file = path.join(app.getPath('userData'), 'secrets.json')
  try {
    cache = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (_) {
    cache = {}
  }
  return cache
}

function flush () {
  try {
    fs.writeFileSync(file, JSON.stringify(cache), { mode: 0o600 })
  } catch (e) {
    console.error('[secrets] 写入失败', e)
  }
}

function registerSecrets (ipcMain, app, safeStorage) {
  const usable = () => {
    try { return safeStorage.isEncryptionAvailable() } catch (_) { return false }
  }

  ipcMain.handle('secret:set', (_e, key, value) => {
    const store = load(app)
    if (!value) delete store[key]
    else if (usable()) {
      store[key] = { enc: true, v: safeStorage.encryptString(String(value)).toString('base64') }
    } else {
      store[key] = { enc: false, v: String(value) }
    }
    flush()
    return { ok: true, encrypted: usable() }
  })

  ipcMain.handle('secret:get', (_e, key) => {
    const rec = load(app)[key]
    if (!rec) return ''
    if (!rec.enc) return rec.v
    try {
      return safeStorage.decryptString(Buffer.from(rec.v, 'base64'))
    } catch (e) {
      // 换了机器或用户账户，旧密文解不开
      console.error('[secrets] 解密失败', e)
      return ''
    }
  })

  ipcMain.handle('secret:available', () => usable())
}

module.exports = { registerSecrets }
