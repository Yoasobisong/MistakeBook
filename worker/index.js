/**
 * 云端 API。
 *
 * 桌面版是唯一写入方，网页端只读，所以这里没有冲突处理、没有版本向量，
 * 推上来什么就存什么。写接口靠 PUSH_TOKEN 保护，读接口交给 Cloudflare Access。
 *
 * 图片存 Worker KV 而不是 R2 —— KV 免费 1GB 且开通不用绑卡。
 * 图片按 id 命名、永不修改，正好吃 KV 的最终一致（写一次读多次）。
 *
 * 路由：
 *   GET  /api/snapshot   拉全量元数据（网页端启动时调一次）
 *   GET  /api/img/:id    取图片，直接从 KV 流出
 *   GET  /api/stat       题数/图数/上次推送时间
 *   POST /api/push       推送元数据（桌面版）
 *   PUT  /api/img/:id    上传图片（桌面版）
 *   POST /api/haveimg    查询哪些图已在云端，用来算增量
 */

const json = (data, status = 200, extra) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(extra || {}) }
  })

const JSON_FIELDS = ['reasons', 'topics', 'latex', 'ai', 'images']

/** D1 里嵌套字段存的是 JSON 文本，取出来要还原 */
function reviveProblem (row) {
  const p = { ...row }
  for (const f of JSON_FIELDS) {
    try { p[f] = JSON.parse(row[f] || 'null') } catch (_) { p[f] = null }
  }
  // 题目(q)截图不上云。写入时已经剥过一道，这里出库时再剥一道 ——
  // 早期版本推上来的老行里仍然残留着 q 槽引用，那些图早被 prune 清掉了，
  // 不剥的话网页端会照着渲染出一排取不到的碎图标
  if (Array.isArray(p.images)) p.images = p.images.filter(im => im.slot !== 'q')
  p.starred = !!row.starred
  p.difficultyManual = !!row.difficultyManual
  return p
}

/** 写接口的令牌校验。读接口不查这个，由 Cloudflare Access 拦在前面 */
function authed (req, env) {
  const t = req.headers.get('x-push-token')
  return !!env.PUSH_TOKEN && t === env.PUSH_TOKEN
}

/**
 * 读接口的密码校验（登录墙，替代 Cloudflare Access —— 免费版开通要绑卡）。
 *
 * 三个来源，按可靠性排序：
 *   1. x-view-key 请求头 —— fetch 调用走这条
 *   2. mbview cookie    —— <img> 没法带自定义头，靠它；由 snapshot 成功时种下
 *   3. ?key= 查询参数    —— **已废弃**，只为兼容还没刷新的旧客户端
 *
 * 第 3 条正是要摆脱的东西：密码出现在 URL 里，会被记进 Cloudflare 访问日志、
 * 浏览器历史和 referrer 头。新客户端不再生成它，但服务端留着不碍事。
 *
 * 密码存在 env.VIEW_KEY，用 `wrangler secret put VIEW_KEY` 设置。
 * 没配 VIEW_KEY 就完全放行（保持旧行为），配了就要求密码一致。
 */
const COOKIE = 'mbview'

function cookieValue (req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim())
    }
  }
  return ''
}

function viewAuthed (req, env) {
  if (!env.VIEW_KEY) return true
  const head = req.headers.get('x-view-key')
  if (head && head === env.VIEW_KEY) return true
  if (cookieValue(req, COOKIE) === env.VIEW_KEY) return true
  const q = new URL(req.url).searchParams.get('key')
  return !!q && q === env.VIEW_KEY
}

/**
 * 校验通过后种下 cookie，之后图片请求由浏览器自动带上。
 *
 * SameSite=None 是为了兼容前端与 Worker 分域部署 —— 那种情况下图片
 * 属于跨站请求，Lax 的 cookie 不会被带上。读接口全是幂等 GET、
 * 写接口另有 PUSH_TOKEN 把关，所以不存在 CSRF 面。
 * HttpOnly 让页面脚本读不到它，XSS 也偷不走。
 */
function withKeyCookie (res, env) {
  if (!env.VIEW_KEY) return res
  const h = new Headers(res.headers)
  h.append('set-cookie',
    `${COOKIE}=${encodeURIComponent(env.VIEW_KEY)}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=None`)
  return new Response(res.body, { status: res.status, headers: h })
}

const needViewAuth = (req, env) => {
  if (viewAuthed(req, env)) return null
  return json({ error: 'unauthorized' }, 401)
}

/* ---------- 读 ---------- */

async function snapshot (env, req) {
  /**
   * 用 lastPush 当 ETag：云端数据只在桌面版推送时变，
   * 这个时间戳天然就是版本号。手机上重复打开时直接 304，
   * 省掉整份快照的传输（500 题约 1MB）。
   *
   * cache-control 必须是 no-cache 而不是 no-store —— 前者表示
   * 「可以存但每次都要回来验」，正好触发 If-None-Match；
   * 后者会让浏览器根本不存，ETag 就失去意义了。
   */
  const m = await env.DB.prepare("SELECT v FROM syncmeta WHERE k = 'lastPush'").first()
  const tag = `W/"${m?.v || '0'}"`
  const headers = { etag: tag, 'cache-control': 'private, no-cache' }

  if (req.headers.get('if-none-match') === tag) {
    return new Response(null, { status: 304, headers })
  }

  const [books, chapters, problems, images] = await Promise.all([
    // 按 order 排，和桌面版一致 —— 以前这里按 seq（历史题目数）排，
    // 于是网页版的书籍顺序跟你在桌面版拖出来的顺序对不上
    env.DB.prepare('SELECT * FROM books WHERE deletedAt = 0 ORDER BY COALESCE("order", 0), seq').all(),
    env.DB.prepare('SELECT * FROM chapters WHERE deletedAt = 0').all(),
    env.DB.prepare('SELECT * FROM problems WHERE deletedAt = 0').all(),
    env.DB.prepare('SELECT * FROM images').all()
  ])

  return json({
    at: Date.now(),
    books: books.results,
    chapters: chapters.results.map(c => ({ ...c, collapsed: !!c.collapsed })),
    problems: problems.results.map(reviveProblem),
    images: images.results
  }, 200, headers)
}

async function stat (env) {
  const p = await env.DB.prepare('SELECT COUNT(*) n FROM problems WHERE deletedAt = 0').first()
  const i = await env.DB.prepare('SELECT COUNT(*) n, SUM(size) s FROM images').first()
  const m = await env.DB.prepare("SELECT v FROM syncmeta WHERE k = 'lastPush'").first()
  return json({ problems: p?.n || 0, images: i?.n || 0, bytes: i?.s || 0, lastPush: +(m?.v || 0) })
}

async function getImage (env, id) {
  // KV 键就是图片 id，contentType 存在 metadata 里
  const { value, metadata } = await env.IMAGES.getWithMetadata(id, { type: 'arrayBuffer' })
  if (value === null) return new Response('not found', { status: 404 })

  const h = new Headers()
  h.set('content-type', metadata?.contentType || 'image/webp')
  /**
   * 图片按 id 命名且永不修改，可以放心长缓存。
   *
   * 但配了密码时必须是 private：URL 里已经不带 ?key= 了，
   * 对所有人都长一个样 —— 再让共享缓存（CDN / 代理）存一份，
   * 等于给未登录的人开了后门。没配密码时数据本来就是公开的，放开走 CDN。
   */
  h.set('cache-control', `${env.VIEW_KEY ? 'private' : 'public'}, max-age=31536000, immutable`)
  return new Response(value, { headers: h })
}

/* ---------- 写 ---------- */

const COLS = {
  // order 是书籍的排列顺序（桌面版拖出来的），以前漏了没上传，
  // 导致网页版只能退而按 seq 排，顺序跟桌面版对不上
  books: ['id', 'name', 'order', 'seq', 'createdAt', 'updatedAt', 'deletedAt'],
  chapters: ['id', 'bookId', 'parentId', 'title', 'order', 'collapsed', 'createdAt', 'updatedAt', 'deletedAt'],
  problems: [
    'id', 'bookId', 'chapterId', 'no', 'title', 'kind', 'difficulty', 'difficultyManual',
    'mastery', 'starred', 'source', 'note', 'reasons', 'topics', 'latex', 'ai', 'images',
    'reviewCount', 'lastReviewAt', 'createdAt', 'updatedAt', 'deletedAt'
  ]
}

function upsertStmt (env, table) {
  const cols = COLS[table]
  const quoted = cols.map(c => (c === 'order' ? '"order"' : c)).join(',')
  const marks = cols.map(() => '?').join(',')
  return env.DB.prepare(`INSERT OR REPLACE INTO ${table} (${quoted}) VALUES (${marks})`)
}

function bindRow (stmt, table, rec) {
  return stmt.bind(...COLS[table].map(c => {
    const v = rec[c]
    if (JSON_FIELDS.includes(c)) return JSON.stringify(v ?? null)
    if (typeof v === 'boolean') return v ? 1 : 0
    return v ?? (typeof v === 'number' ? 0 : null)
  }))
}

async function push (req, env) {
  const body = await req.json()
  const batch = []

  for (const table of ['books', 'chapters', 'problems']) {
    const rows = body[table] || []
    if (!rows.length) continue
    const stmt = upsertStmt(env, table)
    for (const r of rows) {
      // 题目(q)截图不上云，云端只留答案/补充的图 ——
      // 把题目 images 里的 q 槽记录剥掉，网页端就不会去拉这些图
      if (table === 'problems' && Array.isArray(r.images)) {
        r.images = r.images.filter(im => im.slot !== 'q')
      }
      batch.push(bindRow(stmt, table, r))
    }
  }

  const imgs = body.images || []
  if (imgs.length) {
    const stmt = env.DB.prepare(
      'INSERT OR REPLACE INTO images (id,w,h,polarity,ext,size,createdAt) VALUES (?,?,?,?,?,?,?)')
    for (const im of imgs) {
      batch.push(stmt.bind(im.id, im.w || 0, im.h || 0, im.polarity || 'light',
        im.ext || 'webp', im.size || 0, im.createdAt || Date.now()))
    }
  }

  batch.push(env.DB.prepare("INSERT OR REPLACE INTO syncmeta (k,v) VALUES ('lastPush', ?)")
    .bind(String(Date.now())))

  if (batch.length) await env.DB.batch(batch)

  return json({
    ok: true,
    books: (body.books || []).length,
    chapters: (body.chapters || []).length,
    problems: (body.problems || []).length,
    images: imgs.length
  })
}

/** 桌面版据此算出还需要上传哪些图，避免重复传几百 MB */
async function haveImages (req, env) {
  const { ids } = await req.json()
  if (!Array.isArray(ids) || !ids.length) return json({ have: [] })

  const have = []
  // D1 的变量个数有限制，分批查
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const marks = chunk.map(() => '?').join(',')
    const r = await env.DB.prepare(`SELECT id FROM images WHERE id IN (${marks})`).bind(...chunk).all()
    have.push(...r.results.map(x => x.id))
  }
  return json({ have })
}

async function putImage (req, env, id) {
  const body = await req.arrayBuffer()
  const type = req.headers.get('content-type') || 'image/webp'
  // KV put 单键上限 25MB，截图远小于这个值
  await env.IMAGES.put(id, body, { metadata: { contentType: type } })
  return json({ ok: true, size: body.byteLength })
}

/** 云端有、但本地已经删掉的图，推送后清理掉 */
async function pruneImages (env) {
  const rows = await env.DB.prepare('SELECT images FROM problems WHERE deletedAt = 0').all()
  const alive = new Set()
  for (const r of rows.results) {
    try {
      // 题目(q)截图不上云 —— 即使旧数据里还引用着 q 槽图，也不当"活图"保留
      for (const im of JSON.parse(r.images || '[]')) {
        if (im.slot !== 'q') alive.add(im.id)
      }
    } catch (_) {}
  }

  const all = await env.DB.prepare('SELECT id FROM images').all()
  const dead = all.results.map(x => x.id).filter(id => !alive.has(id))
  if (!dead.length) return 0

  // KV 没有批量删，逐个删（死图量小，无所谓）
  // 注意：prune 会顺带清掉历史上传过的题目(q)截图 ——
  // 网页端只显示题目文字，这些图云端不再需要
  for (const id of dead) await env.IMAGES.delete(id)
  for (let i = 0; i < dead.length; i += 100) {
    const chunk = dead.slice(i, i + 100)
    const marks = chunk.map(() => '?').join(',')
    await env.DB.prepare(`DELETE FROM images WHERE id IN (${marks})`).bind(...chunk).run()
  }
  return dead.length
}

export default {
  async fetch (req, env) {
    const url = new URL(req.url)
    const path = url.pathname

    if (!path.startsWith('/api/')) return new Response('not found', { status: 404 })

    try {
      if (req.method === 'GET') {
        // 网页只读版的数据接口 —— 登录墙校验（VIEW_KEY）
        const v = needViewAuth(req, env)
        if (v) return v
        // 只在 snapshot 上种 cookie：它是进站的第一个请求，
        // 之后的图片请求就能靠 cookie 过校验，不用再把密码拼进 URL。
        // 不种在图片响应上 —— 那是长缓存资源，带 Set-Cookie 容易被缓存层留住
        if (path === '/api/snapshot') return withKeyCookie(await snapshot(env, req), env)
        if (path === '/api/stat') return stat(env)
        if (path.startsWith('/api/img/')) return getImage(env, path.slice(9))
      }

      // 以下都是写操作，只有桌面版带着令牌才能调
      if (!authed(req, env)) return json({ error: 'unauthorized' }, 401)

      if (req.method === 'POST' && path === '/api/push') return push(req, env)
      if (req.method === 'POST' && path === '/api/haveimg') return haveImages(req, env)
      if (req.method === 'POST' && path === '/api/prune') {
        return json({ ok: true, removed: await pruneImages(env) })
      }
      if (req.method === 'PUT' && path.startsWith('/api/img/')) {
        return putImage(req, env, path.slice(9))
      }

      return json({ error: 'not found' }, 404)
    } catch (e) {
      return json({ error: String(e?.message || e) }, 500)
    }
  }
}
