import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  SearchError,
  compileMatcher,
  isWithin,
  parseRgLine,
  scoreFileMatch,
  searchFilesByName,
  searchWorkspace,
  shouldSkipDirectory,
  truncateLine,
  walkSearch,
} from '../search.js'

describe('parseRgLine', () => {
  it('parses a relative ripgrep row and strips the ./ prefix', () => {
    assert.deepEqual(parseRgLine('./src/a.ts:12:3:const value = 1'), {
      path: 'src/a.ts', line: 12, column: 3, text: 'const value = 1',
    })
  })

  it('keeps a Windows drive letter inside the path', () => {
    assert.deepEqual(parseRgLine('C:\\repo\\src\\a.ts:3:1:text'), {
      path: 'C:/repo/src/a.ts', line: 3, column: 1, text: 'text',
    })
  })

  it('returns null for a row that is not a match', () => {
    assert.equal(parseRgLine('not a match row'), null)
    assert.equal(parseRgLine('./a.ts:x:1:text'), null)
  })
})

describe('truncateLine', () => {
  it('keeps short lines untouched and drops a trailing CR', () => {
    assert.equal(truncateLine('abc\r'), 'abc')
    assert.equal(truncateLine('abc'), 'abc')
  })

  it('cuts long lines and never splits a surrogate pair', () => {
    const long = `${'a'.repeat(4)}😀${'b'.repeat(20)}`
    const cut = truncateLine(long, 6)
    assert.ok(cut.endsWith('…'))
    assert.ok(!/[\uD800-\uDBFF]$/u.test(cut.slice(0, -1)))
  })
})

describe('compileMatcher', () => {
  it('matches literals case-insensitively by default', () => {
    const probe = compileMatcher('needle', { regex: false, caseSensitive: false })
    assert.deepEqual(probe('xx NEEDLE yy'), { column: 4 })
    assert.equal(probe('nothing'), null)
  })

  it('honours case sensitivity', () => {
    const probe = compileMatcher('needle', { regex: false, caseSensitive: true })
    assert.equal(probe('NEEDLE'), null)
    assert.deepEqual(probe('needle'), { column: 1 })
  })

  it('supports regular expressions and rejects an invalid one', () => {
    const probe = compileMatcher('a+b', { regex: true, caseSensitive: true })
    assert.deepEqual(probe('xaab'), { column: 2 })
    assert.throws(() => compileMatcher('(', { regex: true, caseSensitive: true }), SearchError)
  })
})

describe('isWithin', () => {
  it('accepts the root itself and nested paths only', () => {
    assert.equal(isWithin('/work/a', '/work/a'), true)
    assert.equal(isWithin('/work/a/b', '/work/a'), true)
    assert.equal(isWithin('/work/ab', '/work/a'), false)
    assert.equal(isWithin('/other', '/work/a'), false)
  })
})

describe('shouldSkipDirectory', () => {
  it('skips dependency, VCS and virtualenv names but not ordinary source dirs', () => {
    assert.equal(shouldSkipDirectory('node_modules'), true)
    assert.equal(shouldSkipDirectory('.git'), true)
    assert.equal(shouldSkipDirectory('.venv_linux'), true)
    assert.equal(shouldSkipDirectory('site-packages'), true)
    assert.equal(shouldSkipDirectory('src'), false)
    assert.equal(shouldSkipDirectory('env'), false)
  })
})

describe('walkSearch', () => {
  let root
  before(async () => {
    root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'gs-walk-'))
    await fsp.mkdir(nodePath.join(root, 'src'), { recursive: true })
    await fsp.mkdir(nodePath.join(root, 'node_modules', 'pkg'), { recursive: true })
    await fsp.writeFile(nodePath.join(root, 'src', 'a.ts'), 'alpha\nBeta needle\nneedle again\n')
    await fsp.writeFile(nodePath.join(root, 'src', 'binary.bin'), 'needle\u0000binary')
    await fsp.writeFile(nodePath.join(root, 'node_modules', 'pkg', 'index.js'), 'needle in deps')
  })
  after(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('finds text per line, skips skipped directories and binaries', async () => {
    const result = await walkSearch({ root, query: 'needle', regex: false, caseSensitive: false })
    assert.equal(result.engine, 'walk')
    const files = result.matches.map((hit) => hit.path)
    assert.deepEqual([...new Set(files)], ['src/a.ts'])
    assert.equal(result.matches.length, 2)
    assert.deepEqual(result.matches[0], { path: 'src/a.ts', line: 2, column: 6, text: 'Beta needle' })
  })

  it('caps results and flags truncation', async () => {
    const result = await walkSearch({ root, query: 'needle', regex: false, caseSensitive: false, limit: 1 })
    assert.equal(result.matches.length, 1)
    assert.equal(result.truncated, true)
  })

  it('reports an invalid regular expression instead of scanning', async () => {
    await assert.rejects(
      () => walkSearch({ root, query: '(', regex: true, caseSensitive: false }),
      (error) => error instanceof SearchError && error.code === 'invalid-pattern',
    )
  })
})

describe('searchWorkspace', () => {
  let root
  before(async () => {
    root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'gs-search-'))
    await fsp.writeFile(nodePath.join(root, 'notes.md'), '# Title\nglobal search target\n')
    await fsp.writeFile(nodePath.join(root, 'notes-extra.txt'), 'notes in content\n')
  })
  after(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('rejects an empty query', async () => {
    await assert.rejects(
      () => searchWorkspace({ root, query: '', regex: false, caseSensitive: false }),
      (error) => error instanceof SearchError && error.code === 'invalid-pattern',
    )
  })

  it('returns hits through the fallback engine with timing', async () => {
    const result = await searchWorkspace({
      root, query: 'target', regex: false, caseSensitive: false, preferWalk: true,
    })
    assert.ok(typeof result.elapsedMs === 'number')
    assert.deepEqual(result.matches, [{ path: 'notes.md', line: 2, column: 15, text: 'global search target' }])
  })

  it('files mode lists names without running the content engine', async () => {
    const result = await searchWorkspace({ root, query: 'notes', mode: 'files', preferWalk: true })
    assert.equal(result.mode, 'files')
    assert.deepEqual(result.files.map((file) => file.path), ['notes.md', 'notes-extra.txt'])
    assert.equal(result.matches.length, 0)
  })

  it('all mode returns both file names and content matches', async () => {
    const result = await searchWorkspace({ root, query: 'notes', mode: 'all', preferWalk: true })
    assert.equal(result.mode, 'all')
    assert.equal(result.files.length, 2)
    assert.deepEqual(result.matches.map((hit) => hit.path), ['notes-extra.txt'])
  })
})

describe('file search', () => {
  let root
  before(async () => {
    root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'gs-files-'))
    await fsp.mkdir(nodePath.join(root, 'src', 'net'), { recursive: true })
    await fsp.mkdir(nodePath.join(root, 'docs'), { recursive: true })
    await fsp.mkdir(nodePath.join(root, 'node_modules', 'pkg'), { recursive: true })
    await fsp.writeFile(nodePath.join(root, 'src', 'http.ts'), 'export const http = 1\n')
    await fsp.writeFile(nodePath.join(root, 'src', 'http-executor.ts'), 'http handler\n')
    await fsp.writeFile(nodePath.join(root, 'src', 'net', 'http-client.ts'), 'client\n')
    await fsp.writeFile(nodePath.join(root, 'docs', 'http.md'), '# http\n')
    await fsp.writeFile(nodePath.join(root, 'node_modules', 'pkg', 'http.js'), 'http\n')
  })
  after(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('ranks exact, prefix, path and fuzzy hits, and rejects non-matches', () => {
    assert.ok(scoreFileMatch('src/http.ts', 'http.ts') > scoreFileMatch('src/http.ts', 'http'))
    assert.ok(scoreFileMatch('src/http.ts', 'http') > scoreFileMatch('src/net/http-client.ts', 'net'))
    assert.ok(scoreFileMatch('src/net/http-client.ts', 'net') > scoreFileMatch('src/http-executor.ts', 'htex'))
    assert.equal(scoreFileMatch('src/a.ts', 'zzz'), 0)
    assert.equal(scoreFileMatch('src/a.ts', '   '), 0)
  })

  it('finds files by name, skips dependency trees and caps results', async () => {
    const result = await searchFilesByName(root, 'http', { preferWalk: true, limit: 2 })
    assert.equal(result.engine, 'walk')
    assert.equal(result.files.length, 2)
    assert.equal(result.truncated, true)
    assert.ok(result.files.every((file) => file.path.startsWith('docs/') || file.path.startsWith('src/')))
    assert.ok(result.files.every((file) => !file.path.includes('node_modules')))
  })

  it('matches a concatenated fuzzy query', async () => {
    const result = await searchFilesByName(root, 'htexec', { preferWalk: true, limit: 5 })
    assert.deepEqual(result.files.map((file) => file.path), ['src/http-executor.ts'])
  })
})
