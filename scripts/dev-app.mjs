/**
 * 开发模式：起 Vite dev server，就绪后拉起 Electron 指向它。
 * 不引入 concurrently 等额外依赖。
 */
import { spawn } from 'node:child_process'
import process from 'node:process'

const URL = 'http://localhost:5173'
const isWin = process.platform === 'win32'
const npx = isWin ? 'npx.cmd' : 'npx'

const vite = spawn(npx, ['vite'], { stdio: ['inherit', 'pipe', 'inherit'], shell: isWin })

let started = false
vite.stdout.on('data', chunk => {
  process.stdout.write(chunk)
  if (started || !String(chunk).includes('ready in')) return
  started = true
  const electron = spawn(npx, ['electron', '.'], {
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env, DEV_SERVER_URL: URL }
  })
  electron.on('close', () => { vite.kill(); process.exit(0) })
})

const bye = () => { vite.kill(); process.exit(0) }
process.on('SIGINT', bye)
process.on('SIGTERM', bye)
