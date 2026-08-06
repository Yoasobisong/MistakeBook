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

export async function loadRemote () {
  const res = await fetch(apiURL('/api/snapshot'), { credentials: 'include' })
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
  for (const im of d.images || []) imageMeta.set(im.id, im)

  if (!S.bookId || !S.books.some(b => b.id === S.bookId)) {
    S.bookId = S.books[0]?.id || null
  }
  return d
}

/** 云端图片直接用 URL，不下载成 blob —— 浏览器自己会缓存，还能走 CDN */
export const remoteImgURL = id => apiURL('/api/img/' + id)

export async function remoteStat () {
  try {
    const r = await fetch(apiURL('/api/stat'), { credentials: 'include' })
    return r.ok ? r.json() : null
  } catch (_) {
    return null
  }
}
