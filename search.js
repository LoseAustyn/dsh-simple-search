/**
 * Full-text search core for the simple-search plugin.
 *
 * Two engines behind one contract:
 *  - `rg`: the packaged ripgrep binary the Harness itself ships
 *    (`@vscode/ripgrep`), spawned with a fixed argv. Fast, respects
 *    `.gitignore`, no shell layer.
 *  - `walk`: a bounded Node.js directory walk used when no ripgrep binary is
 *    resolvable. Slower, but keeps the feature working on a bare deployment.
 *
 * Both return the same shape: root-relative '/'-separated paths, 1-based
 * line/column, a single result per matching line (the first hit on that
 * line), and line text cut to {@link MAX_LINE_CHARS} characters.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import fsp from 'node:fs/promises'
import { createRequire } from 'node:module'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'

/** Hard cap on returned results for one query. */
export const MAX_MATCHES = 400
/** Hard cap on results from one file, so one huge log cannot fill the list. */
export const MAX_MATCHES_PER_FILE = 40
/** Returned line text is cut to this many characters (UTF-16 units). */
export const MAX_LINE_CHARS = 400
/** Files larger than this are skipped by the fallback walk. */
export const MAX_FILE_BYTES = 1_500_000
/** Directory entries the fallback walk visits before giving up. */
export const MAX_VISITED = 40_000
/** Wall-clock budget for one search. */
export const SEARCH_TIMEOUT_MS = 8_000

/** Directory names never worth searching (VCS internals, dependency and build trees). */
export const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', '.hg', '.svn', '.bzr',
  'dist', 'build', 'out', 'target', 'coverage', '.nyc_output',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache', '.cache',
  '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.tox',
  '.idea', '.vscode', '.gradle', '.yarn', '.pnpm-store',
  '.dsh-memory', '.dsh-plugins',
])

/**
 * Whether a directory name is one the walk never descends.
 * @param {string} dirName - one path segment.
 * @returns {boolean} skip decision.
 */
export function shouldSkipDirectory(dirName) {
  if (SKIP_DIR_NAMES.has(dirName)) return true
  // Python virtualenvs carry every suffix under the sun: .venv_linux, venv-3.12.
  return dirName.startsWith('.venv') || dirName.startsWith('venv-') || dirName === 'site-packages'
}

/** Globs every engine excludes, derived from the walk's own skip set so the two never drift. */
const EXCLUDE_GLOBS = [
  ...[...SKIP_DIR_NAMES].map((name) => `!**/${name}/**`),
  '!**/.venv*/**',
  '!**/venv-*/**',
  '!**/site-packages/**',
  '!**/*.min.js',
  '!**/*.min.css',
  '!**/*.lock',
]

/** Extensions treated as binary by the fallback walk (checked before reading). */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff',
  '.pdf', '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.jar', '.whl', '.apk',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.obj', '.class', '.pyc', '.pyo',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.mp4', '.mov', '.avi', '.wav', '.flac',
  '.sqlite', '.sqlite3', '.db', '.db-wal', '.db-shm', '.lz4', '.zstd', '.parquet',
])

/** One search request after validation. */
export class SearchError extends Error {
  /**
   * @param {'invalid-pattern'|'bad-root'|'denied'|'bad-session'|'not-found'|'unavailable'|'timeout'|'internal'} code - machine-readable cause.
   * @param {string} message - user-facing detail.
   */
  constructor(code, message) {
    super(message)
    this.name = 'SearchError'
    this.code = code
  }
}

/** Outcome of one search. */
/**
 * @typedef {object} SearchHit
 * @property {string} path root-relative, '/'-separated.
 * @property {number} line 1-based line number.
 * @property {number} column 1-based column of the first hit on the line.
 * @property {string} text the matched line (trimmed of a trailing CR, cut to MAX_LINE_CHARS).
 */

/**
 * Cut one line to the display cap without splitting a surrogate pair.
 * @param {string} line - raw line text.
 * @param {number} [max] - character cap.
 * @returns {string} the line, possibly truncated and suffixed with an ellipsis.
 */
export function truncateLine(line, max = MAX_LINE_CHARS) {
  const clean = line.endsWith('\r') ? line.slice(0, -1) : line
  if (clean.length <= max) return clean
  let cut = max - 1
  const code = clean.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1
  return `${clean.slice(0, cut)}…`
}

/**
 * Whether `target` is `root` itself or lives below it.
 * @param {string} target - absolute path.
 * @param {string} root - absolute path.
 * @returns {boolean} containment answer after normalization.
 */
export function isWithin(target, root) {
  const rel = nodePath.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !nodePath.isAbsolute(rel))
}

/**
 * Parse one `rg --line-number --column` output line.
 * @param {string} raw - `path:line:column:text` (path may contain ':').
 * @returns {SearchHit|null} the hit, or null when the line is not a match row.
 */
export function parseRgLine(raw) {
  const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
  const match = /^(.*?):(\d+):(\d+):([\s\S]*)$/.exec(line)
  if (match === null) return null
  const [, file, lineText, columnText, text] = match
  const lineNo = Number(lineText)
  const column = Number(columnText)
  if (!Number.isInteger(lineNo) || lineNo < 1 || !Number.isInteger(column) || column < 1) return null
  const relative = file.replaceAll('\\', '/').replace(/^\.\//u, '')
  return { path: relative, line: lineNo, column, text: truncateLine(text) }
}

/** Cap on file-name results for one query. */
export const MAX_FILE_RESULTS = 120
/** A listed workspace file tree is reused for this long while the user types. */
const FILE_LIST_TTL_MS = 10_000
/** Hard cap on listed paths per workspace. */
const MAX_LISTED_FILES = 80_000

/** Last path segment. */
export function basenameOf(path) {
  const at = path.lastIndexOf('/')
  return at === -1 ? path : path.slice(at + 1)
}

/** Directory part of a '/'-separated path. */
export function dirnameOf(path) {
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

/**
 * Fuzzy subsequence score: every query character appears in order, and the
 * score falls with the gaps between hits and the distance to the first hit.
 * @param {string} text - lower-cased haystack.
 * @param {string} query - lower-cased needle.
 * @returns {number|null} 0..40, or null when the query is not a subsequence.
 */
export function subsequenceScore(text, query) {
  let cursor = 0
  let gaps = 0
  let first = -1
  for (const char of query) {
    const found = text.indexOf(char, cursor)
    if (found === -1) return null
    if (first === -1) first = found
    else gaps += found - cursor
    cursor = found + 1
  }
  return Math.max(0, 40 - gaps) - Math.min(first, 10)
}

/**
 * Score one workspace-relative path against a file-name query (JetBrains-style
 * "Simple Search" ranking): an exact basename wins, then basename
 * substrings, then path substrings, then fuzzy subsequences.
 * @param {string} path - '/'-separated relative path.
 * @param {string} query - raw query text.
 * @returns {number} 0 when it does not match; higher is better.
 */
export function scoreFileMatch(path, query) {
  const needle = query.trim().toLowerCase()
  if (needle === '') return 0
  const haystack = path.toLowerCase()
  const name = basenameOf(haystack)
  const lengthPenalty = Math.min(haystack.length / 40, 10)
  if (name === needle) return 200 - lengthPenalty
  const nameHit = name.indexOf(needle)
  if (nameHit !== -1) {
    return 160 - Math.min(nameHit, 40) + (nameHit === 0 ? 20 : 0) - lengthPenalty
  }
  const pathHit = haystack.indexOf(needle)
  if (pathHit !== -1) return 100 - Math.min(pathHit, 40) - lengthPenalty
  const nameFuzzy = subsequenceScore(name, needle)
  if (nameFuzzy !== null) return 40 + nameFuzzy - lengthPenalty
  const pathFuzzy = subsequenceScore(haystack, needle)
  if (pathFuzzy !== null) return 20 + pathFuzzy - lengthPenalty
  return 0
}

/** Cached file listings per workspace root. */
const fileListCache = new Map()

/** Test seam: forget cached listings. */
export function resetFileListCache() {
  fileListCache.clear()
}

/**
 * List every searchable file below one root, preferring ripgrep's `--files`
 * (same exclusions as the content engine) and falling back to a bounded walk.
 * The listing is cached briefly so typing does not re-walk the tree.
 * @param {string} root - absolute directory.
 * @param {{ ttlMs?: number, preferWalk?: boolean }} [options] - cache lifetime / engine override.
 * @returns {Promise<{paths: string[], engine: 'rg'|'walk'}>} relative paths and the engine used.
 */
export async function listWorkspaceFiles(root, options = {}) {
  const cached = fileListCache.get(root)
  if (cached !== undefined && Date.now() - cached.at < (options.ttlMs ?? FILE_LIST_TTL_MS)) {
    return cached.value
  }
  let value = null
  if (options.preferWalk !== true) {
    const binary = await resolveRipgrep()
    if (binary !== null) {
      const listed = await rgListFiles(binary, root)
      if (listed !== null) value = { paths: listed, engine: 'rg' }
    }
  }
  if (value === null) value = { paths: await walkListFiles(root), engine: 'walk' }
  fileListCache.set(root, { at: Date.now(), value })
  return value
}

/**
 * Normalize one emitted path to the root-relative '/'-separated contract.
 * @param {string} raw - engine output.
 * @returns {string} normalized path ('' when empty).
 */
function normalizeListedPath(raw) {
  const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
  return line.replaceAll('\\', '/').replace(/^\.\//u, '')
}

/**
 * `rg --files` behind the same exclusion table as the content search.
 * @param {string} binary - ripgrep path.
 * @param {string} root - working directory.
 * @returns {Promise<string[]|null>} paths, or null when the process could not start.
 */
function rgListFiles(binary, root) {
  return new Promise((resolve) => {
    const argv = [
      '--no-config',
      '--no-messages',
      '--hidden',
      '--no-ignore-vcs',
      '--files',
      ...EXCLUDE_GLOBS.flatMap((glob) => ['--glob', glob]),
      '.',
    ]
    const child = spawn(binary, argv, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    /** @type {string[]} */
    const paths = []
    let pending = ''
    let settled = false
    let overflow = false
    const timer = setTimeout(() => {
      overflow = true
      child.kill('SIGKILL')
    }, 6000)
    if (typeof timer.unref === 'function') timer.unref()
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    child.stdout.on('data', (chunk) => {
      if (settled) return
      pending += chunk.toString('utf8')
      if (paths.length > MAX_LISTED_FILES) {
        overflow = true
        child.kill('SIGKILL')
        return
      }
      const rows = pending.split('\n')
      pending = rows.pop() ?? ''
      for (const row of rows) {
        const path = normalizeListedPath(row)
        if (path !== '') paths.push(path)
      }
    })
    child.stdout.on('end', () => {
      const path = normalizeListedPath(pending)
      if (!settled && path !== '') paths.push(path)
    })
    child.once('error', () => { finish(null) })
    child.once('close', (code) => {
      // An engine that failed before emitting anything is a fallback signal, not
      // an empty workspace.
      finish(code !== 0 && paths.length === 0 ? null : paths)
    })
  })
}

/**
 * Bounded recursive listing used when ripgrep is unavailable.
 * @param {string} root - absolute directory.
 * @returns {Promise<string[]>} relative paths.
 */
async function walkListFiles(root) {
  /** @type {string[]} */
  const paths = []
  const stack = [root]
  let visited = 0
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      visited += 1
      if (visited > MAX_VISITED * 2 || paths.length >= MAX_LISTED_FILES) return paths
      if (entry.isSymbolicLink()) continue
      const absolute = nodePath.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name)) stack.push(absolute)
        continue
      }
      if (!entry.isFile()) continue
      paths.push(nodePath.relative(root, absolute).split(nodePath.sep).join('/'))
    }
  }
  return paths
}

/**
 * Rank workspace files by a name/path query.
 * @param {string} root - absolute directory.
 * @param {string} query - query text.
 * @param {{ limit?: number, preferWalk?: boolean }} [options] - result cap / engine override.
 * @returns {Promise<{files: Array<{path: string, name: string, dir: string}>, truncated: boolean, scanned: number, engine: 'rg'|'walk'}>} ranked files.
 */
export async function searchFilesByName(root, query, options = {}) {
  const needle = query.trim()
  if (needle === '') throw new SearchError('invalid-pattern', '搜索关键词不能为空')
  const listed = await listWorkspaceFiles(root, options)
  const limit = Math.min(options.limit ?? MAX_FILE_RESULTS, MAX_FILE_RESULTS)
  const scored = []
  for (const path of listed.paths) {
    const score = scoreFileMatch(path, needle)
    if (score > 0) scored.push({ path, score })
  }
  scored.sort((left, right) => right.score - left.score
    || left.path.length - right.path.length
    || left.path.localeCompare(right.path))
  return {
    files: scored.slice(0, limit).map(({ path }) => ({ path, name: basenameOf(path), dir: dirnameOf(path) })),
    truncated: scored.length > limit,
    scanned: listed.paths.length,
    engine: listed.engine,
  }
}

/**
 * Compile the query once for the fallback walk.
 * @param {string} query - literal text or regular expression.
 * @param {{ regex: boolean, caseSensitive: boolean }} options - matching mode.
 * @returns {(line: string) => { column: number } | null} first-hit probe.
 */
export function compileMatcher(query, options) {
  if (options.regex) {
    let pattern
    try {
      pattern = new RegExp(query, options.caseSensitive ? 'gu' : 'giu')
    } catch (error) {
      throw new SearchError('invalid-pattern', `正则表达式无效：${String(error?.message ?? error)}`)
    }
    return (line) => {
      pattern.lastIndex = 0
      const found = pattern.exec(line)
      return found === null ? null : { column: found.index + 1 }
    }
  }
  const needle = options.caseSensitive ? query : query.toLowerCase()
  return (line) => {
    const haystack = options.caseSensitive ? line : line.toLowerCase()
    const index = haystack.indexOf(needle)
    return index === -1 ? null : { column: index + 1 }
  }
}

/**
 * Bounded recursive search used when no ripgrep binary is available.
 * @param {object} request - search parameters.
 * @param {string} request.root - absolute directory to search.
 * @param {string} request.query - literal text or regular expression.
 * @param {boolean} request.regex - treat `query` as a regular expression.
 * @param {boolean} request.caseSensitive - match case exactly.
 * @param {number} [request.limit] - result cap.
 * @param {number} [request.timeoutMs] - wall-clock budget.
 * @returns {Promise<{engine: 'walk', matches: SearchHit[], truncated: boolean, scannedFiles: number}>} outcome.
 */
export async function walkSearch(request) {
  const limit = Math.min(request.limit ?? MAX_MATCHES, MAX_MATCHES)
  const deadline = Date.now() + (request.timeoutMs ?? SEARCH_TIMEOUT_MS)
  const probe = compileMatcher(request.query, request)
  /** @type {SearchHit[]} */
  const matches = []
  let visited = 0
  let scannedFiles = 0
  let truncated = false

  /** @param {string} dir */
  const visit = async (dir) => {
    if (truncated) return
    if (Date.now() > deadline) { truncated = true; return }
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (truncated) return
      visited += 1
      if (visited > MAX_VISITED) { truncated = true; return }
      if (entry.isSymbolicLink()) continue
      const absolute = nodePath.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) continue
        await visit(absolute)
        continue
      }
      if (!entry.isFile()) continue
      if (BINARY_EXTENSIONS.has(nodePath.extname(entry.name).toLowerCase())) continue
      let stat
      try {
        stat = await fsp.stat(absolute)
      } catch {
        continue
      }
      if (stat.size === 0 || stat.size > MAX_FILE_BYTES) continue
      let content
      try {
        content = await fsp.readFile(absolute, 'utf8')
      } catch {
        continue
      }
      scannedFiles += 1
      if (content.includes('\u0000')) continue
      const relative = nodePath.relative(request.root, absolute).split(nodePath.sep).join('/')
      let perFile = 0
      const lines = content.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        const hit = probe(lines[index])
        if (hit === null) continue
        matches.push({ path: relative, line: index + 1, column: hit.column, text: truncateLine(lines[index]) })
        perFile += 1
        if (perFile >= MAX_MATCHES_PER_FILE) break
        if (matches.length >= limit) { truncated = true; break }
      }
      if (matches.length >= limit) { truncated = true; return }
    }
  }

  await visit(request.root)
  return { engine: 'walk', matches, truncated, scannedFiles }
}

/** Cached ripgrep binary path: `undefined` = not resolved yet, `null` = unavailable. */
let cachedRipgrep
let ripgrepProbed = false

/**
 * Module-resolution bases that can hold the Harness's `@vscode/ripgrep`
 * wrapper. The plugin itself is installed (or linked) inside a profile, but
 * its real path can live in an unrelated workspace, so the profile and
 * `DSH_HOME` are probed explicitly instead of trusting the import chain.
 * @returns {string[]} absolute directory candidates.
 */
function ripgrepBases() {
  const bases = []
  if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== '') {
    bases.push(process.env.DSH_PROFILE_DIR)
  }
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') {
    bases.push(nodePath.join(process.env.DSH_HOME, 'profiles'))
  }
  bases.push(process.cwd())
  return bases
}

/**
 * Resolve the ripgrep binary: an explicit override first, then the packaged
 * `@vscode/ripgrep` dependency the Harness ships, then `rg` on PATH.
 * @returns {Promise<string|null>} absolute binary path, or null when unavailable.
 */
export async function resolveRipgrep() {
  if (ripgrepProbed) return cachedRipgrep ?? null
  ripgrepProbed = true
  const override = process.env.DSH_SIMPLE_SEARCH_RG
  if (typeof override === 'string' && override !== '') {
    cachedRipgrep = override
    return cachedRipgrep
  }
  const bases = [nodePath.dirname(fileURLToPath(import.meta.url)), ...ripgrepBases()]
  for (const base of bases) {
    try {
      const require = createRequire(nodePath.join(base, 'package.json'))
      const { rgPath } = require('@vscode/ripgrep')
      if (typeof rgPath === 'string' && rgPath !== '' && existsSync(rgPath)) {
        cachedRipgrep = rgPath
        return cachedRipgrep
      }
    } catch {
      /* try the next base */
    }
  }
  const fromPath = await new Promise((resolve) => {
    const child = spawn('rg', ['--version'], { stdio: 'ignore' })
    child.once('error', () => { resolve(null) })
    child.once('exit', (code) => { resolve(code === 0 ? 'rg' : null) })
  })
  cachedRipgrep = fromPath
  return cachedRipgrep
}

/** Test seam: forget the probe result. */
export function resetRipgrepProbe() {
  ripgrepProbed = false
  cachedRipgrep = undefined
}

/**
 * Run the literal/regex search through ripgrep.
 * @param {object} request - search parameters.
 * @param {string} request.root - absolute directory to search.
 * @param {string} request.query - literal text or regular expression.
 * @param {boolean} request.regex - treat `query` as a regular expression.
 * @param {boolean} request.caseSensitive - match case exactly.
 * @param {number} [request.limit] - result cap.
 * @param {number} [request.timeoutMs] - wall-clock budget.
 * @returns {Promise<{engine: 'rg', matches: SearchHit[], truncated: boolean}>} outcome.
 */
export function rgSearch(request) {
  return resolveRipgrep().then((binary) => {
    if (binary === null || binary === undefined) {
      throw new SearchError('denied', '没有可用的 ripgrep 二进制')
    }
    const limit = Math.min(request.limit ?? MAX_MATCHES, MAX_MATCHES)
    const argv = [
      '--no-config',
      '--no-messages',
      '--hidden',
      '--no-ignore-vcs',
      '--color', 'never',
      '--no-heading',
      '--line-number',
      '--column',
      '--max-columns', String(MAX_LINE_CHARS),
      '--max-columns-preview',
      '--max-count', String(MAX_MATCHES_PER_FILE),
      '--threads', '4',
      ...(request.caseSensitive ? ['--case-sensitive'] : ['--ignore-case']),
      ...(request.regex ? [] : ['--fixed-strings']),
      ...EXCLUDE_GLOBS.flatMap((glob) => ['--glob', glob]),
      '--',
      request.query,
      '.',
    ]
    return new Promise((resolve, reject) => {
      const child = spawn(binary, argv, { cwd: request.root, stdio: ['ignore', 'pipe', 'pipe'] })
      /** @type {SearchHit[]} */
      const matches = []
      let pending = ''
      let truncated = false
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        truncated = true
        child.kill('SIGKILL')
      }, request.timeoutMs ?? SEARCH_TIMEOUT_MS)
      if (typeof timer.unref === 'function') timer.unref()

      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error !== undefined) reject(error)
        else resolve({ engine: 'rg', matches, truncated })
      }

      const consume = (chunk, flush = false) => {
        pending += chunk.toString('utf8')
        if (pending.length > 16_000_000) {
          truncated = true
          child.kill('SIGKILL')
          return
        }
        const rows = pending.split('\n')
        pending = flush ? '' : (rows.pop() ?? '')
        for (const row of rows) {
          if (settled || truncated) return
          if (row === '') continue
          const hit = parseRgLine(row)
          if (hit !== null) matches.push(hit)
          if (matches.length >= limit) {
            truncated = true
            child.kill('SIGKILL')
            return
          }
        }
      }

      child.stdout.on('data', (chunk) => { consume(chunk) })
      child.stdout.on('end', () => { consume('', true) })
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 4000) stderr += chunk.toString('utf8')
      })
      child.once('error', (error) => {
        finish(new SearchError('denied', `ripgrep 启动失败：${String(error?.message ?? error)}`))
      })
      child.once('close', (code) => {
        consume('', true)
        if (code === 0 || code === 1 || truncated) {
          finish()
          return
        }
        const detail = stderr.trim()
        finish(new SearchError(
          /regex|pattern/iu.test(detail) ? 'invalid-pattern' : 'denied',
          detail === '' ? `ripgrep 退出码 ${String(code)}` : detail,
        ))
      })
    })
  })
}

/**
 * Search one workspace directory with the best available engine.
 * @param {object} request - search parameters.
 * @param {string} request.root - absolute directory to search.
 * @param {string} request.query - literal text or regular expression.
 * @param {boolean} request.regex - treat `query` as a regular expression.
 * @param {boolean} request.caseSensitive - match case exactly.
 * @param {number} [request.limit] - result cap.
 * @param {number} [request.timeoutMs] - wall-clock budget.
 * @param {boolean} [request.preferWalk] - force the fallback engine (tests).
 * @returns {Promise<{engine: string, matches: SearchHit[], truncated: boolean, elapsedMs: number}>} outcome.
 */
export async function searchWorkspace(request) {
  const started = Date.now()
  const mode = request.mode === 'files' || request.mode === 'all' ? request.mode : 'text'
  const normalized = {
    root: request.root,
    query: request.query,
    regex: request.regex === true,
    caseSensitive: request.caseSensitive === true,
    limit: request.limit ?? MAX_MATCHES,
    timeoutMs: request.timeoutMs ?? SEARCH_TIMEOUT_MS,
  }
  if (normalized.query === '') throw new SearchError('invalid-pattern', '搜索关键词不能为空')
  if (normalized.query.length > 300) throw new SearchError('invalid-pattern', '搜索关键词过长（最多 300 个字符）')
  if (mode !== 'files' && normalized.regex) compileMatcher(normalized.query, normalized)

  let files = []
  let matches = []
  let truncated = false
  let scanned = 0
  let engine = 'rg'

  if (mode !== 'text') {
    const listed = await searchFilesByName(normalized.root, normalized.query, {
      preferWalk: request.preferWalk === true,
    })
    files = listed.files
    truncated = listed.truncated
    scanned = listed.scanned
    engine = listed.engine
  }

  if (mode !== 'files') {
    const binary = request.preferWalk === true ? null : await resolveRipgrep()
    const outcome = binary === null ? await walkSearch(normalized) : await rgSearch(normalized)
    matches = outcome.matches
    engine = outcome.engine
    truncated = truncated || outcome.truncated === true
  }

  return { mode, engine, files, matches, truncated, scanned, elapsedMs: Date.now() - started }
}
