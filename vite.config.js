import { defineConfig } from 'vite'

/**
 * 一套源码两个产物：
 *   --mode app  → dist-app  相对路径，供 Electron 的 loadFile 加载
 *   --mode web  → dist-web  绝对路径，供 Cloudflare Pages 托管
 */
export default defineConfig(({ mode }) => {
  const isApp = mode === 'app'
  return {
    base: isApp ? './' : '/',
    build: {
      outDir: isApp ? 'dist-app' : 'dist-web',
      emptyOutDir: true,
      target: 'chrome122',
      chunkSizeWarningLimit: 1200
    },
    server: {
      port: 5173,
      strictPort: true
    }
  }
})
