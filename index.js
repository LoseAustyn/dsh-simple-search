/**
 * Host half of the simple-search bundle: three loopback routes the browser half
 * calls.
 *
 *  GET /dsh-simple-search/version       — self-check: which code is loaded.
 *  GET /dsh-simple-search/search        — full-text search over one workspace.
 *  GET /dsh-simple-search/conversation  — human-visible text of one Session.
 *
 * The conversation route reads a Session through the host's `sessionQuery`
 * service and searches only direct human prompts and assistant text; reasoning
 * blocks and tool traffic stay out. Session *title* search is client-side over
 * the in-page Session list, which already spans every workspace, so it needs
 * no host route.
 *
 * The search root is resolved from, in order: the calling Session's committed
 * working directory, an explicit `root` param that must sit inside a
 * registered Workspace or the Session's directory, and finally the most
 * recently updated registered Workspace. A request that names no usable
 * directory is refused instead of silently searching the host's own cwd.
 *
 * Every handler sits behind a browser-trust fence: loopback/`trustedHosts`
 * Host, no cross-site Origin, and an authenticated browser session proven by
 * `connection.requestRejection`. The fence fails closed: a deployment without
 * the Connection service (or without its `requestRejection` capability) cannot
 * prove who is calling, so the routes answer 503 and never serve workspace
 * text. The route is read-only.
 */

import fsp from 'node:fs/promises'
import { createRequire } from 'node:module'
import nodePath from 'node:path'
import { conversationDocuments, matchConversation } from './conversation.js'
import { SearchError, isWithin, searchWorkspace } from './search.js'

/** Plugin identity for diagnostics. */
export const name = 'dsh-simple-search'
const require = createRequire(import.meta.url)
/** Version reported by the self-check; `package.json` is the only source. */
const VERSION = require('./package.json').version
const ROUTE_VERSION = '/dsh-simple-search/version'
const ROUTE_SEARCH = '/dsh-simple-search/search'
const ROUTE_CONVERSATION = '/dsh-simple-search/conversation'
/** Refusal when the deployment cannot authenticate the caller at all. */
const AUTH_UNAVAILABLE = 503
/** Wall-clock budget for observing one Session log. */
const CONVERSATION_TIMEOUT_MS = 8_000
/** Maximum searchable queries kept for the conversation extraction cache. */
const CONVERSATION_CACHE_SIZE = 3
/**
 * Extraction cache keyed by Session id and the log cursor it was built from.
 * Re-observing an unchanged live Session is cheap, but re-extracting every
 * message on each keystroke is not; the cursor invalidates it on append.
 * @type {Map<string, {cursor: number, length: number, extracted: object}>}
 */
const conversationCache = new Map()

/** Session ids are opaque but bounded: `session-<uuid>` or a bare uuid. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

/**
 * Services required before mounting. `connection` is mandatory, not optional:
 * it is the host's only source of caller identity, so mounting without it would
 * expose workspace file contents to unauthenticated callers.
 */
export const inject = ['webServer', 'connection']

const ok = (res, value) => sendJson(res, 200, { ok: true, value })
const fail = (res, status, code, message) => sendJson(res, status, { ok: false, error: { code, message } })

function sendJson(res, status, body) {
  if (res.writableEnded === true) return
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/**
 * Browser-trust fence shared by every route (same rules as the shipped local
 * routes): loopback or an explicitly trusted authority, same-origin browser
 * metadata, and the Connection service's authentication of the caller. The
 * fence is fail-closed: when the Connection service is absent or cannot reject
 * requests, the route answers 503 instead of serving workspace text.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @returns {number|null} rejection status, or null when the request may pass.
 */
function fence(req, ctx) {
  const loopback = (hostname) => {
    const host = String(hostname ?? '').toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '')
    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true
    const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host)
    return parts !== null && Number(parts[1]) === 127 && [parts[2], parts[3], parts[4]].every((value) => Number(value) <= 255)
  }
  try {
    const headers = req.headers ?? {}
    let hostUrl
    try {
      hostUrl = new URL(`http://${String(headers.host ?? '')}`)
    } catch {
      return 403
    }
    if (String(headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return 403
    const origin = headers.origin
    if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
      let originUrl
      try {
        originUrl = new URL(origin)
      } catch {
        return 403
      }
      if (originUrl.host.toLowerCase() !== hostUrl.host.toLowerCase()) return 403
    }
    const connection = ctx.get('connection')
    if (connection === undefined || connection === null
      || typeof connection.requestRejection !== 'function') {
      // Fail closed: without the host's authentication service there is no way
      // to distinguish the owner's browser from an unauthenticated caller, and
      // this route hands out file contents.
      return AUTH_UNAVAILABLE
    }
    try {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined && rejection !== null && rejection !== false) {
        return typeof rejection === 'number' ? rejection : 403
      }
    } catch {
      return 403
    }
    if (String(req.method ?? 'GET').toUpperCase() !== 'GET' && !loopback(hostUrl.hostname)) return 403
    return null
  } catch {
    return 403
  }
}

/**
 * Resolve a real directory.
 * @param {string} candidate - absolute path.
 * @returns {Promise<string|null>} the realpath, or null when it is not a directory.
 */
async function realDirectory(candidate) {
  try {
    const stat = await fsp.stat(candidate)
    if (!stat.isDirectory()) return null
    return await fsp.realpath(candidate)
  } catch {
    return null
  }
}

/**
 * Session working directory from the host's committed working directory,
 * falling back to the stored session header.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {string} sessionId - validated session id.
 * @returns {Promise<string|null>} the directory, or null when unknown.
 */
async function sessionDirectory(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  const session = sessions?.get?.(sessionId)
  if (session === undefined) return null
  const working = ctx.get('workingDirectory')
  const committed = working?.get?.(session)
  const candidate = typeof committed === 'string' && committed !== '' ? committed : session?.header?.cwd
  if (typeof candidate !== 'string' || candidate === '') return null
  return await realDirectory(candidate)
}

/**
 * Registered workspace directories, most recently updated first.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @returns {Promise<string[]>} realpaths.
 */
async function workspaceDirectories(ctx) {
  const registry = ctx.get('workspaceRegistry')
  const rows = registry?.list?.() ?? []
  const ranked = [...rows].sort((left, right) => {
    const leftTime = Date.parse(left?.updatedAt ?? left?.createdAt ?? '') || 0
    const rightTime = Date.parse(right?.updatedAt ?? right?.createdAt ?? '') || 0
    return rightTime - leftTime
  })
  const directories = []
  for (const row of ranked) {
    if (typeof row?.path !== 'string' || row.path === '') continue
    const real = await realDirectory(row.path)
    if (real !== null) directories.push(real)
  }
  return directories
}

/**
 * Resolve which directory one request searches.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {URLSearchParams} params - request query.
 * @returns {Promise<{root: string, sessionId: string|null}>} the directory and the session it came from.
 */
async function resolveRoot(ctx, params) {
  const requestedSession = params.get('sessionId') ?? ''
  /** @type {string|null} */
  let sessionRoot = null
  let sessionId = null
  if (SESSION_ID.test(requestedSession)) {
    sessionRoot = await sessionDirectory(ctx, requestedSession)
    if (sessionRoot !== null) sessionId = requestedSession
  }

  const requestedRoot = params.get('root') ?? ''
  if (requestedRoot !== '') {
    const real = await realDirectory(nodePath.resolve(requestedRoot))
    if (real === null) throw new SearchError('bad-root', `目录不存在：${requestedRoot}`)
    const allowed = []
    if (sessionRoot !== null) allowed.push(sessionRoot)
    allowed.push(...await workspaceDirectories(ctx))
    if (!allowed.some((directory) => isWithin(real, directory))) {
      throw new SearchError('denied', '只能搜索已注册工作区内的目录')
    }
    return { root: real, sessionId }
  }

  if (sessionRoot !== null) return { root: sessionRoot, sessionId }

  const workspaces = await workspaceDirectories(ctx)
  if (workspaces.length > 0) return { root: workspaces[0], sessionId }

  throw new SearchError('bad-root', '没有可搜索的工作区：请先打开一个工作区')
}

/**
 * Answer one search request.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 */
async function handleSearch(ctx, req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const query = url.searchParams.get('q') ?? ''
  if (query.trim() === '') {
    fail(res, 400, 'invalid-pattern', '搜索关键词不能为空')
    return
  }
  const limit = Number(url.searchParams.get('limit') ?? '') || undefined
  const requestedMode = url.searchParams.get('mode') ?? ''
  const mode = requestedMode === 'files' || requestedMode === 'all' ? requestedMode : 'text'
  const { root, sessionId } = await resolveRoot(ctx, url.searchParams)
  if (typeof root !== 'string' || root === '') {
    throw new SearchError('bad-root', '无法确定搜索目录')
  }
  const result = await searchWorkspace({
    root,
    query,
    mode,
    regex: url.searchParams.get('regex') === '1',
    caseSensitive: url.searchParams.get('case') === '1',
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 400) : undefined,
  })
  const textFiles = new Set(result.matches.map((hit) => hit.path))
  ok(res, {
    root,
    sessionId,
    mode: result.mode,
    engine: result.engine,
    files: result.files,
    matches: result.matches,
    matchCount: result.matches.length,
    fileCount: result.files.length,
    textFileCount: textFiles.size,
    scanned: result.scanned,
    truncated: result.truncated === true,
    elapsedMs: result.elapsedMs,
  })
}

/**
 * Remember one extracted conversation, evicting the oldest entry.
 * @param {string} sessionId - validated Session id.
 * @param {number} cursor - log cursor the extraction was built from.
 * @param {number} length - event count paired with the cursor.
 * @param {object} extracted - `conversationDocuments` output.
 */
function rememberConversation(sessionId, cursor, length, extracted) {
  conversationCache.delete(sessionId)
  conversationCache.set(sessionId, { cursor, length, extracted })
  while (conversationCache.size > CONVERSATION_CACHE_SIZE) {
    conversationCache.delete(conversationCache.keys().next().value)
  }
}

/**
 * Map an observation failure onto a stable route error.
 * @param {unknown} error - thrown by `sessionQuery.observeSession`.
 * @returns {SearchError} route error.
 */
function conversationFailure(error) {
  const code = error?.code
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || code === 'SESSION_QUERY_ABORTED') {
    return new SearchError('timeout', '读取会话超时，请稍后再试')
  }
  if (code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
    return new SearchError('not-found', '会话不存在或尚未落盘')
  }
  return new SearchError('internal', String(error?.message ?? error))
}

/**
 * Answer one current-Session content search.
 *
 * The response contains only human prompts and assistant text blocks; the
 * extraction is cached per log cursor so typing does not re-walk the whole log.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 */
async function handleConversation(ctx, req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const query = (url.searchParams.get('q') ?? '').trim()
  if (query === '') throw new SearchError('invalid-pattern', '搜索关键词不能为空')
  if (query.length > 300) throw new SearchError('invalid-pattern', '搜索关键词不能超过 300 个字符')
  const sessionId = url.searchParams.get('sessionId') ?? ''
  if (!SESSION_ID.test(sessionId)) throw new SearchError('bad-session', '缺少或非法的会话 ID')

  const sessionQuery = ctx.get('sessionQuery')
  if (sessionQuery === undefined || sessionQuery === null
    || typeof sessionQuery.observeSession !== 'function') {
    throw new SearchError('unavailable', '宿主未提供会话查询服务，暂时无法搜索会话内容')
  }

  const startedAt = Date.now()
  let observation
  try {
    observation = await sessionQuery.observeSession(sessionId, {
      projectionMode: 'none',
      signal: AbortSignal.timeout(CONVERSATION_TIMEOUT_MS),
    })
  } catch (error) {
    throw conversationFailure(error)
  }
  if (observation === undefined || observation === null) {
    throw new SearchError('not-found', '会话不存在')
  }

  try {
    const events = Array.isArray(observation.events) ? observation.events : []
    const cursor = Number(observation.cursor ?? -1)
    const cached = conversationCache.get(sessionId)
    const fresh = cached !== undefined && cached.cursor === cursor && cached.length === events.length
    const extracted = fresh ? cached.extracted : conversationDocuments(events)
    if (!fresh) rememberConversation(sessionId, cursor, events.length, extracted)
    const result = matchConversation(extracted, {
      query,
      regex: url.searchParams.get('regex') === '1',
      caseSensitive: url.searchParams.get('case') === '1',
      limit: Number(url.searchParams.get('limit') ?? '') || undefined,
    })
    ok(res, {
      sessionId,
      title: result.title,
      cwd: typeof observation.header?.cwd === 'string' ? observation.header.cwd : '',
      messageCount: result.messageCount,
      matchCount: result.matches.length,
      matches: result.matches,
      scanned: result.scanned,
      truncated: result.truncated === true,
      elapsedMs: Date.now() - startedAt,
    })
  } finally {
    if (typeof observation[Symbol.dispose] === 'function') observation[Symbol.dispose]()
  }
}

/**
 * Mount the routes.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 */
export function apply(ctx) {
  const guard = (handler) => async (req, res) => {
    const rejection = fence(req, ctx)
    if (rejection !== null) {
      if (rejection === AUTH_UNAVAILABLE) {
        fail(res, AUTH_UNAVAILABLE, 'auth-unavailable', '宿主认证不可用，已拒绝访问')
        return
      }
      fail(res, rejection, 'forbidden', '请求被信任栅栏拒绝')
      return
    }
    try {
      await handler(req, res)
    } catch (error) {
      if (error instanceof SearchError) {
        const status = error.code === 'invalid-pattern' ? 400
          : error.code === 'denied' ? 403
            : error.code === 'not-found' ? 404
              : error.code === 'bad-root' || error.code === 'bad-session' ? 422
                : error.code === 'unavailable' || error.code === 'auth-unavailable' ? 503
                  : error.code === 'timeout' ? 504
                    : 500
        fail(res, status, error.code, error.message)
        return
      }
      fail(res, 500, 'internal', String(error?.message ?? error))
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_VERSION,
    handler: guard((req, res) => {
      ok(res, {
        plugin: name,
        version: VERSION,
        capabilities: ['search', 'rg', 'walk', 'conversation'],
        pid: process.pid,
      })
    }),
  }), 'dsh-simple-search: version route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_SEARCH,
    handler: guard((req, res) => handleSearch(ctx, req, res)),
  }), 'dsh-simple-search: search route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_CONVERSATION,
    handler: guard((req, res) => handleConversation(ctx, req, res)),
  }), 'dsh-simple-search: conversation route')
}
