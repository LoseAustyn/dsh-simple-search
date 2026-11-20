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
    const CONVERSATION_ROUTE = '/dsh-simple-search/conversation'
    /** Search scopes shown above the file-search tabs. */
    const SCOPES = [
      ['workspace', 'scope.workspace'],
      ['sessions', 'scope.sessions'],
      ['conversation', 'scope.conversation'],
    ]
    /** Maximum Session-title rows rendered. */
    const SESSION_ROW_LIMIT = 60
    /** Matches requested per current-conversation query (the host caps it at 200). */
    const CONVERSATION_LIMIT = 120
    /** A second Shift press within this window counts as a double tap. */
    const DOUBLE_TAP_MS = 400
    /** Typing debounce before a query reaches the host. */
    const DEBOUNCE_MS = 170
    /** Results requested per query (the host caps it at 400). */
    const RESULT_LIMIT = 300
    /** Browser-local preference key for the panel's appearance. */
    const APPEARANCE_KEY = 'dsh-simple-search:appearance'
    /** `follow` tracks the DSH theme; `light`/`dark` pin one palette. */
    const APPEARANCE_OPTIONS = ['light', 'dark', 'follow']
    const APPEARANCE_DEFAULT = 'follow'

    const ZH = {
      'meta.title': '简单搜索',
      'meta.description': '双击 Shift 打开，按内容搜索工作区里的所有文件。',
      'dialog.title': '简单搜索',
      'search.placeholder': '搜索文本片段…',
      'search.placeholder.sessions': '搜索会话标题…',
      'search.placeholder.conversation': '搜索当前会话内容…',
      'scope.workspace': '工作区文件',
      'scope.sessions': '会话标题',
      'scope.conversation': '本会话',
      'role.scopes': '搜索范围',
      'state.sessionsIdleTitle': '按标题搜索所有工作区的会话',
      'state.sessionsIdleHint': '匹配会话标题、工作区名或会话 ID · 输入即搜',
      'state.sessionsEmpty': '没有匹配的会话',
      'state.sessionsEmptyHint': '试试标题的一部分，或工作区目录名',
      'state.sessionsUnavailable': '会话列表尚未就绪',
      'state.sessionsUnavailableHint': '打开任意会话后再试',
      'state.conversationIdleTitle': '搜索当前会话的消息',
      'state.conversationIdleHint': '只搜双方可见的文字，跳过思考、工具调用与系统提示',
      'state.conversationEmpty': '当前会话里没有匹配的消息',
      'state.conversationEmptyHint': '换个关键词，或切换 Aa / .* 的匹配方式',
      'state.noSession': '当前没有打开的会话',
      'state.noSessionHint': '先在侧栏打开一个会话，再搜索它的内容',
      'state.conversationUnavailable': '会话内容不可用',
      'footer.sessions': '{count} 个会话',
      'footer.conversation': '{matches} 处匹配 · {messages} 条消息',
      'session.workspaceUnknown': '未分组',
      'message.role.user': '你',
      'message.role.assistant': '助手',
      'message.hits': '{count} 处',
      'message.truncated': '内容已截断',
      'notice.sessionOpenFailed': '打开会话失败：{message}',
      'notice.sessionCopied': '已复制会话 ID：{id}',
      'notice.messageCopied': '已复制消息内容',
      'notice.messageCopiedFallback': '未找到聊天位置，已复制消息内容',
      'message.reveal': '定位到这条消息',
      'notice.copyMessageFailed': '复制消息失败',
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
      'footer.openSession': 'Enter 打开会话',
      'footer.copy': 'Enter 定位',
      'footer.close': 'Esc 关闭',
      'footer.truncated': '结果已截断',
      'footer.elapsed': '{ms} ms · {engine}',
      'engine.rg': 'ripgrep',
      'engine.walk': '内置遍历',
      'engine.conversation': '会话日志',
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
      'appearance.title': '外观',
      'appearance.description': '搜索面板的配色方案。',
      'appearance.light': '浅色',
      'appearance.dark': '深色',
      'appearance.follow': '跟随 DSH',
      'appearance.effective': '当前 DSH 主题：{scheme}',
      'appearance.hint': '「跟随 DSH」会随 DSH 的浅色/深色主题自动切换；选择保存在本机浏览器中。',
    }

    const EN = {
      'meta.title': 'Simple Search',
      'meta.description': 'Press Shift twice to search every file in the workspace by content.',
      'dialog.title': 'Simple Search',
      'search.placeholder': 'Search text…',
      'search.placeholder.sessions': 'Search session titles…',
      'search.placeholder.conversation': 'Search this chat…',
      'scope.workspace': 'Workspace',
      'scope.sessions': 'Sessions',
      'scope.conversation': 'This chat',
      'role.scopes': 'Search scope',
      'state.sessionsIdleTitle': 'Search session titles across workspaces',
      'state.sessionsIdleHint': 'Matches title, workspace name, or session id · results appear as you type',
      'state.sessionsEmpty': 'No matching sessions',
      'state.sessionsEmptyHint': 'Try part of a title, or a workspace directory name',
      'state.sessionsUnavailable': 'The session list is not ready yet',
      'state.sessionsUnavailableHint': 'Open a session, then try again',
      'state.conversationIdleTitle': 'Search messages in this chat',
      'state.conversationIdleHint': 'Searches visible text only; thinking, tool calls, and system prompts are skipped',
      'state.conversationEmpty': 'No matching messages in this chat',
      'state.conversationEmptyHint': 'Try another query, or toggle Aa / .*',
      'state.noSession': 'No chat is open',
      'state.noSessionHint': 'Open a chat in the sidebar, then search its content',
      'state.conversationUnavailable': 'Chat content is unavailable',
      'footer.sessions': '{count} sessions',
      'footer.conversation': '{matches} matches · {messages} messages',
      'session.workspaceUnknown': 'Ungrouped',
      'message.role.user': 'You',
      'message.role.assistant': 'Assistant',
      'message.hits': '{count} hits',
      'message.truncated': 'text truncated',
      'notice.sessionOpenFailed': 'Could not open the session: {message}',
      'notice.sessionCopied': 'Copied session id: {id}',
      'notice.messageCopied': 'Copied the message',
      'notice.messageCopiedFallback': 'Chat position not found; copied the message',
      'message.reveal': 'Jump to this message',
      'notice.copyMessageFailed': 'Could not copy the message',
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
      'footer.openSession': 'Enter open chat',
      'footer.copy': 'Enter jump',
      'footer.close': 'Esc close',
      'footer.truncated': 'Results truncated',
      'footer.elapsed': '{ms} ms · {engine}',
      'engine.rg': 'ripgrep',
      'engine.walk': 'built-in walk',
      'engine.conversation': 'session log',
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
      'appearance.title': 'Appearance',
      'appearance.description': 'Color scheme of the search panel.',
      'appearance.light': 'Light',
      'appearance.dark': 'Dark',
      'appearance.follow': 'Follow DSH',
      'appearance.effective': 'DSH theme now: {scheme}',
      'appearance.hint': '“Follow DSH” tracks the DSH light/dark theme automatically; the choice is saved in this browser.',
    }

    const CSS = `
.gs-layer{position:fixed;inset:0;z-index:60;display:flex;align-items:flex-start;justify-content:center;pointer-events:auto}
.gs-layer[data-gs-scheme="dark"]{color-scheme:dark;
  --gs-backdrop:rgba(0,0,0,.46);
  --gs-panel-bg:#1e1f22;--gs-panel-fg:#dfe1e5;--gs-panel-border:#3a3d42;--gs-panel-shadow:0 20px 56px rgba(0,0,0,.55);
  --gs-divider:#34363b;--gs-icon:#8b9098;
  --gs-input-fg:#e8eaed;--gs-caret:#6ea8fe;--gs-placeholder:#7d828a;
  --gs-toggle-fg:#9aa0a8;--gs-toggle-hover-bg:#2b2d30;--gs-toggle-hover-fg:#c9cdd4;
  --gs-toggle-active-fg:#8fb8ff;--gs-toggle-active-border:#3f4d66;--gs-toggle-active-bg:#26303f;
  --gs-focus:#6ea8fe;--gs-kbd-fg:#8b9098;--gs-kbd-border:#3a3d42;--gs-scrollbar:#3a3d42;
  --gs-muted:#8b9098;--gs-idle-title:#dfe1e5;--gs-hint:#7d828a;--gs-error:#ff7b72;
  --gs-group-head-bg:#232528;--gs-group-head-border:#303237;--gs-group-name:#e8eaed;
  --gs-row-fg:#c9cdd4;--gs-row-active-bg:#2e436e;--gs-row-active-fg:#ffffff;
  --gs-line-fg:#6f747c;--gs-line-active-fg:#c3d3f0;
  --gs-mark-bg:rgba(255,199,88,.30);--gs-mark-active-bg:rgba(255,214,102,.42);
  --gs-note-fg:#e3b341;--gs-section-fg:#6f747c;
  --gs-tab-fg:#8b9098;--gs-tab-hover-fg:#c9cdd4;--gs-tab-active-fg:#e8eaed;--gs-accent:#6ea8fe;
  --gs-key-fg:#9aa0a8;
  --gs-notice-bg:#2b2d30;--gs-notice-border:#43464c;--gs-notice-fg:#e8eaed;--gs-notice-shadow:0 8px 24px rgba(0,0,0,.45)}
.gs-layer[data-gs-scheme="light"]{color-scheme:light;
  --gs-backdrop:rgba(15,23,42,.28);
  --gs-panel-bg:#ffffff;--gs-panel-fg:#1f2329;--gs-panel-border:#d5d8de;--gs-panel-shadow:0 20px 56px rgba(15,23,42,.20);
  --gs-divider:#e6e8eb;--gs-icon:#6b7280;
  --gs-input-fg:#111827;--gs-caret:#2563eb;--gs-placeholder:#9aa1ab;
  --gs-toggle-fg:#5f6672;--gs-toggle-hover-bg:#f1f3f5;--gs-toggle-hover-fg:#1f2329;
  --gs-toggle-active-fg:#2563eb;--gs-toggle-active-border:#bcd0f7;--gs-toggle-active-bg:#eaf0fe;
  --gs-focus:#2563eb;--gs-kbd-fg:#6b7280;--gs-kbd-border:#d5d8de;--gs-scrollbar:#cfd4da;
  --gs-muted:#6b7280;--gs-idle-title:#1f2329;--gs-hint:#6b7280;--gs-error:#d1242f;
  --gs-group-head-bg:#f7f8fa;--gs-group-head-border:#eceef1;--gs-group-name:#1f2329;
  --gs-row-fg:#3d434d;--gs-row-active-bg:#dbe7ff;--gs-row-active-fg:#111827;
  --gs-line-fg:#9aa1ab;--gs-line-active-fg:#4b5b78;
  --gs-mark-bg:rgba(245,180,0,.28);--gs-mark-active-bg:rgba(245,180,0,.46);
  --gs-note-fg:#9a6700;--gs-section-fg:#9aa1ab;
  --gs-tab-fg:#6b7280;--gs-tab-hover-fg:#1f2329;--gs-tab-active-fg:#1f2329;--gs-accent:#2563eb;
  --gs-key-fg:#5f6672;
  --gs-notice-bg:#ffffff;--gs-notice-border:#d5d8de;--gs-notice-fg:#1f2329;--gs-notice-shadow:0 8px 24px rgba(15,23,42,.18)}
.gs-backdrop{position:absolute;inset:0;background:var(--gs-backdrop)}
.gs-panel{position:relative;margin-top:8vh;width:min(880px,92vw);max-height:74vh;display:flex;flex-direction:column;
  background:var(--gs-panel-bg);color:var(--gs-panel-fg);border:1px solid var(--gs-panel-border);border-radius:12px;overflow:hidden;
  box-shadow:var(--gs-panel-shadow);font-size:13px}
.gs-searchrow{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--gs-divider)}
.gs-searchicon{flex:none;display:flex;color:var(--gs-icon)}
.gs-input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--gs-input-fg);caret-color:var(--gs-caret);
  font-size:15px;line-height:22px;padding:4px 0;font-family:inherit}
.gs-input::placeholder{color:var(--gs-placeholder)}
.gs-toggle{flex:none;min-width:28px;height:26px;padding:0 6px;border:1px solid transparent;border-radius:6px;
  background:transparent;color:var(--gs-toggle-fg);font-size:11.5px;cursor:pointer;font-family:inherit}
.gs-toggle:hover{background:var(--gs-toggle-hover-bg);color:var(--gs-toggle-hover-fg)}
.gs-toggle[data-active="true"]{color:var(--gs-toggle-active-fg);border-color:var(--gs-toggle-active-border);background:var(--gs-toggle-active-bg)}
.gs-toggle:focus-visible{outline:2px solid var(--gs-focus);outline-offset:1px}
.gs-closekbd{flex:none;color:var(--gs-kbd-fg);font-size:11px;border:1px solid var(--gs-kbd-border);border-radius:4px;padding:1px 5px;margin-left:2px}
.gs-body{flex:1;min-height:120px;overflow:auto;overscroll-behavior:contain;scrollbar-color:var(--gs-scrollbar) transparent}
.gs-body::-webkit-scrollbar{width:10px;height:10px}
.gs-body::-webkit-scrollbar-thumb{background:var(--gs-scrollbar);border-radius:6px}
.gs-body::-webkit-scrollbar-track{background:transparent}
.gs-idle,.gs-empty,.gs-error{display:flex;flex-direction:column;gap:6px;align-items:center;justify-content:center;
  padding:36px 24px;text-align:center;color:var(--gs-muted)}
.gs-idle-title{font-size:13.5px;color:var(--gs-idle-title)}
.gs-idle-hint,.gs-empty-hint{font-size:12px;color:var(--gs-hint)}
.gs-error{color:var(--gs-error);word-break:break-word}
.gs-group{display:block}
.gs-group-head{position:sticky;top:0;z-index:1;display:flex;align-items:baseline;gap:8px;padding:5px 12px;
  background:var(--gs-group-head-bg);border-bottom:1px solid var(--gs-group-head-border)}
.gs-group-name{font-size:12px;font-weight:600;color:var(--gs-group-name);flex:none;max-width:45%;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-group-dir{font-size:11.5px;color:var(--gs-muted);flex:1;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.gs-group-count{flex:none;font-size:11px;color:var(--gs-muted)}
.gs-hit{display:flex;gap:10px;width:100%;padding:3px 12px;border:0;background:transparent;cursor:pointer;
  text-align:left;color:var(--gs-row-fg);font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);
  font-size:12.5px;line-height:19px}
.gs-hit[data-active="true"]{background:var(--gs-row-active-bg);color:var(--gs-row-active-fg)}
.gs-hit:focus-visible{outline:2px solid var(--gs-focus);outline-offset:-2px}
.gs-line{flex:none;width:52px;text-align:right;color:var(--gs-line-fg);font-variant-numeric:tabular-nums;user-select:none}
.gs-hit[data-active="true"] .gs-line{color:var(--gs-line-active-fg)}
.gs-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:pre}
.gs-mark{background:var(--gs-mark-bg);color:inherit;border-radius:2px}
.gs-hit[data-active="true"] .gs-mark{background:var(--gs-mark-active-bg)}
.gs-empty-note{padding:10px 12px;font-size:11.5px;color:var(--gs-note-fg);border-top:1px solid var(--gs-divider)}
.gs-tabs{display:flex;gap:2px;padding:0 8px;border-bottom:1px solid var(--gs-divider)}
.gs-scopes{display:flex;flex-wrap:wrap;gap:4px;padding:5px 10px;border-bottom:1px solid var(--gs-divider)}
.gs-scope{border:1px solid transparent;border-radius:6px;background:transparent;color:var(--gs-tab-fg);font-size:11.5px;
  line-height:21px;padding:1px 9px;cursor:pointer;font-family:inherit}
.gs-scope:hover{color:var(--gs-tab-hover-fg);background:var(--gs-toggle-hover-bg)}
.gs-scope[data-active="true"]{color:var(--gs-tab-active-fg);border-color:var(--gs-toggle-active-border);background:var(--gs-toggle-active-bg)}
.gs-scope:focus-visible{outline:2px solid var(--gs-focus);outline-offset:-2px}
.gs-session{display:flex;align-items:center;gap:10px;width:100%;padding:5px 12px;border:0;background:transparent;
  cursor:pointer;text-align:left;color:var(--gs-row-fg);font-family:inherit;font-size:13px;line-height:19px}
.gs-session[data-active="true"]{background:var(--gs-row-active-bg);color:var(--gs-row-active-fg)}
.gs-session:focus-visible{outline:2px solid var(--gs-focus);outline-offset:-2px}
.gs-session-icon{flex:none;display:flex;align-self:center;color:var(--gs-icon)}
.gs-session-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.gs-session-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-session-meta{font-size:11px;color:var(--gs-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-session[data-active="true"] .gs-session-meta{color:var(--gs-line-active-fg)}
.gs-session-time{flex:none;font-size:11px;color:var(--gs-muted);font-variant-numeric:tabular-nums}
.gs-session-running{flex:none;font-size:10px;color:var(--gs-accent)}
.gs-message{display:flex;gap:10px;width:100%;padding:5px 12px;border:0;background:transparent;cursor:pointer;
  text-align:left;color:var(--gs-row-fg);font-family:inherit;font-size:12.5px;line-height:19px}
.gs-message[data-active="true"]{background:var(--gs-row-active-bg);color:var(--gs-row-active-fg)}
.gs-message:focus-visible{outline:2px solid var(--gs-focus);outline-offset:-2px}
.gs-message-role{flex:none;align-self:flex-start;min-width:34px;text-align:center;font-size:10.5px;line-height:17px;
  border:1px solid var(--gs-kbd-border);border-radius:4px;color:var(--gs-muted);padding:0 4px;margin-top:1px}
.gs-message[data-active="true"] .gs-message-role{color:var(--gs-row-active-fg);border-color:var(--gs-line-active-fg)}
.gs-message-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.gs-message-text{overflow:hidden;text-overflow:ellipsis;white-space:pre;
  font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px}
.gs-message-meta{font-size:10.5px;color:var(--gs-muted)}
.gs-message[data-active="true"] .gs-message-meta{color:var(--gs-line-active-fg)}
.gs-tab{border:0;border-bottom:2px solid transparent;background:transparent;color:var(--gs-tab-fg);font-size:11.5px;
  padding:6px 10px 5px;cursor:pointer;font-family:inherit}
.gs-tab:hover{color:var(--gs-tab-hover-fg)}
.gs-tab[data-active="true"]{color:var(--gs-tab-active-fg);border-bottom-color:var(--gs-accent)}
.gs-tab:focus-visible{outline:2px solid var(--gs-focus);outline-offset:-2px}
.gs-section{padding:7px 12px 3px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--gs-section-fg)}
.gs-file{display:flex;gap:8px;align-items:baseline;width:100%;padding:4px 12px;border:0;background:transparent;
  cursor:pointer;text-align:left;color:var(--gs-row-fg);font-size:12.5px}
.gs-file[data-active="true"]{background:var(--gs-row-active-bg);color:var(--gs-row-active-fg)}
.gs-file:focus-visible{outline:2px solid var(--gs-focus);outline-offset:-2px}
.gs-file-icon{flex:none;display:flex;align-self:center;color:var(--gs-icon)}
.gs-file-name{flex:none;max-width:56%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.gs-file-dir{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;
  color:var(--gs-muted);font-size:11.5px}
.gs-file[data-active="true"] .gs-file-dir{color:var(--gs-line-active-fg)}
.gs-footer{display:flex;align-items:center;gap:12px;padding:6px 12px;border-top:1px solid var(--gs-divider);
  color:var(--gs-muted);font-size:11.5px}
.gs-hints{display:flex;gap:10px;align-items:center;flex:none}
.gs-hint{display:inline-flex;gap:4px;align-items:center}
.gs-key{border:1px solid var(--gs-kbd-border);border-radius:4px;padding:0 4px;font-size:10.5px;color:var(--gs-key-fg)}
.gs-spacer{flex:1}
.gs-root{max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.gs-stat{flex:none;font-variant-numeric:tabular-nums}
.gs-notice{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);max-width:80%;padding:6px 12px;
  border-radius:8px;background:var(--gs-notice-bg);border:1px solid var(--gs-notice-border);color:var(--gs-notice-fg);font-size:12px;
  box-shadow:var(--gs-notice-shadow)}
.gs-busy{flex:none;font-size:11px;color:var(--gs-muted)}

`

    /**
     * Styles of the appearance card on the bundle's Plugin Manager page. Host
     * tokens keep it native in either DSH theme instead of hard-coding colors.
     */
    const SETTINGS_CSS = `
.ss-appearance{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);
  border-radius:12px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-size:13px}
.ss-appearance-title{font-weight:600;font-size:13.5px}
.ss-appearance-desc{margin:0;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ss-appearance-options{display:inline-flex;flex-wrap:wrap;gap:2px;padding:2px;align-self:flex-start;max-width:100%;
  border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform)}
.ss-appearance-option{appearance:none;border:1px solid transparent;border-radius:6px;background:transparent;
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;padding:2px 12px;cursor:pointer}
.ss-appearance-option:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ss-appearance-option[data-active="true"]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);
  border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent);color:var(--dsw-alias-state-business-primary)}
.ss-appearance-option:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.ss-appearance-status,.ss-appearance-hint{margin:0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
`

    /**
     * Read the stored appearance preference, falling back to `follow`.
     * @returns {string} one of APPEARANCE_OPTIONS.
     */
    function readAppearancePreference() {
      try {
        const stored = window.localStorage.getItem(APPEARANCE_KEY)
        if (APPEARANCE_OPTIONS.includes(stored)) return stored
      } catch {
        // Blocked storage must not break the panel; the default still works.
      }
      return APPEARANCE_DEFAULT
    }

    /**
     * Effective DSH color scheme from the attribute the theme runtime toggles
     * on `body` (`body[data-ds-dark-theme]`).
     * @returns {'light'|'dark'} the current scheme.
     */
    function readDshScheme() {
      try {
        if (document.body?.hasAttribute?.('data-ds-dark-theme') === true) return 'dark'
      } catch {
        // No document body (unusual embedding): light is the safer default.
      }
      return 'light'
    }

    /**
     * Freeze the preference and the scheme it resolves to.
     * @param {string} preference - stored preference.
     * @param {'light'|'dark'} dshScheme - current DSH scheme.
     * @returns {{preference: string, dshScheme: 'light'|'dark', scheme: 'light'|'dark'}} snapshot.
     */
    function appearanceSnapshot(preference, dshScheme) {
      return { preference, dshScheme, scheme: preference === 'follow' ? dshScheme : preference }
    }

    /**
     * Appearance preference shared by the search panel and the bundle's
     * settings card, so a change on either side repaints the other.
     * @returns {object} snapshot source plus preference and theme mutators.
     */
    function createAppearance() {
      let preference = readAppearancePreference()
      let dshScheme = readDshScheme()
      let snapshot = appearanceSnapshot(preference, dshScheme)
      const listeners = new Set()
      /** Republish only when the resolved appearance actually moved. */
      const publish = () => {
        const next = appearanceSnapshot(preference, dshScheme)
        if (next.preference === snapshot.preference && next.scheme === snapshot.scheme) return
        snapshot = next
        for (const listener of [...listeners]) listener()
      }
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        /** Store one preference; every subscriber repaints. */
        setPreference(value) {
          if (!APPEARANCE_OPTIONS.includes(value) || value === preference) return
          preference = value
          try {
            window.localStorage.setItem(APPEARANCE_KEY, value)
          } catch {
            // Keep the choice in memory when storage is unavailable.
          }
          publish()
        },
        /** Track the DSH theme; a repeat scheme changes nothing. */
        setDshScheme(value) {
          if (value !== 'light' && value !== 'dark') return
          if (value === dshScheme) return
          dshScheme = value
          publish()
        },
      }
    }

    const appearance = createAppearance()

    /**
     * Subscribe a component to the appearance preference.
     * @returns {{preference: string, dshScheme: 'light'|'dark', scheme: 'light'|'dark'}} current snapshot.
     */
    function useAppearance() {
      const [snapshot, setSnapshot] = useState(() => appearance.getSnapshot())
      useEffect(() => {
        setSnapshot(appearance.getSnapshot())
        return appearance.subscribe(() => { setSnapshot(appearance.getSnapshot()) })
      }, [])
      return snapshot
    }

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
     * Appearance card rendered on the bundle's page in Plugin Manager
     * (`plugins.bundle.config`, keyed by the bundle package name). The three
     * choices write the same browser-local preference the panel reads.
     * @param {object} props - slot props; `t` is bound by the registration.
     * @returns {object} React element.
     */
    function AppearanceSettings(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const state = useAppearance()
      const schemeLabel = t(state.dshScheme === 'dark' ? 'appearance.dark' : 'appearance.light')
      return h(React.Fragment, null,
        h('style', { key: 'appearance-styles' }, SETTINGS_CSS),
        h('section', { className: 'ss-appearance', key: 'appearance' },
          h('span', { className: 'ss-appearance-title' }, t('appearance.title')),
          h('p', { className: 'ss-appearance-desc' }, t('appearance.description')),
          h('div', { className: 'ss-appearance-options', role: 'group', 'aria-label': t('appearance.title') },
            ...APPEARANCE_OPTIONS.map((value) => h('button', {
              key: value,
              type: 'button',
              className: 'ss-appearance-option',
              'aria-pressed': state.preference === value,
              'data-active': state.preference === value ? 'true' : undefined,
              onClick: () => { appearance.setPreference(value) },
            }, t(`appearance.${value}`)))),
          state.preference === 'follow'
            ? h('p', { className: 'ss-appearance-status' }, t('appearance.effective', { scheme: schemeLabel }))
            : null,
          h('p', { className: 'ss-appearance-hint' }, t('appearance.hint'))))
    }

    /**
     * Display label for a Session's project: the directory basename.
     * @param {string|undefined} cwd - Session working directory.
     * @returns {string} label, or '' when the Session has no directory.
     */
    function workspaceLabelOf(cwd) {
      if (typeof cwd !== 'string' || cwd === '') return ''
      const trimmed = cwd.replace(/[\\/]+$/u, '')
      const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
      return at === -1 ? trimmed : trimmed.slice(at + 1)
    }

    /**
     * Local `YYYY-MM-DD HH:mm` stamp without locale-dependent formatting.
     * @param {number} time - epoch milliseconds.
     * @returns {string} stamp, or '' for a missing time.
     */
    function formatStamp(time) {
      if (!Number.isFinite(time) || time <= 0) return ''
      const date = new Date(time)
      const pad = (value) => String(value).padStart(2, '0')
      return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /**
     * Session-title rows matching a query, newest first.
     *
     * The Session list is the host's catalog spanning every workspace, so this
     * is the cross-workspace title search; it never needs a host route. Blank
     * placeholders and subagent children are excluded because they are neither
     * titled nor useful as destinations.
     * @param {object|null} list - `ctx.sessions.list` snapshot.
     * @param {string} query - caller text.
     * @param {number} limit - maximum rows.
     * @returns {Array<object>} matching rows.
     */
    function filterSessionRows(list, query, limit) {
      const needle = query.trim().toLowerCase()
      if (needle === '' || list === null || list === undefined || !Array.isArray(list.ids)) return []
      const rows = []
      for (const id of list.ids) {
        const summary = list.byId?.[id]
        if (summary === undefined || summary === null || summary.blank === true) continue
        // Align with the sidebar: subagent children are not navigation targets.
        if (summary.origin === 'subagent') continue
        const title = typeof summary.title === 'string' ? summary.title : ''
        const label = typeof summary.displayTitle === 'string' && summary.displayTitle !== ''
          ? summary.displayTitle
          : (title !== '' ? title : String(id))
        const workspace = workspaceLabelOf(summary.cwd)
        const matched = [title, label, workspace, String(id)]
          .some((value) => value !== '' && value.toLowerCase().includes(needle))
        if (!matched) continue
        rows.push({
          id: String(id),
          title: label,
          workspace,
          cwd: typeof summary.cwd === 'string' ? summary.cwd : '',
          updatedAt: Number(summary.updatedAt) || 0,
          running: summary.running === true,
        })
      }
      rows.sort((left, right) => right.updatedAt - left.updatedAt
        || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      return rows.slice(0, limit)
    }

    /**
     * The Session the main view is showing.
     *
     * Prefers the ui-session adapter's current binding, then the catalog's
     * `mainView` retention count, then better-sidebar's snapshot so the panel
     * still works in deployments without the first two services.
     * @param {object} ctx - client context.
     * @param {object|null} list - Session list snapshot.
     * @returns {string|null} Session id, or null.
     */
    function currentSessionId(ctx, list) {
      try {
        const binding = ctx.get('uiSession')?.adapter?.current?.getSnapshot?.()
        const key = binding?.key
        if (typeof key === 'string' && key !== '') return key
      } catch {
        // The adapter is deployment-specific; fall through to the catalog.
      }
      try {
        const summary = Object.values(list?.byId ?? {})
          .find((candidate) => (candidate?.retainedBy?.mainView ?? 0) > 0)
        if (summary !== undefined && typeof summary.id === 'string') return summary.id
      } catch {
        // A malformed catalog must not break the panel.
      }
      try {
        const id = ctx.get('betterSidebar')?.getSnapshot?.()?.sessionId
        if (typeof id === 'string' && id !== '') return id
      } catch {
        // Optional plugin; absence is normal.
      }
      return null
    }

    /**
     * Chat node keys are `${kind.length}:${kind}${id}` in DSH's Conversation
     * engine. Keeping the rule here (instead of the host) keeps the wire free of
     * a renderer detail while still addressing one exact message.
     * @param {string} kind - Conversation definition kind.
     * @param {string} id - definition-owned identity.
     * @returns {string} Chat flow anchor key.
     */
    function conversationContextKey(kind, id) {
      return `${String(kind.length)}:${kind}${id}`
    }

    /**
     * Chat anchor for one conversation hit.
     * @param {{role?: string, messageId?: string, turn?: number, step?: number}} hit - matched message.
     * @returns {string|null} anchor key, or null when the hit lacks an identity.
     */
    function conversationAnchorKey(hit) {
      if (hit === null || hit === undefined) return null
      if (hit.role === 'user' && typeof hit.messageId === 'string' && hit.messageId !== '') {
        return conversationContextKey('input-message', hit.messageId)
      }
      if (hit.role === 'assistant'
        && Number.isSafeInteger(hit.turn) && Number.isSafeInteger(hit.step)) {
        return conversationContextKey('assistant-step', `${String(hit.turn)}:${String(hit.step)}`)
      }
      return null
    }

    /**
     * Find the mounted Chat flow row for one anchor key inside the named
     * Session's conversation content.
     *
     * Assistant nodes split into `reasoning` and `response` flow rows that share
     * one `data-chat-node-key`; only the response row's `data-chat-anchor-key`
     * equals the node key, so matching node keys would select the hidden
     * reasoning row. Scoping by Session also prevents a sidebar chat from
     * matching the same key. Read-only: the panel never mutates another
     * plugin's DOM.
     * @param {string} anchorKey - Chat flow anchor key (node key for response rows).
     * @param {string} sessionId - Session whose conversation owns the row.
     * @returns {Element|null} the flow row.
     */
    function findChatAnchor(anchorKey, sessionId) {
      try {
        const container = document.querySelector(`[data-conversation-session="${sessionId}"]`)
        if (container === null || typeof container.querySelectorAll !== 'function') return null
        const rows = container.querySelectorAll('[data-chat-anchor-key]')
        for (const row of rows) {
          if (row.getAttribute('data-chat-anchor-key') !== anchorKey) continue
          // A future DSH may repeat the key on the reasoning row; never land there.
          if (row.getAttribute('data-chat-group-part') !== 'reasoning') return row
        }
        // Future anchor-key format: accept the response part of the matching
        // node, never the reasoning part.
        for (const row of container.querySelectorAll('[data-chat-node-key]')) {
          if (row.getAttribute('data-chat-node-key') !== anchorKey) continue
          const part = row.getAttribute('data-chat-group-part')
          if (part === null || part === undefined || part === 'response') return row
        }
      } catch {
        // No Chat anchor support in this deployment; the caller copies instead.
      }
      return null
    }

    /**
     * Wait one paint, with a timer fallback for environments without rAF.
     * @returns {Promise<void>} completion.
     */
    function nextFrame() {
      return new Promise((resolve) => {
        let settled = false
        const done = () => {
          if (settled) return
          settled = true
          resolve()
        }
        try {
          window.requestAnimationFrame(done)
        } catch {
          // Fall through to the timer.
        }
        try {
          window.setTimeout(done, 32)
        } catch {
          done()
        }
      })
    }

    /**
     * Wait briefly for a newly loaded history window to render.
     * @param {string} anchorKey - anchor to look for.
     * @param {number} deadline - epoch ms deadline.
     * @returns {Promise<Element|null>} the row.
     */
    async function waitForChatAnchor(anchorKey, sessionId, deadline) {
      for (;;) {
        const row = findChatAnchor(anchorKey, sessionId)
        if (row !== null) return row
        if (Date.now() >= deadline) return null
        await nextFrame()
      }
    }

    /**
     * Scroll one Chat node into view without touching its owner's state.
     * @param {Element} row - chat flow row.
     */
    function revealChatAnchor(row) {
      try {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' })
      } catch {
        try {
          row.scrollIntoView()
        } catch {
          // Scrolling support is optional; the panel still closes.
        }
      }
    }

    /**
     * Best-effort jump to one message in the mounted Chat view.
     *
     * DSH has no public "reveal message" API yet: the Chat target renders stable
     * `data-chat-anchor-key` rows, so this loads history through the hit's seq
     * when needed and scrolls that anchor into view. Any missing piece (a
     * different Conversation View, an older DSH, a detached Session) returns
     * false and the caller falls back to copying.
     * @param {object} ctx - client context.
     * @param {string|null} sessionId - current Session id.
     * @param {object} hit - conversation match.
     * @returns {Promise<boolean>} whether the message was revealed.
     */
    async function jumpToConversationHit(ctx, sessionId, hit) {
      const anchorKey = conversationAnchorKey(hit)
      if (anchorKey === null || sessionId === null) return false
      const immediate = findChatAnchor(anchorKey, sessionId)
      if (immediate !== null) {
        revealChatAnchor(immediate)
        return true
      }
      const sessions = ctx.get('sessions')
      if (sessions === undefined || sessions === null || typeof sessions.retain !== 'function') return false
      let reference
      try {
        reference = sessions.retain(sessionId, { source: 'simpleSearch' })
        await reference.ready
        const session = reference.binding?.session
        if (session === undefined || typeof session.loadThrough !== 'function') return false
        await session.loadThrough(hit.seq)
      } catch {
        return false
      } finally {
        try {
          reference?.release()
        } catch {
          // An already-released reference must not mask the jump result.
        }
      }
      const row = await waitForChatAnchor(anchorKey, sessionId, Date.now() + 1500)
      if (row === null) return false
      revealChatAnchor(row)
      return true
    }

    /**
     * Subscribe a component to the client Session catalog.
     * @param {object} ctx - client context.
     * @returns {object|null} the current `SessionListState` snapshot.
     */
    function useSessionList(ctx) {
      const sessions = ctx.get('sessions')
      const read = () => {
        try {
          return sessions?.list?.getSnapshot?.() ?? null
        } catch {
          return null
        }
      }
      const [state, setState] = useState(read)
      useEffect(() => {
        if (typeof sessions?.list?.subscribe !== 'function') return undefined
        setState(read())
        return sessions.list.subscribe(() => { setState(read()) })
      }, [])
      return state
    }

    /**
     * The chat-bubble glyph used for Session-title hits.
     * @returns {object} React element.
     */
    function SessionIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true, focusable: false },
        h('path', {
          d: 'M2.2 3.6h11.6v7.2H7l-3.1 2.4V10.8H2.2z',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round',
        }))
    }

    /**
     * Build the overlay component for one client context.
     * @param {object} ctx - client cordis context.
     * @returns {Function} React component.
     */
    function createOverlay(ctx) {
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
        const appearanceState = useAppearance()
        const [open, setOpen] = useState(false)
        const [scope, setScope] = useState('workspace')
        const [query, setQuery] = useState('')
        const [mode, setMode] = useState('all')
        const [caseSensitive, setCaseSensitive] = useState(false)
        const [regex, setRegex] = useState(false)
        const [phase, setPhase] = useState('idle')
        const [data, setData] = useState(null)
        const [error, setError] = useState('')
        const [active, setActive] = useState(0)
        const [notice, setNotice] = useState('')
        const sessionList = useSessionList(ctx)
        const [conversationPhase, setConversationPhase] = useState('idle')
        const [conversationData, setConversationData] = useState(null)
        const [conversationError, setConversationError] = useState('')
        const inputRef = useRef(null)
        const listRef = useRef(null)
        const abortRef = useRef(null)
        const conversationAbortRef = useRef(null)
        const noticeTimer = useRef(undefined)
        const closeTimer = useRef(undefined)
        /** The list effect must not restart on every catalog repaint. */
        const sessionListRef = useRef(sessionList)
        sessionListRef.current = sessionList
        const activeSessionId = currentSessionId(ctx, sessionList)

        const close = useCallback(() => {
          if (closeTimer.current !== undefined) {
            window.clearTimeout(closeTimer.current)
            closeTimer.current = undefined
          }
          abortRef.current?.abort()
          abortRef.current = undefined
          conversationAbortRef.current?.abort()
          conversationAbortRef.current = undefined
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

        // A fresh catalog keeps newly created or renamed Sessions searchable.
        // The subscription in useSessionList repaints when the list lands.
        useEffect(() => {
          if (!open || scope !== 'sessions') return undefined
          const sessions = ctx.get('sessions')
          if (sessions === undefined || typeof sessions.refresh !== 'function') return undefined
          try {
            void Promise.resolve(sessions.refresh()).catch(() => {})
          } catch {
            // A failed refresh leaves the cached catalog on screen.
          }
          return undefined
        }, [open, scope])

        // Debounced workspace search; aborts the previous request on every
        // keystroke. Other scopes own their own effects.
        useEffect(() => {
          if (!open || scope !== 'workspace') return undefined
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
            const sessionId = currentSessionId(ctx, sessionListRef.current)
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
        }, [open, scope, query, caseSensitive, regex, mode])

        // Debounced current-conversation search. The host reads the committed
        // Session log, so older history outside the loaded window is included.
        useEffect(() => {
          if (!open || scope !== 'conversation') return undefined
          if (query.trim() === '') {
            conversationAbortRef.current?.abort()
            conversationAbortRef.current = undefined
            setConversationPhase('idle')
            setConversationData(null)
            setConversationError('')
            return undefined
          }
          if (activeSessionId === null) {
            conversationAbortRef.current?.abort()
            conversationAbortRef.current = undefined
            setConversationPhase('no-session')
            setConversationData(null)
            setConversationError('')
            return undefined
          }
          const timer = window.setTimeout(() => {
            conversationAbortRef.current?.abort()
            const controller = new AbortController()
            conversationAbortRef.current = controller
            const params = new URLSearchParams({
              sessionId: activeSessionId,
              q: query,
              case: caseSensitive ? '1' : '0',
              regex: regex ? '1' : '0',
              limit: String(CONVERSATION_LIMIT),
            })
            setConversationPhase('loading')
            setConversationData(null)
            setConversationError('')
            callHost(`${CONVERSATION_ROUTE}?${params.toString()}`, controller.signal)
              .then((value) => {
                if (controller.signal.aborted) return
                setConversationData(value)
                setActive(0)
                setConversationPhase('ready')
              })
              .catch((reason) => {
                if (controller.signal.aborted || reason?.name === 'AbortError') return
                setConversationError(String((reason && reason.message) || reason))
                setConversationPhase('error')
              })
          }, DEBOUNCE_MS)
          return () => {
            window.clearTimeout(timer)
            conversationAbortRef.current?.abort()
            conversationAbortRef.current = undefined
          }
        }, [open, scope, query, caseSensitive, regex, activeSessionId])

        // Keep the selected row in view.
        useEffect(() => {
          if (!open) return
          const host = listRef.current
          if (host === null) return
          const row = host.querySelector(`[data-index="${String(active)}"]`)
          if (row !== null && typeof row.scrollIntoView === 'function') {
            row.scrollIntoView({ block: 'nearest' })
          }
        }, [open, active, data, conversationData, scope])

        useEffect(() => () => {
          if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current)
          if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current)
          abortRef.current?.abort()
          conversationAbortRef.current?.abort()
        }, [])

        const workspaceFileRows = mode === 'text' ? [] : (data?.files ?? [])
        const workspaceMatches = mode === 'files' ? [] : (data?.matches ?? [])
        const sessionRows = useMemo(
          () => filterSessionRows(sessionList, query, SESSION_ROW_LIMIT),
          [sessionList, query],
        )
        const messageMatches = scope === 'conversation' && conversationPhase === 'ready'
          ? (conversationData?.matches ?? [])
          : []
        const rows = useMemo(() => {
          if (scope === 'sessions') {
            return sessionRows.map((session, index) => ({ kind: 'session', index, session }))
          }
          if (scope === 'conversation') {
            return messageMatches.map((hit, index) => ({ kind: 'message', index, hit }))
          }
          const out = []
          for (let index = 0; index < workspaceFileRows.length; index += 1) {
            out.push({ kind: 'file', index, file: workspaceFileRows[index] })
          }
          for (let index = 0; index < workspaceMatches.length; index += 1) {
            out.push({ kind: 'text', index: workspaceFileRows.length + index, hit: workspaceMatches[index] })
          }
          return out
        }, [scope, sessionRows, messageMatches, data, mode])
        const groups = useMemo(() => {
          const out = []
          let index = 0
          let current = null
          for (const hit of workspaceMatches) {
            if (current === null || current.path !== hit.path) {
              current = { path: hit.path, start: index, hits: [] }
              out.push(current)
            }
            current.hits.push({ ...hit, index: workspaceFileRows.length + index })
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
          const sessionId = currentSessionId(ctx, sessionListRef.current)
            ?? (typeof data?.sessionId === 'string' ? data.sessionId : null)
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
          const sessionId = currentSessionId(ctx, sessionListRef.current)
            ?? (typeof data?.sessionId === 'string' ? data.sessionId : null)
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

        /**
         * Open one Session-title row, or copy its id when no navigation service
         * is present.
         * @param {{id: string, title: string}} session - selected row.
         */
        const openSessionRow = useCallback((session) => {
          const navigation = ctx.get('uiWorkspace')
          if (navigation !== undefined && navigation !== null && typeof navigation.openSession === 'function') {
            try {
              navigation.openSession(session.id)
              close()
              return
            } catch (reason) {
              showNotice(t('notice.sessionOpenFailed', { message: String((reason && reason.message) || reason) }))
            }
          }
          void copyText(session.id).then((copied) => {
            showNotice(t(copied ? 'notice.sessionCopied' : 'notice.copyFailed', { id: session.id }))
            scheduleClose()
          })
        }, [close, scheduleClose, showNotice, t])

        /**
         * Reveal one conversation hit in the Chat view, falling back to copying
         * its text when the message cannot be located (no Chat anchor, another
         * Conversation View, or an older DSH).
         * @param {{text?: string, snippet: string}} hit - selected message hit.
         */
        const openMessage = useCallback((hit) => {
          void jumpToConversationHit(ctx, activeSessionId, hit).then((revealed) => {
            if (revealed) {
              close()
              return
            }
            const text = typeof hit.text === 'string' && hit.text !== '' ? hit.text : hit.snippet
            void copyText(text).then((copied) => {
              showNotice(t(copied ? 'notice.messageCopiedFallback' : 'notice.copyMessageFailed'))
            })
          })
        }, [activeSessionId, close, showNotice, t])

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
            else if (row.kind === 'session') openSessionRow(row.session)
            else if (row.kind === 'message') openMessage(row.hit)
            else openHit(row.hit)
            return
          }
          if (event.key === 'Tab') {
            event.preventDefault()
            inputRef.current?.focus()
          }
        }

        const summary = scope === 'sessions'
          ? t('footer.sessions', { count: String(sessionRows.length) })
          : scope === 'conversation'
            ? t('footer.conversation', {
                matches: String(conversationData?.matchCount ?? 0),
                messages: String(conversationData?.messageCount ?? 0),
              })
            : data === null
              ? ''
              : mode === 'files'
                ? t('footer.filesOnly', { files: String(data.fileCount) })
                : mode === 'text'
                  ? t('footer.textOnly', { matches: String(data.matchCount), textFiles: String(data.textFileCount) })
                  : t('footer.all', { files: String(data.fileCount), matches: String(data.matchCount) })
        const engine = data?.engine === 'walk' ? t('engine.walk') : t('engine.rg')
        const placeholder = scope === 'sessions'
          ? t('search.placeholder.sessions')
          : scope === 'conversation'
            ? t('search.placeholder.conversation')
            : t('search.placeholder')
        const busy = scope === 'workspace'
          ? phase === 'loading'
          : scope === 'conversation' && conversationPhase === 'loading'
        const idle = (title, hint) => h('div', { className: 'gs-idle' },
          h('div', { className: 'gs-idle-title' }, title),
          h('div', { className: 'gs-idle-hint' }, hint))
        const stat = (text) => h('span', { className: 'gs-stat' }, text)
        const sessionListReady = sessionList !== null
          && !(sessionList?.phase === 'pending' && (sessionList?.ids?.length ?? 0) === 0)

        let body
        if (scope === 'sessions') {
          if (!sessionListReady) {
            body = idle(t('state.sessionsUnavailable'), t('state.sessionsUnavailableHint'))
          } else if (query.trim() === '') {
            body = idle(t('state.sessionsIdleTitle'), t('state.sessionsIdleHint'))
          } else if (sessionRows.length === 0) {
            body = h('div', { className: 'gs-empty' },
              h('div', null, t('state.sessionsEmpty')),
              h('div', { className: 'gs-empty-hint' }, t('state.sessionsEmptyHint')))
          } else {
            body = h('div', { className: 'gs-list', ref: listRef, role: 'listbox', 'aria-label': t('dialog.title') },
              sessionRows.map((session, index) => h('button', {
                key: `session:${session.id}`,
                type: 'button',
                role: 'option',
                'aria-selected': index === active,
                className: 'gs-session',
                'data-active': index === active ? 'true' : undefined,
                'data-index': String(index),
                title: session.cwd === '' ? session.id : `${session.title} · ${session.cwd}`,
                onMouseMove: () => { if (active !== index) setActive(index) },
                onClick: () => openSessionRow(session),
              },
                h('span', { className: 'gs-session-icon' }, SessionIcon()),
                h('span', { className: 'gs-session-main' },
                  h('span', { className: 'gs-session-title' }, session.title),
                  h('span', { className: 'gs-session-meta' },
                    session.workspace === '' ? t('session.workspaceUnknown') : session.workspace)),
                session.updatedAt === 0 ? null : h('span', { className: 'gs-session-time' }, formatStamp(session.updatedAt)),
                session.running ? h('span', { className: 'gs-session-running' }, '●') : null)))
          }
        } else if (scope === 'conversation') {
          if (activeSessionId === null) {
            body = idle(t('state.noSession'), t('state.noSessionHint'))
          } else if (query.trim() === '') {
            body = idle(t('state.conversationIdleTitle'), t('state.conversationIdleHint'))
          } else if (conversationPhase === 'error') {
            body = h('div', { className: 'gs-error', role: 'alert' },
              t('state.error', { message: conversationError }))
          } else if (messageMatches.length > 0) {
            body = h('div', { className: 'gs-list', ref: listRef, role: 'listbox', 'aria-label': t('dialog.title') },
              messageMatches.map((hit, index) => h('button', {
                key: `message:${String(hit.seq)}`,
                type: 'button',
                role: 'option',
                'aria-selected': index === active,
                className: 'gs-message',
                'data-active': index === active ? 'true' : undefined,
                'data-index': String(index),
                title: t('message.reveal'),
                onMouseMove: () => { if (active !== index) setActive(index) },
                onClick: () => openMessage(hit),
              },
                h('span', { className: 'gs-message-role' }, t(`message.role.${hit.role}`)),
                h('span', { className: 'gs-message-main' },
                  h('span', { className: 'gs-message-text' },
                    highlight(hit.snippet, query, caseSensitive, regex)),
                  h('span', { className: 'gs-message-meta' },
                    [formatStamp(hit.time),
                      hit.matchCount > 1 ? t('message.hits', { count: String(hit.matchCount) }) : '',
                      hit.textTruncated === true ? t('message.truncated') : '']
                      .filter((part) => part !== '').join(' · '))))))
          } else if (conversationPhase === 'loading') {
            body = idle(t('state.conversationIdleTitle'), t('state.conversationIdleHint'))
          } else if (conversationPhase === 'ready') {
            body = h('div', { className: 'gs-empty' },
              h('div', null, t('state.conversationEmpty')),
              h('div', { className: 'gs-empty-hint' }, t('state.conversationEmptyHint')))
          } else {
            body = idle(t('state.conversationIdleTitle'), t('state.conversationIdleHint'))
          }
        } else if (phase === 'idle') {
          body = idle(t('state.idle.title'), t('state.idle.hint'))
        } else if (phase === 'error') {
          body = h('div', { className: 'gs-error', role: 'alert' }, t('state.error', { message: error }))
        } else if (rows.length === 0 && phase === 'ready') {
          body = h('div', { className: 'gs-empty' },
            h('div', null, mode === 'files' ? t('state.emptyFiles') : t('state.empty')),
            h('div', { className: 'gs-empty-hint' },
              mode === 'files' ? t('state.emptyFilesHint') : t('state.emptyHint')))
        } else {
          body = h('div', { className: 'gs-list', ref: listRef, role: 'listbox', 'aria-label': t('dialog.title') },
            workspaceFileRows.length > 0
              ? h('div', { className: 'gs-section', key: 'section:files' }, t('section.files'))
              : null,
            workspaceFileRows.map((file, index) => h('button', {
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
            workspaceMatches.length > 0
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

        const truncated = scope === 'workspace'
          ? data?.truncated === true
          : scope === 'conversation' && conversationData?.truncated === true

        return h('div', { className: 'gs-layer', 'data-gs-scheme': appearanceState.scheme },
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
                placeholder,
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
              busy ? h('span', { className: 'gs-busy' }, '…') : null,
              h('span', { className: 'gs-closekbd' }, 'Esc')),
            h('div', { className: 'gs-scopes', role: 'tablist', 'aria-label': t('role.scopes') },
              ...SCOPES.map(([value, key]) => h('button', {
                key: value,
                type: 'button',
                role: 'tab',
                'aria-selected': scope === value,
                'data-active': scope === value ? 'true' : undefined,
                className: 'gs-scope',
                onClick: () => { setScope(value); setActive(0); inputRef.current?.focus() },
              }, t(key)))),
            scope === 'workspace'
              ? h('div', { className: 'gs-tabs', role: 'tablist', 'aria-label': t('role.tabs') },
                  ...[['all', t('tab.all')], ['files', t('tab.files')], ['text', t('tab.text')]].map(([value, label]) => h('button', {
                    key: value,
                    type: 'button',
                    role: 'tab',
                    'aria-selected': mode === value,
                    'data-active': mode === value ? 'true' : undefined,
                    className: 'gs-tab',
                    onClick: () => { setMode(value); inputRef.current?.focus() },
                  }, label)))
              : null,
            h('div', { className: 'gs-body' }, body,
              truncated && rows.length > 0
                ? h('div', { className: 'gs-empty-note' }, t('footer.truncated'))
                : null),
            h('div', { className: 'gs-footer' },
              h('span', { className: 'gs-hints' },
                h('span', { className: 'gs-hint' }, h('span', { className: 'gs-key' }, '↑'), h('span', { className: 'gs-key' }, '↓'), t('footer.navigate')),
                h('span', { className: 'gs-hint' }, h('span', { className: 'gs-key' }, 'Enter'),
                  t(scope === 'conversation' ? 'footer.copy' : scope === 'sessions' ? 'footer.openSession' : 'footer.open')),
                h('span', { className: 'gs-hint' }, h('span', { className: 'gs-key' }, 'Esc'), t('footer.close'))),
              h('span', { className: 'gs-spacer' }),
              scope === 'workspace' && data !== null
                ? h('span', { className: 'gs-root', title: data.root }, data.root)
                : null,
              scope === 'workspace'
                ? (data === null ? null : stat(summary))
                : scope === 'sessions'
                  ? stat(summary)
                  : (conversationData === null ? null : stat(summary)),
              scope === 'workspace' && data !== null
                ? stat(t('footer.elapsed', { ms: String(data.elapsedMs), engine }))
                : scope === 'conversation' && conversationData !== null
                  ? stat(t('footer.elapsed', {
                      ms: String(conversationData.elapsedMs),
                      engine: t('engine.conversation'),
                    }))
                  : null),
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
        // `follow` resolves to the DSH theme's effective scheme. The theme
        // event covers preference switches and OS flips; the body attribute
        // keeps it current in deployments without the theme service.
        ctx.effect(() => {
          const theme = ctx.get('theme')
          const read = () => {
            try {
              const scheme = theme?.getTheme?.()?.active?.colorScheme
              if (scheme === 'light' || scheme === 'dark') return scheme
            } catch {
              // A theme service that throws must not break the panel.
            }
            return readDshScheme()
          }
          appearance.setDshScheme(read())
          const off = typeof ctx.on === 'function'
            ? ctx.on('theme/change', (snapshot) => {
              // The emitted snapshot is authoritative; read again only when it
              // carries no usable scheme.
              const scheme = snapshot?.active?.colorScheme
              appearance.setDshScheme(scheme === 'light' || scheme === 'dark' ? scheme : read())
            })
            : undefined
          let observer
          if (typeof MutationObserver === 'function' && document.body !== null && document.body !== undefined) {
            observer = new MutationObserver(() => { appearance.setDshScheme(read()) })
            observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
          }
          return () => {
            if (typeof off === 'function') off()
            if (observer !== undefined) observer.disconnect()
          }
        }, 'dsh-simple-search: DSH theme sync')
        // The bundle's page in Plugin Manager carries the three-way appearance
        // choice; the key is the bundle package name the page looks up.
        ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-simple-search',
          locale: NS,
        }, AppearanceSettings)), 'dsh-simple-search: appearance settings')
      },
    }
  },
})
