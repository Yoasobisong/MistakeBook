const { contextBridge, ipcRenderer } = require('electron')

const rid = () => Math.random().toString(36).slice(2, 10)

/**
 * 暴露给渲染进程的最小接口。
 * 只开放具体能力，不透传 ipcRenderer —— 避免渲染进程能调任意通道。
 */
contextBridge.exposeInMainWorld('native', {
  isElectron: true,
  platform: process.platform,

  ai: {
    /**
     * @param opts    {id, baseURL, apiKey, model, messages, jsonMode, timeoutMs, temperature}
     *                id 由调用方生成并保留，以便中途调 abort(id)
     * @param onChunk 传了就走流式，每收到一段文本回调一次
     * @returns {ok, text, usage} | {ok:false, error}
     */
    chat (opts, onChunk) {
      const id = opts.id || rid()
      if (!onChunk) return ipcRenderer.invoke('ai:chat', { ...opts, id })

      const ch = 'ai:chunk:' + id
      const h = (_e, text) => onChunk(text)
      ipcRenderer.on(ch, h)
      return ipcRenderer
        .invoke('ai:chat', { ...opts, id, stream: true })
        .finally(() => ipcRenderer.removeListener(ch, h))
    },
    models: opts => ipcRenderer.invoke('ai:models', opts),
    abort: id => ipcRenderer.invoke('ai:abort', id)
  },

  secret: {
    get: key => ipcRenderer.invoke('secret:get', key),
    set: (key, value) => ipcRenderer.invoke('secret:set', key, value),
    available: () => ipcRenderer.invoke('secret:available')
  },

  backup: {
    pickDir: () => ipcRenderer.invoke('backup:pickDir'),
    defaultDir: () => ipcRenderer.invoke('backup:defaultDir'),
    list: dir => ipcRenderer.invoke('backup:list', dir),
    write: opts => ipcRenderer.invoke('backup:write', opts),
    reveal: dir => ipcRenderer.invoke('backup:reveal', dir),

    // 增量格式
    snapshots: dir => ipcRenderer.invoke('backup:snapshots', dir),
    haveImages: dir => ipcRenderer.invoke('backup:haveImages', dir),
    writeIncremental: opts => ipcRenderer.invoke('backup:writeIncremental', opts),
    readSnapshot: opts => ipcRenderer.invoke('backup:readSnapshot', opts)
  },

  print: {
    /** @param opts {landscape, name, margin} → {ok, file, size} | {ok:false, canceled|error} */
    toPDF: opts => ipcRenderer.invoke('print:pdf', opts),
    reveal: file => ipcRenderer.invoke('print:reveal', file)
  }
})
