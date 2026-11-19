#!/usr/bin/env node
/**
 * Reproducible check of the search route's authentication fence.
 *
 * Mounts the real handlers from `index.js` on a throwaway loopback HTTP server
 * and drives five requests through actual Node HTTP, each with a different
 * `connection` service: an admitting session, a rejecting session, no service
 * at all, a throwing service, and a cross-site request. Nothing here talks to
 * the running DSH host, so it is safe to run at any time.
 *
 *   node scripts/verify-auth-fence.mjs
 *
 * Exit code 0 means every observed status matched the expectation printed
 * next to it.
 */

import http from 'node:http'
import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'
import { apply } from '../index.js'

const SEARCH_PATH = '/dsh-simple-search/search'

/**
 * Mount the plugin's routes with one fake host context.
 * @param {Record<string, unknown>} services - the services `ctx.get` sees.
 * @returns {Map<string, Function>} path → handler.
 */
function mount(services) {
  const routes = new Map()
  apply({
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    effect(callback) {
      return callback()
    },
    get(name) {
      return services[name]
    },
  })
  return routes
}

/**
 * Serve the mounted handlers on an ephemeral loopback port.
 * @param {Map<string, Function>} routes - captured handlers.
 * @returns {Promise<import('node:http').Server>} listening server.
 */
function listen(routes) {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1')
    const handler = routes.get(pathname)
    if (handler === undefined) {
      res.statusCode = 404
      res.end()
      return
    }
    Promise.resolve(handler(req, res)).catch((error) => {
      res.statusCode = 500
      res.end(String(error))
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

/**
 * One GET request.
 * @param {number} port - loopback port.
 * @param {string} path - request path with query.
 * @param {Record<string, string>} headers - request headers.
 * @returns {Promise<{status: number, body: string}>} raw response.
 */
function get(port, path, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, path, method: 'GET', headers,
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode, body }))
    })
    request.once('error', reject)
    request.end()
  })
}

/**
 * Run one scenario against a fresh server.
 * @param {string} root - workspace fixture.
 * @param {{label: string, connection?: unknown, headers?: Record<string, string>, expected: number}} options - scenario.
 * @returns {Promise<{label: string, expected: number, actual: number, code: string}>} result row.
 */
async function scenario(root, options) {
  const services = {
    workspaceRegistry: { list: () => [{ path: root, updatedAt: new Date().toISOString() }] },
  }
  if (Object.hasOwn(options, 'connection')) services.connection = options.connection
  const server = await listen(mount(services))
  try {
    const { port } = server.address()
    const { status, body } = await get(port, `${SEARCH_PATH}?q=needle`, options.headers ?? {})
    let code = 'ok'
    try {
      code = JSON.parse(body)?.error?.code ?? code
    } catch {
      code = 'unparsable'
    }
    return { label: options.label, expected: options.expected, actual: status, code }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'ss-auth-fence-'))
await fsp.writeFile(nodePath.join(root, 'notes.txt'), 'needle in the workspace\n')

/** @type {Array<{label: string, connection?: unknown, headers?: Record<string, string>, expected: number}>} */
const scenarios = [
  {
    label: 'host auth admits the page session',
    connection: { requestRejection: () => undefined },
    expected: 200,
  },
  {
    label: 'host auth rejects an unauthenticated caller',
    connection: { requestRejection: () => 401 },
    expected: 401,
  },
  {
    label: 'no Connection service (auth unavailable)',
    connection: undefined,
    expected: 503,
  },
  {
    label: 'Connection service is null',
    connection: null,
    expected: 503,
  },
  {
    label: 'Connection check throws',
    connection: { requestRejection: () => { throw new Error('auth subsystem down') } },
    expected: 403,
  },
  {
    label: 'cross-site request',
    connection: { requestRejection: () => undefined },
    headers: { 'sec-fetch-site': 'cross-site' },
    expected: 403,
  },
]

console.log('dsh-simple-search auth fence\n')
const rows = []
for (const item of scenarios) rows.push(await scenario(root, item))
await fsp.rm(root, { recursive: true, force: true })

const width = Math.max(...rows.map((row) => row.label.length))
console.log(`${'scenario'.padEnd(width)}  expected  actual  error code`)
for (const row of rows) {
  const verdict = row.actual === row.expected ? 'ok' : 'MISMATCH'
  console.log(`${row.label.padEnd(width)}  ${String(row.expected).padEnd(8)}  ${String(row.actual).padEnd(6)}  ${row.code}  ${verdict}`)
}

const failed = rows.filter((row) => row.actual !== row.expected)
console.log(`\n${rows.length - failed.length}/${rows.length} scenarios matched`)
process.exitCode = failed.length === 0 ? 0 : 1
