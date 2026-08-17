/**
 * 网页只读模式的数据源。
 *
 * 网页端不碰 IndexedDB —— 手机上的本地库永远是空的，存了也没意义。
 * 启动时拉一次全量元数据放进内存，图片按需从 R2 走 API 取。
 *
 * 元数据体积很小（500 题约 1MB，gzip 后更少），一次拉完比分页省事得多。
 */
import { apiURL } from '../core/env.js'
import { S, migrateBook, migrateChapter, migrateProblem, mergeSettings } from '../core/state.js'

/** 图片元数据，供 polarity 判断用 */
const imageMeta = new Map()

export const remoteImageMeta = id => imageMeta.get(id)

/* ---------- 登录墙 ----------
 * Worker 配了 VIEW_KEY 后，读接口要求 x-view-key 头或 ?key= 参数。
 * 网页版打开时让用户输一次密码，存 sessionStorage，之后所有请求自动带上。
 */
const KEY = 'mb.viewKey'

export const getViewKey = () => {
  try { return sessionStorage.getItem(KEY) || '' } catch (_) { return '' }
}

export const setViewKey = k => {
  try { sessionStorage.setItem(KEY, k) } catch (_) {}
}

/** fetch 封装：自动带 x-view-key 头 */
async function apiFetch (path) {
  const opts = { credentials: 'include' }
  const key = getViewKey()
  if (key) opts.headers = { 'x-view-key': key }
  return fetch(apiURL(path), opts)
}

export async function loadRemote () {
  const res = await apiFetch('/api/snapshot')
  if (!res.ok) {
    throw new Error(res.status === 401 || res.status === 403
      ? '没有访问权限，请先登录'
      : `拉取失败：HTTP ${res.status}`)
  }

  const d = await res.json()

  S.books = (d.books || []).map(migrateBook)
  S.chapters = (d.chapters || []).map(migrateChapter)
  S.problems = (d.problems || []).map(migrateProblem)
  S.settings = mergeSettings(null)

  imageMeta.clear()
  // 云端只存答案/补充的图（题目截图不上传），这里再过滤一道，防止旧快照残留
  for (const im of d.images || []) {
    if (im.slot === 'q') continue
    imageMeta.set(im.id, im)
  }

  if (!S.bookId || !S.books.some(b => b.id === S.bookId)) {
    S.bookId = S.books[0]?.id || null
  }
  return d
}

/**
 * 云端图片直接用 URL，不下载成 blob —— 浏览器自己会缓存，还能走 CDN。
 * 图片 <img> 没法带自定义请求头，只能把 key 拼进 URL（Worker 也认 ?key= 参数）。
 *
 * 试过改成 HttpOnly cookie 把密码从 URL 里拿掉（免得它进 Cloudflare 访问日志、
 * 浏览器历史和 referrer），但在实际部署下图片会全部 401，已回退。
 * 真要再动这块，更稳的路子是让图片走 apiFetch 拿 blob 再转 Object URL ——
 * 那样带的是请求头，同域分域都不受影响。
 */
export const remoteImgURL = id => {
  const u = apiURL('/api/img/' + id)
  const key = getViewKey()
  return key ? u + '?key=' + encodeURIComponent(key) : u
}

export async function remoteStat () {
  try {
    const r = await apiFetch('/api/stat')
    return r.ok ? r.json() : null
  } catch (_) {
    return null
  }
}
