/**
 * 运行环境判定。
 *
 * 三种形态：
 *   Electron   —— 完整功能，唯一的写入方
 *   浏览器 dev  —— 完整功能，方便 npm run dev 调试
 *   网页发布版  —— 只读，数据来自云端 API，不落本地库
 */

/** vite build --mode web 产出的才是只读的网页版 */
export const IS_WEB = import.meta.env.MODE === 'web'

export const READONLY = IS_WEB

export const IS_ELECTRON = typeof window !== 'undefined' && !!window.native

/** 同域部署时留空走相对路径；分域时在 GitHub vars 里配 API_BASE */
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')

export const apiURL = path => API_BASE + path
