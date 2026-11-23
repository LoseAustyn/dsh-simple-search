/**
 * Browser-half tests for the appearance preference: the Plugin Manager card's
 * three choices, browser-local persistence, and the `follow` mode resolving
 * the DSH color scheme. The page module runs inside a VM with a fake React and
 * a fake localStorage, so no DOM or browser session is involved.
 */

import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import vm from 'node:vm'
import { describe, it } from 'node:test'

const SOURCE = await fsp.readFile(new URL('../client.js', import.meta.url), 'utf8')
const APPEARANCE_KEY = 'dsh-simple-search:appearance'

/**
 * Minimal localStorage stand-in.
 * @param {Record<string, string>} [initial] - stored values.
 * @param {{failRead?: boolean, failWrite?: boolean}} [faults] - simulate blocked storage.
 * @returns {object} storage plus its rows.
 */
function createStorage(initial = {}, faults = {}) {
  const rows = new Map(Object.entries(initial))
  return {
    rows,
    getItem(key) {
      if (faults.failRead === true) throw new Error('storage blocked')
      return rows.has(key) ? rows.get(key) : null
    },
    setItem(key, value) {
      if (faults.failWrite === true) throw new Error('storage blocked')
      rows.set(key, value)
    },
    removeItem(key) { rows.delete(key) },
  }
}

/**
 * Fake React that renders plain trees and replays hook initial state. The
 * components under test never need an update cycle: a test re-invokes the
 * component after changing the store, which is exactly what a re-render sees.
 * State setters are recorded so a test can assert what a key handler wrote.
 * @param {{stateOverrides?: Record<number, unknown>}} [options] - force the
 *   initial value of the n-th `useState` call (0-based).
 * @returns {object} the React surface the client module destructures plus the
 *   recorded `updates` (`{ index, value }`).
 */
function createReact(options = {}) {
  const overrides = options.stateOverrides ?? {}
  const updates = []
  let calls = 0
  return {
    updates,
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } }
    },
    useState(initial) {
      const index = calls
      calls += 1
      const value = Object.hasOwn(overrides, index)
        ? overrides[index]
        : (typeof initial === 'function' ? initial() : initial)
      return [value, (next) => { updates.push({ index, value: next }) }]
    },
    useEffect() {},
    useRef(initial) { return { current: initial } },
    useCallback(callback) { return callback },
    useMemo(factory) { return factory() },
    Fragment: Symbol('Fragment'),
  }
}

/**
 * Load the page module and expose its plugin definition.
 * @param {{storage?: object, bodyDark?: boolean, stateOverrides?: Record<number, unknown>}} [options] - harness inputs.
 * @returns {{plugin: object, React: object, storage: object, clipboard: object}} loaded module pieces.
 */
function loadPlugin(options = {}) {
  const storage = options.storage ?? createStorage()
  let factory
  const body = {
    hasAttribute(name) { return name === 'data-ds-dark-theme' ? options.bodyDark === true : false },
  }
  const clipboard = {
    text: '',
    writeText(text) {
      this.text = text
      return Promise.resolve()
    },
  }
  const sandbox = {
    window: {
      localStorage: storage,
      __ModuleLoader__: { load(definition) { factory = definition.factory } },
      addEventListener() {},
      removeEventListener() {},
      setTimeout() { return 0 },
      clearTimeout() {},
      requestAnimationFrame() { return 0 },
      cancelAnimationFrame() {},
    },
    document: {
      body,
      baseURI: 'http://localhost/',
      createElement() { return {} },
      querySelector(selector) {
        if (typeof selector !== 'string' || !selector.startsWith('[data-conversation-session=')) return null
        return {
          querySelectorAll(inner) {
            return inner === '[data-chat-anchor-key]' || inner === '[data-chat-node-key]'
              ? (options.chatRows ?? [])
              : []
          },
        }
      },
    },
    navigator: { clipboard },
    console,
    URL,
    AbortController,
  }
  vm.runInNewContext(SOURCE, sandbox, { filename: 'client.js' })
  assert.equal(typeof factory, 'function', 'the page module registers a factory')
  const React = createReact(options)
  const plugin = factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected module request: ${name}`)
  })
  return { plugin, React, storage, clipboard }
}

/**
 * Fake DSH theme service.
 * @param {'light'|'dark'} scheme - effective scheme.
 * @returns {object} `getTheme` returning a snapshot.
 */
function fakeTheme(scheme) {
  return { getTheme: () => ({ preference: scheme, active: { id: scheme, colorScheme: scheme } }) }
}

/**
 * Mount the plugin against a fake client context.
 * @param {{storage?: object, bodyDark?: boolean, theme?: object, stateOverrides?: Record<number, unknown>}} [options] - harness inputs.
 * @returns {object} loaded pieces plus captured registrations and a theme emitter.
 */
function setup(options = {}) {
  const loaded = loadPlugin(options)
  const dictionaries = {}
  const registrations = []
  const themeListeners = []
  const ctx = {
    get(name) {
      if (name === 'theme') return options.theme
      if (name === 'sessions') return options.sessions
      if (name === 'uiSession') return options.uiSession
      if (name === 'uiWorkspace') return options.uiWorkspace
      if (name === 'betterSidebar') return options.betterSidebar
      if (name === 'conversation') return options.conversation
      return undefined
    },
    on(event, listener) {
      if (event !== 'theme/change') return () => {}
      themeListeners.push(listener)
      return () => {
        const at = themeListeners.indexOf(listener)
        if (at !== -1) themeListeners.splice(at, 1)
      }
    },
    effect(callback) {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    locale: {
      register(namespace, dicts) {
        dictionaries[namespace] = dicts
        return () => {}
      },
    },
    slots: {
      inject(_name, callback) { return callback() },
      register(registration, component) {
        registrations.push({ registration, component })
        return () => {}
      },
    },
  }
  loaded.plugin.apply(ctx)
  return {
    ...loaded,
    dictionaries,
    registrations,
    overlay: registrations.find(entry => entry.registration.name === 'shell.overlay'),
    settings: registrations.find(entry => entry.registration.name === 'plugins.bundle.config'),
    bridge: registrations.find(entry => entry.registration.name === 'conversation.input.overlay'),
    emitTheme(scheme) {
      for (const listener of [...themeListeners]) listener(fakeTheme(scheme).getTheme())
    },
  }
}

/**
 * Translate keys to themselves, keeping interpolation parameters visible.
 * @param {string} key - dictionary key.
 * @param {Record<string, unknown>} [params] - interpolation parameters.
 * @returns {string} assertion-friendly text.
 */
function translate(key, params) {
  return params === undefined ? key : `${key}(${JSON.stringify(params)})`
}

/**
 * Collect rendered nodes matching a predicate.
 * @param {unknown} node - rendered tree.
 * @param {(node: object) => boolean} predicate - matcher.
 * @returns {object[]} matches in render order.
 */
function findAll(node, predicate) {
  const out = []
  const walk = (value) => {
    if (value === null || value === undefined || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry)
      return
    }
    if (predicate(value)) out.push(value)
    walk(value.props?.children)
  }
  walk(node)
  return out
}

/**
 * Render the settings card and return its three choice buttons plus the tree.
 * @param {object} harness - mounted plugin harness.
 * @returns {{tree: object, buttons: object[]}} rendered card pieces.
 */
function renderSettings(harness) {
  const tree = harness.settings.component({ view: 'page', t: translate })
  return { tree, buttons: findAll(tree, node => node.type === 'button') }
}

/** The label of the currently selected choice. */
function activeLabel(buttons) {
  return buttons.find(button => button.props['data-active'] === 'true')?.props.children
}

describe('appearance preference', () => {
  it('defaults to Follow DSH and shows the current DSH scheme', () => {
    const harness = setup({ theme: fakeTheme('dark') })
    const { tree, buttons } = renderSettings(harness)
    assert.equal(buttons.length, 3)
    assert.deepEqual(buttons.map(button => button.props.children), [
      'appearance.light', 'appearance.dark', 'appearance.follow',
    ])
    assert.equal(activeLabel(buttons), 'appearance.follow')
    const status = findAll(tree, node => node.props?.className === 'ss-appearance-status')
    assert.equal(status.length, 1)
    assert.equal(status[0].props.children, 'appearance.effective({"scheme":"appearance.dark"})')
  })

  it('reads a stored Light or Dark choice instead of following DSH', () => {
    const dark = setup({ storage: createStorage({ [APPEARANCE_KEY]: 'dark' }), theme: fakeTheme('light') })
    const darkRender = renderSettings(dark)
    assert.equal(activeLabel(darkRender.buttons), 'appearance.dark')
    assert.equal(findAll(darkRender.tree, node => node.props?.className === 'ss-appearance-status').length, 0)

    const light = setup({ storage: createStorage({ [APPEARANCE_KEY]: 'light' }), theme: fakeTheme('dark') })
    assert.equal(activeLabel(renderSettings(light).buttons), 'appearance.light')
  })

  it('falls back to Follow DSH for an unknown stored value', () => {
    const harness = setup({ storage: createStorage({ [APPEARANCE_KEY]: 'sepia' }) })
    assert.equal(activeLabel(renderSettings(harness).buttons), 'appearance.follow')
  })

  it('persists a click and renders the new choice', () => {
    const harness = setup({ theme: fakeTheme('dark') })
    const first = renderSettings(harness)
    const lightButton = first.buttons.find(button => button.props.children === 'appearance.light')
    lightButton.props.onClick()
    assert.equal(harness.storage.rows.get(APPEARANCE_KEY), 'light')
    const second = renderSettings(harness)
    assert.equal(activeLabel(second.buttons), 'appearance.light')
    assert.equal(harness.settings.registration.locale, 'simpleSearch')
  })

  it('keeps the choice in memory when storage is blocked', () => {
    const harness = setup({ storage: createStorage({}, { failRead: true, failWrite: true }) })
    const first = renderSettings(harness)
    assert.equal(activeLabel(first.buttons), 'appearance.follow')
    const darkButton = first.buttons.find(button => button.props.children === 'appearance.dark')
    darkButton.props.onClick()
    assert.equal(activeLabel(renderSettings(harness).buttons), 'appearance.dark')
  })

  it('repaints Follow DSH when the DSH theme changes', () => {
    const harness = setup({ theme: fakeTheme('dark') })
    const before = findAll(renderSettings(harness).tree, node => node.props?.className === 'ss-appearance-status')[0]
    assert.equal(before.props.children, 'appearance.effective({"scheme":"appearance.dark"})')
    harness.emitTheme('light')
    const after = findAll(renderSettings(harness).tree, node => node.props?.className === 'ss-appearance-status')[0]
    assert.equal(after.props.children, 'appearance.effective({"scheme":"appearance.light"})')
  })
})

describe('panel scheme', () => {
  /**
   * Render the overlay open: the first useState is the appearance snapshot,
   * the second is the panel's `open` flag.
   * @param {object} harness - mounted plugin harness.
   * @returns {object} the rendered layer node.
   */
  function renderOpenPanel(harness) {
    const tree = harness.overlay.component({ t: translate })
    const layer = findAll(tree, node => node.props?.className === 'gs-layer')
    assert.equal(layer.length, 1)
    return layer[0]
  }

  it('follows the DSH scheme', () => {
    const dark = setup({ bodyDark: true, stateOverrides: { 1: true } })
    assert.equal(renderOpenPanel(dark).props['data-gs-scheme'], 'dark')
    const light = setup({ bodyDark: false, stateOverrides: { 1: true } })
    assert.equal(renderOpenPanel(light).props['data-gs-scheme'], 'light')
  })

  it('lets a stored choice override the DSH scheme', () => {
    const forcedLight = setup({
      bodyDark: true,
      storage: createStorage({ [APPEARANCE_KEY]: 'light' }),
      stateOverrides: { 1: true },
    })
    assert.equal(renderOpenPanel(forcedLight).props['data-gs-scheme'], 'light')
    const forcedDark = setup({
      bodyDark: false,
      storage: createStorage({ [APPEARANCE_KEY]: 'dark' }),
      stateOverrides: { 1: true },
    })
    assert.equal(renderOpenPanel(forcedDark).props['data-gs-scheme'], 'dark')
  })

  it('applies the DSH theme service even when the body attribute is stale', () => {
    const harness = setup({ bodyDark: true, theme: fakeTheme('light'), stateOverrides: { 1: true } })
    assert.equal(renderOpenPanel(harness).props['data-gs-scheme'], 'light')
  })
})

describe('registrations and dictionaries', () => {
  it('registers the overlay and the bundle configuration card', () => {
    const harness = setup()
    assert.equal(harness.overlay.registration.id, 'simple-search')
    assert.equal(harness.settings.registration.key, 'dsh-simple-search')
    assert.equal(harness.settings.registration.name, 'plugins.bundle.config')
  })

  it('publishes the appearance strings in both dictionaries', () => {
    const harness = setup()
    const dicts = harness.dictionaries.simpleSearch
    assert.equal(dicts.zh['appearance.light'], '浅色')
    assert.equal(dicts.zh['appearance.dark'], '深色')
    assert.equal(dicts.zh['appearance.follow'], '跟随 DSH')
    assert.equal(dicts.en['appearance.light'], 'Light')
    assert.equal(dicts.en['appearance.dark'], 'Dark')
    assert.equal(dicts.en['appearance.follow'], 'Follow DSH')
  })
})

/**
 * Build a Session-list snapshot shaped like `ctx.sessions.list.getSnapshot()`.
 * @param {Array<object>} rows - session rows; `mainView` marks the open chat.
 * @returns {object} SessionListState snapshot.
 */
function sessionSnapshot(rows) {
  const byId = {}
  for (const row of rows) {
    byId[row.id] = {
      id: row.id,
      title: row.title,
      displayTitle: row.displayTitle ?? row.title,
      cwd: row.cwd,
      updatedAt: row.updatedAt,
      running: row.running === true,
      blank: row.blank === true,
      origin: row.origin,
      retainedBy: row.mainView === true ? { mainView: 1 } : {},
    }
  }
  return { ids: rows.map((row) => row.id), byId, phase: 'ready', projectionsBySession: {} }
}

/**
 * Fake `ctx.sessions` exposing a fixed catalog.
 * @param {object} snapshot - SessionListState.
 * @returns {object} sessions service stand-in.
 */
function fakeSessions(snapshot) {
  return {
    list: { getSnapshot: () => snapshot, subscribe: () => () => {} },
    refresh: async () => {},
  }
}

describe('search scopes', () => {
  /**
   * Render the overlay with the supplied initial state.
   * @param {object} harness - mounted plugin harness.
   * @returns {object} rendered tree.
   */
  function renderOverlay(harness) {
    return harness.overlay.component({ t: translate })
  }

  it('shows three scopes and keeps the file tabs in the workspace scope', () => {
    const workspace = setup({ stateOverrides: { 1: true } })
    const workspaceTree = renderOverlay(workspace)
    assert.deepEqual(
      findAll(workspaceTree, node => node.props?.className === 'gs-scope')
        .map(button => button.props.children),
      ['scope.workspace', 'scope.sessions', 'scope.conversation'],
    )
    assert.equal(findAll(workspaceTree, node => node.props?.className === 'gs-tabs').length, 1)

    const sessions = setup({ stateOverrides: { 1: true, 2: 'sessions' } })
    const sessionsTree = renderOverlay(sessions)
    assert.equal(findAll(sessionsTree, node => node.props?.className === 'gs-tabs').length, 0)
    assert.equal(
      findAll(sessionsTree, node => node.props?.className === 'gs-input')[0].props.placeholder,
      'search.placeholder.sessions',
    )

    const conversation = setup({ stateOverrides: { 1: true, 2: 'conversation' } })
    assert.equal(
      findAll(renderOverlay(conversation), node => node.props?.className === 'gs-input')[0].props.placeholder,
      'search.placeholder.conversation',
    )
  })

  it('lists session titles across workspaces and opens the selected session', () => {
    const snapshot = sessionSnapshot([
      { id: 'session-alpha', title: 'Alpha plan', cwd: '/home/chen/projects/alpha', updatedAt: 200 },
      { id: 'session-beta', title: 'Beta notes', cwd: '/srv/beta', updatedAt: 100 },
      { id: 'session-sub', title: 'Alpha subagent', cwd: '/home/chen/projects/alpha', updatedAt: 300, origin: 'subagent' },
    ])
    const opened = []
    const harness = setup({
      sessions: fakeSessions(snapshot),
      uiWorkspace: { openSession: (id) => opened.push(id) },
      stateOverrides: { 1: true, 2: 'sessions', 3: 'alpha', 12: snapshot },
    })
    const tree = renderOverlay(harness)
    const rows = findAll(tree, node => node.props?.className === 'gs-session')
    assert.equal(rows.length, 1)
    assert.equal(findAll(rows[0], node => node.props?.className === 'gs-session-title')[0].props.children, 'Alpha plan')
    assert.equal(findAll(rows[0], node => node.props?.className === 'gs-session-meta')[0].props.children, 'alpha')
    rows[0].props.onClick()
    assert.deepEqual(opened, ['session-alpha'])
  })

  it('matches a session by its workspace directory', () => {
    const snapshot = sessionSnapshot([
      { id: 'session-alpha', title: 'Alpha plan', cwd: '/home/chen/projects/alpha', updatedAt: 200 },
      { id: 'session-beta', title: 'Notes', cwd: '/srv/beta', updatedAt: 100 },
    ])
    const harness = setup({
      sessions: fakeSessions(snapshot),
      stateOverrides: { 1: true, 2: 'sessions', 3: 'beta', 12: snapshot },
    })
    const rows = findAll(renderOverlay(harness), node => node.props?.className === 'gs-session')
    assert.equal(rows.length, 1)
    assert.equal(findAll(rows[0], node => node.props?.className === 'gs-session-title')[0].props.children, 'Notes')
  })

  it('renders current-session matches with roles and copies the full message', async () => {
    const snapshot = sessionSnapshot([
      { id: 'session-a', title: 'Chat', cwd: '/workspace', updatedAt: 10, mainView: true },
    ])
    const conversation = {
      sessionId: 'session-a',
      title: 'Chat',
      cwd: '/workspace',
      messageCount: 2,
      matchCount: 2,
      truncated: false,
      elapsedMs: 3,
      matches: [
        {
          seq: 8, role: 'assistant', time: 1_700_000_000_000, text: 'full assistant text',
          snippet: '…needle answer…', matchCount: 1,
        },
        {
          seq: 3, role: 'user', time: 1_699_999_999_000, text: 'needle question',
          snippet: 'needle question', matchCount: 1,
        },
      ],
    }
    const harness = setup({
      sessions: fakeSessions(snapshot),
      stateOverrides: { 1: true, 2: 'conversation', 3: 'needle', 12: snapshot, 13: 'ready', 14: conversation },
    })
    const rows = findAll(renderOverlay(harness), node => node.props?.className === 'gs-message')
    assert.equal(rows.length, 2)
    assert.equal(
      findAll(rows[0], node => node.props?.className === 'gs-message-role')[0].props.children,
      'message.role.assistant',
    )
    assert.ok(findAll(rows[0], node => node.type === 'mark').length >= 1)
    rows[0].props.onClick()
    await new Promise((resolve) => { setImmediate(resolve) })
    assert.equal(harness.clipboard.text, 'full assistant text')
  })

  it('jumps to the matching chat row instead of copying', async () => {
    const snapshot = sessionSnapshot([
      { id: 'session-a', title: 'Chat', cwd: '/workspace', updatedAt: 10, mainView: true },
    ])
    const conversation = {
      sessionId: 'session-a',
      title: 'Chat',
      cwd: '/workspace',
      messageCount: 1,
      matchCount: 1,
      truncated: false,
      elapsedMs: 3,
      matches: [{
        seq: 8, role: 'assistant', turn: 1, step: 1, messageId: 'asst-8',
        time: 1_700_000_000_000, text: 'full assistant text', snippet: '…needle answer…', matchCount: 1,
      }],
    }
    const reasoningRow = {
      attributes: {
        'data-chat-anchor-key': '["14:assistant-step1:1","reasoning"]',
        'data-chat-node-key': '14:assistant-step1:1',
      },
      getAttribute(name) { return this.attributes[name] ?? null },
      scrollIntoView(options) { this.scroll = options },
    }
    const row = {
      attributes: { 'data-chat-anchor-key': '14:assistant-step1:1', 'data-chat-node-key': '14:assistant-step1:1' },
      getAttribute(name) { return this.attributes[name] ?? null },
      scrollIntoView(options) { this.scroll = options },
    }
    const harness = setup({
      sessions: fakeSessions(snapshot),
      chatRows: [reasoningRow, row],
      stateOverrides: { 1: true, 2: 'conversation', 3: 'needle', 12: snapshot, 13: 'ready', 14: conversation },
    })
    const rows = findAll(renderOverlay(harness), node => node.props?.className === 'gs-message')
    assert.equal(findAll(rows[0], node => node.props?.className === 'gs-message-role')[0].props.children, 'message.role.assistant')
    rows[0].props.onClick()
    await new Promise((resolve) => { setImmediate(resolve) })
    assert.equal(reasoningRow.scroll, undefined)
    assert.equal(row.scroll.block, 'center')
    assert.equal(row.scroll.behavior, 'smooth')
    assert.equal(harness.clipboard.text, '')
  })

  it('falls back to the response part when the anchor key format moves', async () => {
    const snapshot = sessionSnapshot([
      { id: 'session-a', title: 'Chat', cwd: '/workspace', updatedAt: 10, mainView: true },
    ])
    const conversation = {
      sessionId: 'session-a',
      title: 'Chat',
      cwd: '/workspace',
      messageCount: 1,
      matchCount: 1,
      truncated: false,
      elapsedMs: 3,
      matches: [{
        seq: 9, role: 'assistant', turn: 2, step: 1, messageId: 'asst-9',
        time: 1_700_000_000_000, text: 'full assistant text', snippet: '…needle answer…', matchCount: 1,
      }],
    }
    const reasoningRow = {
      attributes: { 'data-chat-node-key': '14:assistant-step2:1', 'data-chat-group-part': 'reasoning' },
      getAttribute(name) { return this.attributes[name] ?? null },
      scrollIntoView(options) { this.scroll = options },
    }
    const responseRow = {
      attributes: { 'data-chat-node-key': '14:assistant-step2:1', 'data-chat-group-part': 'response' },
      getAttribute(name) { return this.attributes[name] ?? null },
      scrollIntoView(options) { this.scroll = options },
    }
    const harness = setup({
      sessions: fakeSessions(snapshot),
      chatRows: [reasoningRow, responseRow],
      stateOverrides: { 1: true, 2: 'conversation', 3: 'needle', 12: snapshot, 13: 'ready', 14: conversation },
    })
    const rows = findAll(renderOverlay(harness), node => node.props?.className === 'gs-message')
    rows[0].props.onClick()
    await new Promise((resolve) => { setImmediate(resolve) })
    assert.equal(reasoningRow.scroll, undefined)
    assert.equal(responseRow.scroll.block, 'center')
  })

  it('computes the user message anchor from its durable id', async () => {
    const snapshot = sessionSnapshot([
      { id: 'session-a', title: 'Chat', cwd: '/workspace', updatedAt: 10, mainView: true },
    ])
    const conversation = {
      sessionId: 'session-a',
      title: 'Chat',
      cwd: '/workspace',
      messageCount: 1,
      matchCount: 1,
      truncated: false,
      elapsedMs: 3,
      matches: [{
        seq: 3, role: 'user', turn: 1, messageId: 'msg-3',
        time: 1_699_999_999_000, text: 'needle question', snippet: 'needle question', matchCount: 1,
      }],
    }
    const row = {
      attributes: { 'data-chat-anchor-key': '13:input-messagemsg-3', 'data-chat-node-key': '13:input-messagemsg-3' },
      getAttribute(name) { return this.attributes[name] ?? null },
      scrollIntoView(options) { this.scroll = options },
    }
    const harness = setup({
      sessions: fakeSessions(snapshot),
      chatRows: [row],
      stateOverrides: { 1: true, 2: 'conversation', 3: 'needle', 12: snapshot, 13: 'ready', 14: conversation },
    })
    const rows = findAll(renderOverlay(harness), node => node.props?.className === 'gs-message')
    rows[0].props.onClick()
    await new Promise((resolve) => { setImmediate(resolve) })
    assert.equal(row.scroll.block, 'center')
    assert.equal(row.scroll.behavior, 'smooth')
  })

  it('asks for an open chat when no current session is known', () => {
    const snapshot = sessionSnapshot([
      { id: 'session-a', title: 'Chat', cwd: '/workspace', updatedAt: 10 },
    ])
    const harness = setup({
      sessions: fakeSessions(snapshot),
      stateOverrides: { 1: true, 2: 'conversation', 3: 'needle', 12: snapshot },
    })
    const tree = renderOverlay(harness)
    assert.equal(
      findAll(tree, node => node.props?.children === 'state.noSession').length,
      1,
    )
  })

  it('publishes the scope strings in both dictionaries', () => {
    const harness = setup()
    const dicts = harness.dictionaries.simpleSearch
    assert.equal(dicts.zh['scope.sessions'], '会话标题')
    assert.equal(dicts.zh['scope.conversation'], '本会话')
    assert.equal(dicts.en['scope.sessions'], 'Sessions')
    assert.equal(dicts.en['scope.conversation'], 'This chat')
    assert.equal(dicts.zh['state.conversationEmpty'], '当前会话里没有匹配的消息')
    assert.equal(dicts.en['message.role.assistant'], 'Assistant')
    assert.equal(dicts.zh['message.reveal'], '定位到这条消息')
  })
})

describe('keyboard shortcuts and file references', () => {
  /** The open panel's search field and the panel node that owns navigation. */
  function panelParts(harness) {
    const tree = harness.overlay.component({ t: translate })
    const input = findAll(tree, node => node.props?.className === 'gs-input')[0]
    input.props.ref.current = input
    const panel = findAll(tree, node => node.props?.className === 'gs-panel')[0]
    return { tree, input, panel }
  }

  /** Workspace data state with file-name and/or text hits. */
  function fileData(files, matches = []) {
    return {
      root: '/workspace',
      sessionId: 'session-a',
      files,
      matches,
      fileCount: files.length,
      matchCount: matches.length,
      textFileCount: files.length + matches.length,
      elapsedMs: 4,
      engine: 'rg',
    }
  }

  /** One retained Session plus the composer facade its reference lands on. */
  function sessionHarness(options = {}) {
    const snapshot = sessionSnapshot([
      { id: 'session-a', title: 'Chat', cwd: '/workspace', updatedAt: 1, mainView: true },
    ])
    return setup({
      sessions: { ...fakeSessions(snapshot), scope: () => ({}) },
      uiSession: { adapter: { current: { getSnapshot: () => ({ key: 'session-a' }) } } },
      ...options,
    })
  }

  it('cycles the three scopes with Tab and wraps backwards with Shift+Tab', () => {
    const forward = setup({ stateOverrides: { 1: true, 2: 'workspace' } })
    const forwardParts = panelParts(forward)
    let prevented = 0
    forwardParts.panel.props.onKeyDown({
      key: 'Tab',
      shiftKey: false,
      target: forwardParts.input,
      preventDefault() { prevented += 1 },
    })
    assert.equal(prevented, 1)
    assert.deepEqual(
      forward.React.updates.filter(update => update.index === 2).map(update => update.value),
      ['sessions'],
    )

    const backward = setup({ stateOverrides: { 1: true, 2: 'workspace' } })
    const backwardParts = panelParts(backward)
    backwardParts.panel.props.onKeyDown({
      key: 'Tab',
      shiftKey: true,
      target: backwardParts.input,
      preventDefault() {},
    })
    assert.deepEqual(
      backward.React.updates.filter(update => update.index === 2).map(update => update.value),
      ['conversation'],
    )
  })

  it('inserts the highlighted file with Alt+Enter and returns to the composer', () => {
    const inserted = []
    const facade = {
      focused: false,
      insertReference(reference, span) {
        inserted.push({ reference, span })
        return true
      },
      focus() { this.focused = true },
    }
    const harness = sessionHarness({
      conversation: { input: { for: () => facade } },
      stateOverrides: {
        1: true,
        2: 'workspace',
        3: 'app',
        7: 'ready',
        8: fileData([{ path: 'src/app.js', name: 'app.js', dir: 'src' }]),
      },
    })
    harness.bridge.component({
      sessionId: 'session-a',
      inputActions: { captureInsertion: () => ({ start: 14, end: 14, draftRev: 7 }) },
    })
    const { input, panel } = panelParts(harness)
    let prevented = 0
    panel.props.onKeyDown({
      key: 'Enter',
      altKey: true,
      target: input,
      preventDefault() { prevented += 1 },
    })
    assert.equal(prevented, 1)
    assert.equal(inserted.length, 1)
    // The insertion object is created inside the page realm, so compare
    // structurally rather than by prototype.
    assert.deepEqual({ ...inserted[0].reference }, {
      source: 'reference',
      ref: '@src/app.js',
      label: 'app.js',
      appearance: 'file',
      clipboardText: '@src/app.js',
    })
    assert.deepEqual(inserted[0].span, { start: 14, end: 14, draftRev: 7 })
    assert.equal(facade.focused, true)
    assert.equal(harness.React.updates.some(update => update.index === 1 && update.value === false), true)
  })

  it('references the file behind a text hit with Alt+Enter', () => {
    const inserted = []
    const facade = {
      insertReference(reference, span) {
        inserted.push({ reference, span })
        return true
      },
      focus() {},
    }
    const harness = sessionHarness({
      conversation: { input: { for: () => facade } },
      stateOverrides: {
        1: true,
        2: 'workspace',
        3: 'needle',
        4: 'text',
        7: 'ready',
        8: fileData([], [{
          path: 'src/app.js', line: 3, column: 2, text: 'needle here', name: 'app.js',
        }]),
      },
    })
    harness.bridge.component({
      sessionId: 'session-a',
      inputActions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 2 }) },
    })
    const { input, panel } = panelParts(harness)
    panel.props.onKeyDown({ key: 'Enter', altKey: true, target: input, preventDefault() {} })
    assert.equal(inserted.length, 1)
    assert.equal(inserted[0].reference.ref, '@src/app.js')
    assert.equal(inserted[0].reference.clipboardText, '@src/app.js')
  })

  it('copies the mention when no chat is open', async () => {
    const harness = setup({
      stateOverrides: {
        1: true,
        2: 'workspace',
        3: 'app',
        7: 'ready',
        8: fileData([{ path: 'src/app.js', name: 'app.js', dir: 'src' }]),
      },
    })
    const { input, panel } = panelParts(harness)
    let prevented = 0
    panel.props.onKeyDown({
      key: 'Enter',
      altKey: true,
      target: input,
      preventDefault() { prevented += 1 },
    })
    await new Promise((resolve) => { setImmediate(resolve) })
    assert.equal(prevented, 1)
    assert.equal(harness.clipboard.text, '@src/app.js')
    assert.equal(
      harness.React.updates.some(update => update.index === 11
        && String(update.value).startsWith('notice.noSessionReference')),
      true,
    )
  })

  it('leaves session rows alone when Alt+Enter marks a reference', () => {
    const snapshot = sessionSnapshot([
      { id: 'session-alpha', title: 'Alpha plan', cwd: '/home/chen/projects/alpha', updatedAt: 200 },
    ])
    const opened = []
    const harness = setup({
      sessions: fakeSessions(snapshot),
      uiWorkspace: { openSession: (id) => opened.push(id) },
      stateOverrides: { 1: true, 2: 'sessions', 3: 'alpha', 12: snapshot },
    })
    const { input, panel } = panelParts(harness)
    let prevented = 0
    panel.props.onKeyDown({
      key: 'Enter',
      altKey: true,
      target: input,
      preventDefault() { prevented += 1 },
    })
    assert.equal(prevented, 0)
    assert.deepEqual(opened, [])
  })

  it('shows only the shortcuts that are not self-evident', () => {
    const keysOf = (tree) => findAll(tree, node => node.props?.className === 'gs-hint')
      .map(hint => findAll(hint, node => node.props?.className === 'gs-key')
        .map(key => key.props.children)
        .join('+'))
    const workspace = setup({ stateOverrides: { 1: true, 2: 'workspace' } })
    assert.deepEqual(keysOf(panelParts(workspace).tree), ['Alt+Enter', 'Tab', 'Esc'])
    const sessions = setup({ stateOverrides: { 1: true, 2: 'sessions' } })
    assert.deepEqual(keysOf(panelParts(sessions).tree), ['Tab', 'Esc'])
  })

  it('publishes the reference strings in both dictionaries', () => {
    const harness = setup()
    const dicts = harness.dictionaries.simpleSearch
    assert.equal(dicts.zh['footer.reference'], '引用')
    assert.equal(dicts.en['footer.reference'], 'reference')
    assert.equal(dicts.zh['footer.scope'], 'Tab 切换范围')
    assert.equal(dicts.en['footer.scope'], 'Tab switch scope')
    assert.equal(dicts.zh['notice.noSessionReference'], '没有打开的会话，已复制 {target}')
    assert.equal(dicts.en['notice.referenceCopied'], 'Could not write to the input; copied {target}')
  })
})
