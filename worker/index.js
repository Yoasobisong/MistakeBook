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

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })

const JSON_FIELDS = ['reasons', 'topics', 'latex', 'ai', 'images']

/** D1 里嵌套字段存的是 JSON 文本，取出来要还原 */
function reviveProblem (row) {
  const p = { ...row }
  for (const f of JSON_FIELDS) {
    try { p[f] = JSON.parse(row[f] || 'null') } catch (_) { p[f] = null }
  }
  p.starred = !!row.starred
  p.difficultyManual = !!row.difficultyManual
  return p
}

/** 写接口的令牌校验。读接口不查这个，由 Cloudflare Access 拦在前面 */
function authed (req, env) {
  const t = req.headers.get('x-push-token')
  return !!env.PUSH_TOKEN && t === env.PUSH_TOKEN
}

/* ---------- 读 ---------- */

async function snapshot (env) {
  const [books, chapters, problems, images] = await Promise.all([
    env.DB.prepare('SELECT * FROM books WHERE deletedAt = 0 ORDER BY seq').all(),
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
  })
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
  // 图片按 id 命名且永不修改，可以放心长缓存
  h.set('cache-control', 'public, max-age=31536000, immutable')
  return new Response(value, { headers: h })
}

/* ---------- 写 ---------- */

const COLS = {
  books: ['id', 'name', 'seq', 'createdAt', 'updatedAt', 'deletedAt'],
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
    for (const r of rows) batch.push(bindRow(stmt, table, r))
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
      for (const im of JSON.parse(r.images || '[]')) alive.add(im.id)
    } catch (_) {}
  }

  const all = await env.DB.prepare('SELECT id FROM images').all()
  const dead = all.results.map(x => x.id).filter(id => !alive.has(id))
  if (!dead.length) return 0

  // KV 没有批量删，逐个删（死图量小，无所谓）
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
        if (path === '/api/snapshot') return snapshot(env)
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
