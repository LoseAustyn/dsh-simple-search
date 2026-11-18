/**
 * Browser half of the simple-search bundle.
 *
 * A JetBrains-style "Simple Search" panel: double-tap Shift anywhere in the
 * page opens a centered dialog that searches the text of every file in the
 * current workspace, ↑/↓ move through the hits, Enter opens the selected hit in
 * the side card editor at its line, Esc closes.
 *
 * The page half owns rendering, keyboard handling and the query debounce; the
 * host half (index.js) owns the directory resolution and the actual search.
 * Nothing here reads or writes another plugin's DOM.
 */

window.__ModuleLoader__.load({
  id: 'dsh-simple-search',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    /** Locale namespace owned by this plugin. */
    const NS = 'simpleSearch'
    const SEARCH_ROUTE = '/dsh-simple-search/search'
    /** A second Shift press within this window counts as a double tap. */
    const DOUBLE_TAP_MS = 400
    /** Typing debounce before a query reaches the host. */
    const DEBOUNCE_MS = 170
    /** Results requested per query (the host caps it at 400). */
    const RESULT_LIMIT = 300

    const ZH = {
      'meta.title': '简单搜索',
      'meta.description': '双击 Shift 打开，按内容搜索工作区里的所有文件。',
      'dialog.title': '在工作区文件中搜索',
      'search.placeholder': '搜索文本片段…',
      'search.clear': '清除',
      'search.case': '区分大小写',
      'search.regex': '正则表达式',
      'state.idle.title': '搜索工作区里的文件内容',
      'state.idle.hint': '双击 Shift 打开 · 输入关键词后按 Enter 打开第一个结果',
      'state.empty': '没有匹配结果',
      'state.emptyHint': '换个关键词，或切换 Aa / .* 的匹配方式',
      'state.error': '搜索失败：{message}',
      'footer.navigate': '↑↓ 选择',
      'footer.open': 'Enter 打开',
      'footer.close': 'Esc 关闭',
      'footer.truncated': '结果已截断',
      'footer.elapsed': '{ms} ms · {engine}',
      'engine.rg': 'ripgrep',
      'engine.walk': '内置遍历',
      'notice.copied': '已复制 {target}',
      'notice.noEditor': '未找到可用的编辑器面板，已复制 {target}',
      'notice.copyFailed': '复制失败：{target}',
      'notice.openFailed': '打开失败：{message}',
      'file.hits': '{count} 处',
      'tab.all': '全部',
      'tab.files': '文件',
      'tab.text': '文本',
      'role.tabs': '搜索范围',
      'section.files': '文件',
      'section.text': '文本匹配',
      'state.emptyFiles': '没有匹配的文件',
      'state.emptyFilesHint': '试试文件名的一部分，或切到「文本」按内容搜索',
      'footer.filesOnly': '{files} 个文件',
      'footer.textOnly': '{matches} 处匹配 · {textFiles} 个文件',
      'footer.all': '{files} 个文件 · {matches} 处匹配',
    }

    const EN = {
      'meta.title': 'Simple Search',
      'meta.description': 'Press Shift twice to search every file in the workspace by content.',
      'dialog.title': 'Search in workspace files',
      'search.placeholder': 'Search text…',
      'search.clear': 'Clear',
      'search.case': 'Match case',
      'search.regex': 'Regular expression',
      'state.idle.title': 'Search the contents of workspace files',
      'state.idle.hint': 'Press Shift twice to open · type a query and press Enter to open the first hit',
      'state.empty': 'No matches',
      'state.emptyHint': 'Try another query, or toggle Aa / .*',
      'state.error': 'Search failed: {message}',
      'footer.navigate': '↑↓ select',
      'footer.open': 'Enter open',
      'footer.close': 'Esc close',
      'footer.truncated': 'Results truncated',
      'footer.elapsed': '{ms} ms · {engine}',
      'engine.rg': 'ripgrep',
      'engine.walk': 'built-in walk',
      'notice.copied': 'Copied {target}',
      'notice.noEditor': 'No editor panel available; copied {target}',
      'notice.copyFailed': 'Could not copy {target}',
      'notice.openFailed': 'Could not open: {message}',
      'file.hits': '{count} hits',
      'tab.all': 'All',
      'tab.files': 'Files',
      'tab.text': 'Text',
      'role.tabs': 'Search scope',
      'section.files': 'Files',
      'section.text': 'Text matches',
      'state.emptyFiles': 'No matching files',
      'state.emptyFilesHint': 'Try part of a file name, or switch to Text to search contents',
      'footer.filesOnly': '{files} files',
      'footer.textOnly': '{matches} matches · {textFiles} files',
      'footer.all': '{files} files · {matches} matches',
    }

    const CSS = `
.gs-layer{position:fixed;inset:0;z-index:60;display:flex;align-items:flex-start;justify-content:center;pointer-events:auto;color-scheme:dark}
.gs-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.46)}
.gs-panel{position:relative;margin-top:8vh;width:min(880px,92vw);max-height:74vh;display:flex;flex-direction:column;
  background:#1e1f22;color:#dfe1e5;border:1px solid #3a3d42;border-radius:12px;overflow:hidden;
  box-shadow:0 20px 56px rgba(0,0,0,.55);font-size:13px;color-scheme:dark}
.gs-searchrow{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #34363b}
.gs-searchicon{flex:none;display:flex;color:#8b9098}
.gs-input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:#e8eaed;caret-color:#6ea8fe;
  font-size:15px;line-height:22px;padding:4px 0;font-family:inherit}
.gs-input::placeholder{color:#7d828a}
.gs-toggle{flex:none;min-width:28px;height:26px;padding:0 6px;border:1px solid transparent;border-radius:6px;
  background:transparent;color:#9aa0a8;font-size:11.5px;cursor:pointer;font-family:inherit}
.gs-toggle:hover{background:#2b2d30;color:#c9cdd4}
.gs-toggle[data-active="true"]{color:#8fb8ff;border-color:#3f4d66;background:#26303f}
.gs-toggle:focus-visible{outline:2px solid #6ea8fe;outline-offset:1px}
.gs-closekbd{flex:none;color:#8b9098;font-size:11px;border:1px solid #3a3d42;border-radius:4px;padding:1px 5px;margin-left:2px}
.gs-body{flex:1;min-height:120px;overflow:auto;overscroll-behavior:contain;scrollbar-color:#3a3d42 transparent}
.gs-body::-webkit-scrollbar{width:10px;height:10px}
.gs-body::-webkit-scrollbar-thumb{background:#3a3d42;border-radius:6px}
.gs-body::-webkit-scrollbar-track{background:transparent}
.gs-idle,.gs-empty,.gs-error{display:flex;flex-direction:column;gap:6px;align-items:center;justify-content:center;
  padding:36px 24px;text-align:center;color:#8b9098}
.gs-idle-title{font-size:13.5px;color:#dfe1e5}
.gs-idle-hint,.gs-empty-hint{font-size:12px;color:#7d828a}
.gs-error{color:#ff7b72;word-break:break-word}
.gs-group{display:block}
.gs-group-head{position:sticky;top:0;z-index:1;display:flex;align-items:baseline;gap:8px;padding:5px 12px;
  background:#232528;border-bottom:1px solid #303237}
.gs-group-name{font-size:12px;font-weight:600;color:#e8eaed;flex:none;max-width:45%;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-group-dir{font-size:11.5px;color:#8b9098;flex:1;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.gs-group-count{flex:none;font-size:11px;color:#8b9098}
.gs-hit{display:flex;gap:10px;width:100%;padding:3px 12px;border:0;background:transparent;cursor:pointer;
  text-align:left;color:#c9cdd4;font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);
  font-size:12.5px;line-height:19px}
.gs-hit[data-active="true"]{background:#2e436e;color:#ffffff}
.gs-hit:focus-visible{outline:2px solid #6ea8fe;outline-offset:-2px}
.gs-line{flex:none;width:52px;text-align:right;color:#6f747c;font-variant-numeric:tabular-nums;user-select:none}
.gs-hit[data-active="true"] .gs-line{color:#c3d3f0}
.gs-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:pre}
.gs-mark{background:rgba(255,199,88,.30);color:inherit;border-radius:2px}
.gs-hit[data-active="true"] .gs-mark{background:rgba(255,214,102,.42)}
.gs-empty-note{padding:10px 12px;font-size:11.5px;color:#e3b341;border-top:1px solid #34363b}
.gs-tabs{display:flex;gap:2px;padding:0 8px;border-bottom:1px solid #34363b}
.gs-tab{border:0;border-bottom:2px solid transparent;background:transparent;color:#8b9098;font-size:11.5px;
  padding:6px 10px 5px;cursor:pointer;font-family:inherit}
.gs-tab:hover{color:#c9cdd4}
.gs-tab[data-active="true"]{color:#e8eaed;border-bottom-color:#6ea8fe}
.gs-tab:focus-visible{outline:2px solid #6ea8fe;outline-offset:-2px}
.gs-section{padding:7px 12px 3px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#6f747c}
.gs-file{display:flex;gap:8px;align-items:baseline;width:100%;padding:4px 12px;border:0;background:transparent;
  cursor:pointer;text-align:left;color:#c9cdd4;font-size:12.5px}
.gs-file[data-active="true"]{background:#2e436e;color:#ffffff}
.gs-file:focus-visible{outline:2px solid #6ea8fe;outline-offset:-2px}
.gs-file-icon{flex:none;display:flex;align-self:center;color:#8b9098}
.gs-file-name{flex:none;max-width:56%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.gs-file-dir{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;
  color:#8b9098;font-size:11.5px}
.gs-file[data-active="true"] .gs-file-dir{color:#c3d3f0}
.gs-footer{display:flex;align-items:center;gap:12px;padding:6px 12px;border-top:1px solid #34363b;
  color:#8b9098;font-size:11.5px}
.gs-hints{display:flex;gap:10px;align-items:center;flex:none}
.gs-hint{display:inline-flex;gap:4px;align-items:center}
.gs-key{border:1px solid #3a3d42;border-radius:4px;padding:0 4px;font-size:10.5px;color:#9aa0a8}
.gs-spacer{flex:1}
.gs-root{max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.gs-stat{flex:none;font-variant-numeric:tabular-nums}
.gs-notice{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);max-width:80%;padding:6px 12px;
  border-radius:8px;background:#2b2d30;border:1px solid #43464c;color:#e8eaed;font-size:12px;
  box-shadow:0 8px 24px rgba(0,0,0,.45)}
.gs-busy{flex:none;font-size:11px;color:#8b9098}
`

    /**
     * Resolve a route against the page's base so a reverse-proxied or desktop
     * shell deployment keeps its path prefix.
     * @param {string} relative - route with optional query.
     * @returns {string} address to fetch.
     */
    function routePath(relative) {
      try {
        const url = new URL(relative, document.baseURI)
        return url.pathname + url.search
      } catch {
        return relative
      }
    }

    /**
     * Call one host route and unwrap its envelope.
     * @param {string} relative - route with query.
     * @param {AbortSignal} [signal] - cancellation.
     * @returns {Promise<object>} the route's value.
     */
    async function callHost(relative, signal) {
      const response = await fetch(routePath(relative), { credentials: 'same-origin', signal })
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`HTTP ${String(response.status)}`)
      }
      if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
        const message = payload && payload.error && payload.error.message
        throw new Error(message || `HTTP ${String(response.status)}`)
      }
      return payload.value
    }

    /**
     * Escape a literal query for use inside a regular expression.
     * @param {string} text - literal text.
     * @returns {string} escaped text.
     */
    function escapeRegExp(text) {
      return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    }

    /**
     * Split one line into plain and highlighted segments.
     * @param {string} text - the matched line.
     * @param {string} query - current query.
     * @param {boolean} caseSensitive - match case exactly.
     * @param {boolean} regex - query is a regular expression.
     * @returns {Array<string|object>} segments for React.
     */
    function highlight(text, query, caseSensitive, regex) {
      if (query === '') return [text]
      let pattern
      try {
        pattern = new RegExp(regex ? query : escapeRegExp(query), caseSensitive ? 'gu' : 'giu')
      } catch {
        return [text]
      }
      const nodes = []
      let last = 0
      let marks = 0
      let match
      while ((match = pattern.exec(text)) !== null) {
        if (match[0] === '') {
          pattern.lastIndex += 1
          continue
        }
        if (match.index > last) nodes.push(text.slice(last, match.index))
        nodes.push(h('mark', { className: 'gs-mark', key: `m${String(marks)}` }, match[0]))
        last = match.index + match[0].length
        marks += 1
        if (marks >= 24) break
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes.length === 0 ? [text] : nodes
    }

    /**
     * Last path segment.
     * @param {string} path - '/'-separated relative path.
     * @returns {string} the file name.
     */
    function basename(path) {
      const at = path.lastIndexOf('/')
      return at === -1 ? path : path.slice(at + 1)
    }

    /**
     * Directory part of a '/'-separated relative path.
     * @param {string} path - relative path.
     * @returns {string} directory or an empty string.
     */
    function dirname(path) {
      const at = path.lastIndexOf('/')
      return at === -1 ? '' : path.slice(0, at)
    }

    /**
     * Build the overlay component for one client context.
     * @param {object} ctx - client cordis context.
     * @returns {Function} React component.
     */
    function createOverlay(ctx) {
      /**
       * The Session the surrounding side card is showing, when that plugin is
       * installed. It is the target a hit opens in.
       * @returns {string|null} session id.
       */
      function currentSessionId() {
        try {
          const sidebar = ctx.get('betterSidebar')
          const snapshot = sidebar?.getSnapshot?.()
          const id = snapshot?.sessionId
          return typeof id === 'string' && id !== '' ? id : null
        } catch {
          return null
        }
      }

      /**
       * Copy text without failing the interaction.
       * @param {string} text - text to copy.
       * @returns {Promise<boolean>} whether the copy succeeded.
       */
      async function copyText(text) {
        try {
          await navigator.clipboard.writeText(text)
          return true
        } catch {
          return false
        }
      }

      return function GlobalSearchOverlay(props) {
        const t = typeof props.t === 'function' ? props.t : (key) => key
        const [open, setOpen] = useState(false)
        const [query, setQuery] = useState('')
        const [mode, setMode] = useState('all')
        const [caseSensitive, setCaseSensitive] = useState(false)
        const [regex, setRegex] = useState(false)
        const [phase, setPhase] = useState('idle')
        const [data, setData] = useState(null)
        const [error, setError] = useState('')
        const [active, setActive] = useState(0)
        const [notice, setNotice] = useState('')
        const inputRef = useRef(null)
        const listRef = useRef(null)
        const abortRef = useRef(null)
        const noticeTimer = useRef(undefined)
        const closeTimer = useRef(undefined)

        const close = useCallback(() => {
          if (closeTimer.current !== undefined) {
            window.clearTimeout(closeTimer.current)
            closeTimer.current = undefined
          }
          abortRef.current?.abort()
          abortRef.current = undefined
          setOpen(false)
        }, [])

        /** Close after a short beat, so a fallback notice stays readable. */
        const scheduleClose = useCallback((delay = 1400) => {
          if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current)
          closeTimer.current = window.setTimeout(() => {
            closeTimer.current = undefined
            close()
          }, delay)
        }, [close])

        const showNotice = useCallback((text) => {
          setNotice(text)
          if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current)
          noticeTimer.current = window.setTimeout(() => { setNotice('') }, 3600)
        }, [])

        // Double-tap Shift: two clean presses (no other key in between) inside
        // the window. `primed` is cleared by any other key or pointer input, so
        // typing SHIFT+a, holding Shift, or a dead key never opens the panel.
        useEffect(() => {
          let primed = false
          let last = 0
          const onKeyDown = (event) => {
            if (event.isComposing === true) return
            if (event.key === 'Shift') {
              if (event.repeat === true) return
              if (event.ctrlKey || event.altKey || event.metaKey) {
                primed = false
                return
              }
              const now = Date.now()
              if (primed && now - last <= DOUBLE_TAP_MS) {
                primed = false
                setOpen(true)
                return
              }
              primed = true
              last = now
              return
            }
            primed = false
          }
          const reset = () => { primed = false }
          window.addEventListener('keydown', onKeyDown, true)
          window.addEventListener('pointerdown', reset, true)
          window.addEventListener('blur', reset)
          return () => {
            window.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('pointerdown', reset, true)
            window.removeEventListener('blur', reset)
          }
        }, [])

        // Escape closes from anywhere while the panel is open.
        useEffect(() => {
          if (!open) return undefined
          const onKey = (event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            close()
          }
          window.addEventListener('keydown', onKey, true)
          return () => window.removeEventListener('keydown', onKey, true)
        }, [open, close])

        // Focus the field whenever the panel opens and select the previous
        // query, so typing or pasting replaces it immediately.
        useEffect(() => {
          if (!open) return
          const frame = window.requestAnimationFrame(() => {
            const input = inputRef.current
            if (input === null) return
            input.focus()
            try {
              input.select()
            } catch {
              /* not a text field after a re-render: focus alone is enough */
            }
          })
          return () => window.cancelAnimationFrame(frame)
        }, [open])

        // Debounced search; aborts the previous request on every keystroke.
        useEffect(() => {
          if (!open) return undefined
          if (query.trim() === '') {
            abortRef.current?.abort()
            abortRef.current = undefined
            setPhase('idle')
            setData(null)
            setError('')
            return undefined
          }
          const timer = window.setTimeout(() => {
            abortRef.current?.abort()
            const controller = new AbortController()
            abortRef.current = controller
            const params = new URLSearchParams({
              q: query,
              mode,
              case: caseSensitive ? '1' : '0',
              regex: regex ? '1' : '0',
              limit: String(RESULT_LIMIT),
            })
            const sessionId = currentSessionId()
            if (sessionId !== null) params.set('sessionId', sessionId)
            setPhase('loading')
            setError('')
            callHost(`${SEARCH_ROUTE}?${params.toString()}`, controller.signal)
              .then((value) => {
                if (controller.signal.aborted) return
                setData(value)
                setActive(0)
                setPhase('ready')
              })
              .catch((reason) => {
                if (controller.signal.aborted || reason?.name === 'AbortError') return
                setError(String((reason && reason.message) || reason))
                setPhase('error')
              })
          }, DEBOUNCE_MS)
          return () => {
            window.clearTimeout(timer)
            // A newer query (or a close) owns the wire: drop this request so a
            // slow answer can never repaint the list with the previous query.
            abortRef.current?.abort()
            abortRef.current = undefined
          }
        }, [open, query, caseSensitive, regex, mode])

        // Keep the selected row in view.
        useEffect(() => {
          if (!open) return
          const host = listRef.current
          if (host === null) return
          const row = host.querySelector(`[data-index="${String(active)}"]`)
          if (row !== null && typeof row.scrollIntoView === 'function') {
            row.scrollIntoView({ block: 'nearest' })
          }
        }, [open, active, data])

        useEffect(() => () => {
          if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current)
          if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current)
          abortRef.current?.abort()
        }, [])

        const fileRows = mode === 'text' ? [] : (data?.files ?? [])
        const matches = mode === 'files' ? [] : (data?.matches ?? [])
        const rows = useMemo(() => {
          const out = []
          for (let index = 0; index < fileRows.length; index += 1) {
            out.push({ kind: 'file', index, file: fileRows[index] })
          }
          for (let index = 0; index < matches.length; index += 1) {
            out.push({ kind: 'text', index: fileRows.length + index, hit: matches[index] })
          }
          return out
        }, [data, mode])
        const groups = useMemo(() => {
          const out = []
          let index = 0
          let current = null
          for (const hit of matches) {
            if (current === null || current.path !== hit.path) {
              current = { path: hit.path, start: index, hits: [] }
              out.push(current)
            }
            current.hits.push({ ...hit, index: fileRows.length + index })
            index += 1
          }
          return out
        }, [data, mode])

        /**
         * Open one hit: the side card editor when available, otherwise copy the
         * `path:line` reference so the result is still useful.
         * @param {{path: string, line: number}} hit - selected match.
         */
        const openHit = useCallback((hit) => {
          const root = typeof data?.root === 'string' ? data.root : ''
          if (root === '') {
            close()
            return
          }
          const absolute = `${root.replace(/[\\/]+$/u, '')}/${hit.path}`
          const sidebar = ctx.get('betterSidebar')
          const supportsOpen = sidebar !== undefined
            && typeof sidebar.openFile === 'function'
            && (Array.isArray(sidebar.features) ? sidebar.features.includes('openFile') : true)
          const sessionId = currentSessionId() ?? (typeof data?.sessionId === 'string' ? data.sessionId : null)
          if (supportsOpen && sessionId !== null) {
            try {
              sidebar.openFile({ sessionId, cwd: root }, absolute, basename(hit.path), { line: hit.line })
              // Opening is the activation: the panel must not stay on top of the
              // editor it just revealed.
              close()
              return
            } catch (reason) {
              showNotice(t('notice.openFailed', { message: String((reason && reason.message) || reason) }))
            }
          }
          const target = `${hit.path}:${String(hit.line)}`
          void copyText(target).then((copied) => {
            showNotice(t(copied ? 'notice.noEditor' : 'notice.copyFailed', { target }))
            scheduleClose()
          })
        }, [data, close, scheduleClose, showNotice, t])

        /** Open one file-name hit (no line) and close the panel. */
        const openFileRow = useCallback((file) => {
          const root = typeof data?.root === 'string' ? data.root : ''
          if (root === '') {
            close()
            return
          }
          const absolute = `${root.replace(/[\\/]+$/u, '')}/${file.path}`
          const sidebar = ctx.get('betterSidebar')
          const supportsOpen = sidebar !== undefined
            && typeof sidebar.openFile === 'function'
            && (Array.isArray(sidebar.features) ? sidebar.features.includes('openFile') : true)
          const sessionId = currentSessionId() ?? (typeof data?.sessionId === 'string' ? data.sessionId : null)
          if (supportsOpen && sessionId !== null) {
            try {
              sidebar.openFile({ sessionId, cwd: root }, absolute, file.name)
              close()
              return
            } catch (reason) {
              showNotice(t('notice.openFailed', { message: String((reason && reason.message) || reason) }))
            }
          }
          void copyText(file.path).then((copied) => {
            showNotice(t(copied ? 'notice.noEditor' : 'notice.copyFailed', { target: file.path }))
            scheduleClose()
          })
        }, [data, close, scheduleClose, showNotice, t])

        const move = useCallback((delta) => {
          setActive((current) => {
            const size = rows.length
            if (size === 0) return 0
            return (current + delta + size) % size
          })
        }, [rows.length])

        if (!open) return null

        const onPanelKeyDown = (event) => {
          // Only the field owns list navigation; a focused toggle button keeps
          // its own Enter/Space activation.
          if (event.target !== inputRef.current) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            move(event.key === 'ArrowDown' ? 1 : -1)
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            const row = rows[active]
            if (row === undefined) return
            if (row.kind === 'file') openFileRow(row.file)
            else openHit(row.hit)
            return
          }
          if (event.key === 'Tab') {
            event.preventDefault()
            inputRef.current?.focus()
          }
        }

        const summary = data === null
          ? ''
          : mode === 'files'
            ? t('footer.filesOnly', { files: String(data.fileCount) })
            : mode === 'text'
              ? t('footer.textOnly', { matches: String(data.matchCount), textFiles: String(data.textFileCount) })
              : t('footer.all', { files: String(data.fileCount), matches: String(data.matchCount) })
        const engine = data?.engine === 'walk' ? t('engine.walk') : t('engine.rg')

        let body
        if (phase === 'idle') {
          body = h('div', { className: 'gs-idle' },
            h('div', { className: 'gs-idle-title' }, t('state.idle.title')),
            h('div', { className: 'gs-idle-hint' }, t('state.idle.hint')))
        } else if (phase === 'error') {
          body = h('div', { className: 'gs-error', role: 'alert' }, t('state.error', { message: error }))
        } else if (rows.length === 0 && phase === 'ready') {
          body = h('div', { className: 'gs-empty' },
            h('div', null, mode === 'files' ? t('state.emptyFiles') : t('state.empty')),
            h('div', { className: 'gs-empty-hint' },
              mode === 'files' ? t('state.emptyFilesHint') : t('state.emptyHint')))
        } else {
          body = h('div', { className: 'gs-list', ref: listRef, role: 'listbox', 'aria-label': t('dialog.title') },
            fileRows.length > 0
              ? h('div', { className: 'gs-section', key: 'section:files' }, t('section.files'))
              : null,
            fileRows.map((file, index) => h('button', {
              key: `file:${file.path}`,
              type: 'button',
              role: 'option',
              'aria-selected': index === active,
              className: 'gs-file',
              'data-active': index === active ? 'true' : undefined,
              'data-index': String(index),
              title: file.path,
              onMouseMove: () => { if (active !== index) setActive(index) },
              onClick: () => openFileRow(file),
            },
              h('span', { className: 'gs-file-icon' }, FileIcon()),
              h('span', { className: 'gs-file-name' }, file.name),
              file.dir === '' ? null : h('span', { className: 'gs-file-dir' }, file.dir))),
            matches.length > 0
              ? h('div', { className: 'gs-section', key: 'section:text' }, t('section.text'))
              : null,
            groups.map((group) => h('div', { className: 'gs-group', key: group.path },
              h('div', { className: 'gs-group-head' },
                h('span', { className: 'gs-group-name', title: group.path }, basename(group.path)),
                dirname(group.path) === ''
                  ? null
                  : h('span', { className: 'gs-group-dir' }, dirname(group.path)),
                h('span', { className: 'gs-group-count' }, t('file.hits', { count: String(group.hits.length) }))),
              group.hits.map((hit) => h('button', {
                key: `${hit.path}:${String(hit.line)}:${String(hit.column)}`,
                type: 'button',
                role: 'option',
                'aria-selected': hit.index === active,
                className: 'gs-hit',
                'data-active': hit.index === active ? 'true' : undefined,
                'data-index': String(hit.index),
                title: `${hit.path}:${String(hit.line)}`,
                onMouseMove: () => { if (active !== hit.index) setActive(hit.index) },
                onClick: () => openHit(hit),
              },
                h('span', { className: 'gs-line' }, String(hit.line)),
                h('span', { className: 'gs-text' }, highlight(hit.text, query, caseSensitive, regex)))))))
        }

        return h('div', { className: 'gs-layer' },
          h('style', null, CSS),
          h('div', { className: 'gs-backdrop', onMouseDown: () => close() }),
          h('div', {
            className: 'gs-panel',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('dialog.title'),
            onKeyDown: onPanelKeyDown,
          },
            h('div', { className: 'gs-searchrow' },
              h('span', { className: 'gs-searchicon' }, SearchIcon()),
              h('input', {
                ref: inputRef,
                className: 'gs-input',
                type: 'text',
                spellCheck: false,
                autoComplete: 'off',
                placeholder: t('search.placeholder'),
                'aria-label': t('dialog.title'),
                value: query,
                onChange: (event) => { setQuery(event.target.value) },
              }),
              query === ''
                ? null
                : h('button', {
                    type: 'button',
                    className: 'gs-toggle',
                    title: t('search.clear'),
                    'aria-label': t('search.clear'),
                    onClick: () => { setQuery(''); inputRef.current?.focus() },
                  }, '×'),
              h('button', {
                type: 'button',
                className: 'gs-toggle',
                title: t('search.case'),
                'aria-label': t('search.case'),
                'aria-pressed': caseSensitive,
                'data-active': caseSensitive ? 'true' : undefined,
                onClick: () => { setCaseSensitive((value) => !value); inputRef.current?.focus() },
              }, 'Aa'),
              h('button', {
                type: 'button',
                className: 'gs-toggle',
                title: t('search.regex'),
                'aria-label': t('search.regex'),
                'aria-pressed': regex,
                'data-active': regex ? 'true' : undefined,
                onClick: () => { setRegex((value) => !value); inputRef.current?.focus() },
              }, '.*'),
              phase === 'loading' ? h('span', { className: 'gs-busy' }, '…') : null,
              h('span', { className: 'gs-closekbd' }, 'Esc')),
            h('div', { className: 'gs-tabs', role: 'tablist', 'aria-label': t('role.tabs') },
              ...[['all', t('tab.all')], ['files', t('tab.files')], ['text', t('tab.text')]].map(([value, label]) => h('button', {
                key: value,
                type: 'button',
                role: 'tab',
                'aria-selected': mode === value,
                'data-active': mode === value ? 'true' : undefined,
                className: 'gs-tab',
                onClick: () => { setMode(value); inputRef.current?.focus() },
              }, label))),
            h('div', { className: 'gs-body' }, body,
              data?.truncated === true && rows.length > 0
                ? h('div', { className: 'gs-empty-note' }, t('footer.truncated'))
                : null),
            h('div', { className: 'gs-footer' },
              h('span', { className: 'gs-hints' },
                h('span', { className: 'gs-hint' }, h('span', { className: 'gs-key' }, '↑'), h('span', { className: 'gs-key' }, '↓'), t('footer.navigate')),
                h('span', { className: 'gs-hint' }, h('span', { className: 'gs-key' }, 'Enter'), t('footer.open')),
                h('span', { className: 'gs-hint' }, h('span', { className: 'gs-key' }, 'Esc'), t('footer.close'))),
              h('span', { className: 'gs-spacer' }),
              data === null ? null : h('span', { className: 'gs-root', title: data.root }, data.root),
              data === null
                ? null
                : h('span', { className: 'gs-stat' }, summary),
              data === null
                ? null
                : h('span', { className: 'gs-stat' }, t('footer.elapsed', { ms: String(data.elapsedMs), engine }))),
            notice === '' ? null : h('div', { className: 'gs-notice', role: 'status' }, notice)))
      }
    }

    /**
     * The document glyph used for file-name hits.
     * @returns {object} React element.
     */
    function FileIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true, focusable: false },
        h('path', {
          d: 'M4 1.5h5l3 3V14a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 14V2a.5.5 0 0 1 .5-.5z',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M9 1.7V4.5h2.8',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round',
        }))
    }

    /**
     * The magnifier glyph used in the search row.
     * @returns {object} React element.
     */
    function SearchIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true, focusable: false },
        h('circle', { cx: 7, cy: 7, r: 4.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M10.6 10.6 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-simple-search: dictionaries')
        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'simple-search',
          order: 60,
          locale: NS,
        }, createOverlay(ctx))), 'dsh-simple-search: overlay')
      },
    }
  },
})
