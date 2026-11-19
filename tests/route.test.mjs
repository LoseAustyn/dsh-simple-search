/**
 * Route-level tests for the host half: the trust fence, root resolution and
 * the search envelope, driven through `apply()` with a fake web server so no
 * HTTP listener or browser session is involved.
 */

import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'
import { after, before, describe, it } from 'node:test'
import { apply } from '../index.js'

/**
 * Build a context sufficient for `apply`.
 * @param {Record<string, unknown>} services - service overrides.
 * @returns {{ctx: object, routes: Map<string, Function>}} fake context and captured handlers.
 */
function fakeContext(services) {
  const routes = new Map()
  const ctx = {
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
    effect(callback) {
      return callback()
    },
    get(name) {
      if (Object.hasOwn(services, name)) return services[name]
      // Routes are mounted only with Connection present; an authenticated
      // default keeps the fence out of the way of the search assertions.
      if (name === 'connection') return { requestRejection: () => undefined }
      return undefined
    },
  }
  return { ctx, routes }
}

/**
 * One fake HTTP exchange.
 * @param {Function} handler - route handler.
 * @param {string} url - request URL with query.
 * @param {Record<string, string>} headers - request headers.
 * @returns {Promise<{status: number, body: any}>} parsed response.
 */
async function call(handler, url, headers = { host: '127.0.0.1:3080' }) {
  const request = { url, method: 'GET', headers }
  const response = {
    statusCode: 0,
    headers: {},
    body: '',
    writableEnded: false,
    setHeader(name, value) { this.headers[name] = value },
    end(text) {
      this.body = text
      this.writableEnded = true
    },
  }
  await handler(request, response)
  return { status: response.statusCode, body: JSON.parse(response.body) }
}

describe('simple-search routes', () => {
  let root
  let routes
  before(async () => {
    root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'ss-route-'))
    await fsp.mkdir(nodePath.join(root, 'src'), { recursive: true })
    await fsp.writeFile(nodePath.join(root, 'src', 'a.ts'), 'alpha\nconst needle = 1\n')
    await fsp.writeFile(nodePath.join(root, 'needle.txt'), 'needle content\n')
    const { ctx, routes: captured } = fakeContext({
      workspaceRegistry: { list: () => [{ path: root, updatedAt: new Date().toISOString() }] },
    })
    apply(ctx)
    routes = captured
  })
  after(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('answers the version route', async () => {
    const { status, body } = await call(routes.get('/dsh-simple-search/version'), '/dsh-simple-search/version')
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.value.plugin, 'dsh-simple-search')
    assert.ok(body.value.capabilities.includes('search'))
  })

  it('reports the package version', async () => {
    const manifest = JSON.parse(await fsp.readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const { status, body } = await call(routes.get('/dsh-simple-search/version'), '/dsh-simple-search/version')
    assert.equal(status, 200)
    assert.equal(body.value.version, manifest.version)
  })

  it('searches the most recently updated workspace and reports the root', async () => {
    const { status, body } = await call(
      routes.get('/dsh-simple-search/search'),
      '/dsh-simple-search/search?q=needle&limit=5',
    )
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.value.root, await fsp.realpath(root))
    assert.equal(body.value.textFileCount, 2)
    assert.equal(body.value.fileCount, 0)
    assert.ok(body.value.matches.some((hit) => hit.path === 'src/a.ts'
      && hit.line === 2 && hit.column === 7 && hit.text === 'const needle = 1'))
  })

  it('answers file-name mode without content matches', async () => {
    const { status, body } = await call(
      routes.get('/dsh-simple-search/search'),
      '/dsh-simple-search/search?q=needle&mode=files',
    )
    assert.equal(status, 200)
    assert.equal(body.value.mode, 'files')
    assert.deepEqual(body.value.files.map((file) => file.path), ['needle.txt'])
    assert.equal(body.value.matches.length, 0)
    assert.equal(body.value.matchCount, 0)
  })

  it('answers all mode with file names and content matches', async () => {
    const { status, body } = await call(
      routes.get('/dsh-simple-search/search'),
      '/dsh-simple-search/search?q=needle&mode=all',
    )
    assert.equal(status, 200)
    assert.equal(body.value.mode, 'all')
    assert.ok(body.value.files.some((file) => file.path === 'needle.txt'))
    assert.ok(body.value.matches.length >= 2)
    assert.ok(body.value.textFileCount >= 2)
  })

  it('rejects a cross-site request and a foreign Origin', async () => {
    const handler = routes.get('/dsh-simple-search/search')
    const crossSite = await call(handler, '/dsh-simple-search/search?q=needle', {
      host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site',
    })
    assert.equal(crossSite.status, 403)
    assert.equal(crossSite.body.error.code, 'forbidden')
    const foreign = await call(handler, '/dsh-simple-search/search?q=needle', {
      host: '127.0.0.1:3080', origin: 'https://evil.example',
    })
    assert.equal(foreign.status, 403)
  })

  it('refuses a root outside every registered workspace', async () => {
    const outside = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'ss-outside-'))
    try {
      const { status, body } = await call(
        routes.get('/dsh-simple-search/search'),
        `/dsh-simple-search/search?q=needle&root=${encodeURIComponent(outside)}`,
      )
      assert.equal(status, 403)
      assert.equal(body.error.code, 'denied')
    } finally {
      await fsp.rm(outside, { recursive: true, force: true })
    }
  })

  it('refuses search when host authentication is unavailable', async () => {
    const { ctx, routes: captured } = fakeContext({
      workspaceRegistry: { list: () => [{ path: root, updatedAt: new Date().toISOString() }] },
      connection: undefined,
    })
    apply(ctx)
    const handler = captured.get('/dsh-simple-search/search')
    const { status, body } = await call(handler, '/dsh-simple-search/search?q=needle')
    assert.equal(status, 503)
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'auth-unavailable')
    assert.equal(body.value, undefined)
  })

  it('refuses the version route too when host authentication is unavailable', async () => {
    const { ctx, routes: captured } = fakeContext({
      workspaceRegistry: { list: () => [{ path: root }] },
      connection: null,
    })
    apply(ctx)
    const { status } = await call(captured.get('/dsh-simple-search/version'), '/dsh-simple-search/version')
    assert.equal(status, 503)
  })

  it('passes through the host authentication rejection', async () => {
    const { ctx, routes: captured } = fakeContext({
      workspaceRegistry: { list: () => [{ path: root }] },
      connection: { requestRejection: () => 401 },
    })
    apply(ctx)
    const { status, body } = await call(captured.get('/dsh-simple-search/search'), '/dsh-simple-search/search?q=needle')
    assert.equal(status, 401)
    assert.equal(body.error.code, 'forbidden')
  })

  it('treats a throwing authentication check as a refusal', async () => {
    const { ctx, routes: captured } = fakeContext({
      workspaceRegistry: { list: () => [{ path: root }] },
      connection: { requestRejection: () => { throw new Error('auth down') } },
    })
    apply(ctx)
    const { status } = await call(captured.get('/dsh-simple-search/search'), '/dsh-simple-search/search?q=needle')
    assert.equal(status, 403)
  })

  it('reports an empty query as an invalid pattern', async () => {
    const { status, body } = await call(routes.get('/dsh-simple-search/search'), '/dsh-simple-search/search?q=%20')
    assert.equal(status, 400)
    assert.equal(body.error.code, 'invalid-pattern')
  })

  it('reports an unreadable root as a bad root', async () => {
    const missing = nodePath.join(root, 'does-not-exist')
    const { status, body } = await call(
      routes.get('/dsh-simple-search/search'),
      `/dsh-simple-search/search?q=x&root=${encodeURIComponent(missing)}`,
    )
    assert.equal(status, 422)
    assert.equal(body.error.code, 'bad-root')
  })
})
