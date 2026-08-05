/**
 * 图片管线：解码 → 自动裁白边 → 缩放 → 编码 → 入库，以及取用时的 URL 缓存。
 */
import { uid } from '../core/dom.js'
import { S } from '../core/state.js'
import { dbGet, dbPut } from './db.js'

/* ---------- 编解码基础 ---------- */

let WEBP = null
export function canWebp () {
  if (WEBP === null) {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    WEBP = c.toDataURL('image/webp').indexOf('data:image/webp') === 0
  }
  return WEBP
}

export const loadBitmap = blob => new Promise((res, rej) => {
  const u = URL.createObjectURL(blob)
  const im = new Image()
  im.onload = () => { res(im); setTimeout(() => URL.revokeObjectURL(u), 8000) }
  im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('图片解码失败')) }
  im.src = u
})

export const canvasBlob = (cv, type, q) => new Promise(res => cv.toBlob(res, type, q))

export const blobToDataURL = b => new Promise(r => {
  const f = new FileReader()
  f.onload = () => r(f.result)
  f.readAsDataURL(b)
})

export const dataURLToBlob = async u => (await fetch(u)).blob()

/* ---------- 裁边与缩放 ---------- */

/** 扫描四周纯色边缘并裁掉（PDF 截图常见大片白边） */
export function autoTrim (cv) {
  const w = cv.width
  const h = cv.height
  if (w < 40 || h < 40) return cv

  const ctx = cv.getContext('2d', { willReadFrequently: true })
  let d
  try { d = ctx.getImageData(0, 0, w, h).data } catch (e) { return cv }

  const at = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]] }
  const c0 = at(0, 0); const c1 = at(w - 1, 0); const c2 = at(0, h - 1)
  const same = (a, b) => Math.abs(a[0] - b[0]) < 10 && Math.abs(a[1] - b[1]) < 10 && Math.abs(a[2] - b[2]) < 10
  if (!same(c0, c1) || !same(c0, c2)) return cv // 边角颜色不一致，多半没有纯色边

  const bg = c0; const TOL = 14; const STEP = Math.max(1, Math.floor(w / 900))
  const off = p => Math.abs(p[0] - bg[0]) > TOL || Math.abs(p[1] - bg[1]) > TOL || Math.abs(p[2] - bg[2]) > TOL
  const rowPlain = y => { for (let x = 0; x < w; x += STEP) if (off(at(x, y))) return false; return true }
  const colPlain = x => { for (let y = 0; y < h; y += STEP) if (off(at(x, y))) return false; return true }

  let t = 0; let b = h - 1; let l = 0; let r = w - 1
  while (t < h - 1 && rowPlain(t)) t++
  while (b > t + 1 && rowPlain(b)) b--
  while (l < w - 1 && colPlain(l)) l++
  while (r > l + 1 && colPlain(r)) r--

  const P = 8
  t = Math.max(0, t - P); b = Math.min(h - 1, b + P)
  l = Math.max(0, l - P); r = Math.min(w - 1, r + P)

  const nw = r - l + 1; const nh = b - t + 1
  if (nw < w * 0.25 || nh < h * 0.25) return cv // 疑似误裁，放弃
  if (nw > w - 6 && nh > h - 6) return cv // 没什么可裁

  const o = document.createElement('canvas')
  o.width = nw; o.height = nh
  const octx = o.getContext('2d')
  octx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`
  octx.fillRect(0, 0, nw, nh)
  octx.drawImage(cv, l, t, nw, nh, 0, 0, nw, nh)
  return o
}

export function scaleTo (src, maxW) {
  if (src.width <= maxW) return src
  const k = maxW / src.width
  const o = document.createElement('canvas')
  o.width = Math.round(src.width * k)
  o.height = Math.round(src.height * k)
  const c = o.getContext('2d')
  c.imageSmoothingQuality = 'high'
  c.drawImage(src, 0, 0, o.width, o.height)
  return o
}

/* ---------- 入库 ---------- */

/**
 * 判断是不是「黑白扫描件」——底色接近白、内容接近灰阶、几乎没有饱和色。
 *
 * 只有这种图在暗色模式下才适合反相：整页会变成深底浅字，和界面融为一体。
 * 彩色的图（照片、带彩色批注的讲义）反相会变成负片，必须排除。
 */
/**
 * 判断图片的**底色极性**，决定它该在哪个主题下反相。
 *
 * 不能只问「是不是黑白图」—— 那样只覆盖了浅底深字一种。
 * 从暗色 PDF 阅读器截下来的图是深底浅字，它在暗色主题下本来就协调，
 * 反而是切到白天模式时需要反相，否则一片黑压在白纸上。
 *
 * @returns 'light' 浅底深字，暗色主题下反相（试卷扫描、普通 PDF 截图）
 *          'dark'  深底浅字，白天主题下反相（暗色阅读器、深色 IDE 截图）
 *          'color' 彩色或中间调，任何主题下都不动
 */
function detectPolarity (cv) {
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  let d
  try { d = ctx.getImageData(0, 0, cv.width, cv.height).data } catch (_) { return 'light' }

  // 均匀抽样约两万个像素，大图也不至于逐像素扫
  const total = d.length / 4
  const stride = Math.max(1, Math.floor(total / 20000))
  let n = 0
  let light = 0
  let dark = 0
  let saturated = 0

  for (let px = 0; px < total; px += stride) {
    const i = px * 4
    const r = d[i]; const g = d[i + 1]; const b = d[i + 2]
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    n++
    if (mx - mn > 34) saturated++   // 有明显色相 → 彩色像素
    if (mn > 205) light++           // 接近白
    else if (mx < 62) dark++        // 接近黑
  }
  if (!n) return 'light'

  // 彩色像素超过 6% 就是真彩图，反相会变成负片
  if (saturated / n >= 0.06) return 'color'
  if (light / n > 0.5) return 'light'
  if (dark / n > 0.5) return 'dark'
  // 灰蒙蒙的中间调，反相收益不确定，保守起见不动
  return 'color'
}

/** 兼容旧数据：以前只存了 mono 布尔值 */
const polarityOfRec = rec =>
  rec.polarity || (rec.mono === false ? 'color' : 'light')

/** blob → 处理后写入 images 仓，返回图片记录 */
export async function importImage (blob) {
  const im = await loadBitmap(blob)
  let cv = document.createElement('canvas')
  cv.width = im.naturalWidth
  cv.height = im.naturalHeight
  cv.getContext('2d').drawImage(im, 0, 0)

  if (S.settings.autoTrim) cv = autoTrim(cv)

  const polarity = detectPolarity(cv)
  const full = scaleTo(cv, S.settings.maxW)
  const thumbCv = scaleTo(cv, 620)
  const type = canWebp() ? 'image/webp' : 'image/jpeg'

  let fb = await canvasBlob(full, type, 0.93)
  const tb = await canvasBlob(thumbCv, type, 0.78)
  // 原图本来就更小、且没做过任何加工，就留原图
  if (blob.size < fb.size && cv === full && !S.settings.autoTrim) fb = blob

  const rec = {
    id: uid(), full: fb, thumb: tb,
    w: full.width, h: full.height,
    polarity, // 'light' | 'dark' | 'color'，决定在哪个主题下反相，可在详情页手动改
    size: fb.size + tb.size, createdAt: Date.now()
  }
  await dbPut('images', rec)
  return rec
}

/* ---------- 取用：Object URL 缓存 ---------- */

const urlCache = new Map()
const polCache = new Map()

export async function imgURL (id, kind) {
  const key = id + ':' + kind
  if (urlCache.has(key)) return urlCache.get(key)
  const rec = await dbGet('images', id)
  if (!rec) return ''
  polCache.set(id, polarityOfRec(rec))
  const blob = kind === 'thumb' ? (rec.thumb || rec.full) : (rec.full || rec.thumb)
  const u = URL.createObjectURL(blob)
  urlCache.set(key, u)
  return u
}

export const POLARITIES = ['light', 'dark', 'color']

export const POLARITY_LABEL = {
  light: '浅底深字 · 暗色主题下反相',
  dark: '深底浅字 · 白天主题下反相',
  color: '彩色 · 任何主题都不反相'
}

/** 这张图的底色极性 */
export const polarityOf = id => polCache.get(id) || 'light'

/** 手动纠正自动判断的结果 */
export async function setPolarity (id, polarity) {
  const rec = await dbGet('images', id)
  if (!rec) return
  rec.polarity = polarity
  delete rec.mono // 旧字段清掉，避免两套语义并存
  await dbPut('images', rec)
  polCache.set(id, polarity)
}

/**
 * 释放某张图的 Object URL。
 * 删除题目/书籍时必须调用，否则 blob 会一直被 URL 引用着占内存。
 */
export function forgetImage (id) {
  for (const kind of ['full', 'thumb']) {
    const key = id + ':' + kind
    const u = urlCache.get(key)
    if (u) { URL.revokeObjectURL(u); urlCache.delete(key) }
  }
  polCache.delete(id)
}

export const forgetImages = ids => ids.forEach(forgetImage)

/** 把 <img data-img="..."> 填上真实 src */
export async function hydrate (root) {
  const els = Array.from((root || document).querySelectorAll('img[data-img]'))
  for (const el of els) {
    if (el.dataset.done) continue
    el.dataset.done = '1'
    const u = await imgURL(el.dataset.img, el.dataset.kind || 'thumb')
    if (!u) { el.remove(); continue }
    el.src = u
    // 按底色极性决定在哪个主题下反相，具体规则在 tokens.css 里
    el.classList.add('pol-' + polarityOf(el.dataset.img))
  }
}

/* ---------- 发给视觉模型用 ---------- */

/**
 * 转成 JPEG data URL。
 * 库里存的是 WebP，而不少推理后端（含部分 Ollama 视觉模型）不认 WebP，
 * 所以送进模型前统一重编码。顺带限制边长，省 token 也省显存。
 */
export async function imageForVision (id, maxW = 1400) {
  const rec = await dbGet('images', id)
  if (!rec) return null
  return blobForVision(rec.full || rec.thumb, maxW)
}

/** 同上，但直接吃 Blob —— 目录截图还没入库就要先识别 */
export async function blobForVision (blob, maxW = 1600) {
  const im = await loadBitmap(blob)
  let cv = document.createElement('canvas')
  cv.width = im.naturalWidth
  cv.height = im.naturalHeight
  cv.getContext('2d').drawImage(im, 0, 0)
  cv = scaleTo(cv, maxW)
  return cv.toDataURL('image/jpeg', 0.9)
}
