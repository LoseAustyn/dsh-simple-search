# 架构说明

本文档描述插件当前的实际架构，而非历史提案。如架构或安全边界发生调整，请同步更新本文。

## 运行时结构

```text
DSH Web 页面
├── client.js（浏览器端）
│   ├── shell.overlay              双击 Shift 监听、搜索面板、三类范围与结果列表
│   ├── conversation.input.overlay
│   │   └── 桥接组件                将会话输入框公开的 inputActions 同步给根浮层
│   ├── plugins.bundle.config      插件详情页的外观设置卡
│   ├── 会话标题搜索                基于 ctx.sessions.list 快照本地过滤（跨工作区）
│   ├── 面板内 Alt+Enter 引用       captureInsertion → insertReference（原生 @ 引用）
│   └── fetch(GET, same-origin)
│         /dsh-simple-search/version
│         /dsh-simple-search/search
│         /dsh-simple-search/conversation
└── index.js（Node 服务端）
    ├── 鉴权与同源拦截（Host 解析、sec-fetch-site、Origin、connection.requestRejection）
    ├── resolveRoot（会话 cwd / 显式 root / 最近工作区）
    ├── searchWorkspace（search.js）
    │     ├── rg（优先）
    │     └── bounded walk（回退遍历）
    └── sessionQuery.observeSession → conversationDocuments / matchConversation（conversation.js）
          ├── 仅提取用户提问与助手回复的 text 块
          └── 过滤 reasoning、tool-call / tool-result、system / developer 与合成上下文
```

三个搜索范围各自独立：工作区文件走服务端文件检索；会话标题直接在浏览器端完成（页面已持有跨工作区的会话列表快照）；本会话内容由服务端读取会话日志。`client.js` 通过 `document.baseURI` 解析相对路由，并使用 `credentials: 'same-origin'` 携带页面自身的登录 cookie，插件本身不读取也不存储任何凭据。

## 模块职责与边界

| 文件 | 对外契约 | 职责边界 |
|---|---|---|
| `index.js` | 导出 `name`、`inject=['webServer','connection']`、`apply(ctx)`；注册三条精确路由；返回 `{ok,value}` 或 `{ok:false,error:{code,message}}` | 不实现搜索或提取算法，不碰 DOM |
| `search.js` | 导出上限常量、`SearchError`、匹配/排序/引擎函数及 `searchWorkspace(request)` | 不依赖 `ctx`、HTTP 或浏览器；不把 `process.cwd()` 当默认目录 |
| `conversation.js` | 导出 `MAX_CONVERSATION_*`、`conversationDocuments(events)`、`matchConversation(extracted, request)`、`searchConversation(events, request)` | 纯函数模块；不依赖 `ctx`、HTTP 或文件系统 |
| `client.js` | 通过 `__ModuleLoader__.load({id:'dsh-simple-search', factory})` 注册 `shell.overlay`、`conversation.input.overlay` 桥接与 `plugins.bundle.config`；`inject=['slots','locale']` | 不处理服务端鉴权、不直接读文件系统；会话标题只读已加载快照；消息定位只读 Chat 锚点，不改 Chat DOM；`@` 引用走会话公开输入接口，不直接改输入框 DOM |
| `tests/*.mjs` | 基于 `node:test` 的行为测试（规范见 `tests/AGENTS.md`） | 不依赖真实浏览器或运行中的 DSH |
| `scripts/verify-auth-fence.mjs` | 基于临时本地 HTTP 服务的 6 场景鉴权集成测试 | 不依赖运行中的 DSH |

## 核心请求流程

### 1. 工作区文件搜索

1. 双击 `Shift` 呼出面板，默认进入「工作区文件」范围。
2. 输入经防抖后拼接查询参数：`q`、`mode=text|files|all`、`regex=1`、`case=1`、`limit=300`（前端常量 `RESULT_LIMIT`），有当前会话时附带 `sessionId`。
3. 以相对路径发起 `fetch`，并用 `AbortController` 取消尚未完成的旧请求。
4. 服务端 `fence` 按顺序校验：`Host` 可解析 → `sec-fetch-site` 非 `cross-site` → `Origin` 与 `Host` 同源 → `connection` 存在且具备 `requestRejection` 方法 → 调用 `requestRejection` 校验 Host 权威与登录态 → 拒绝非回环的非 GET 请求。
5. `resolveRoot` 确定搜索根目录（规则见下节）。
6. `searchWorkspace` 按模式执行：
   - `text`：优先调用 ripgrep，不可用时回退到有界 Node.js 遍历。
   - `files`：优先 `rg --files`，不可用时走目录遍历；文件列表缓存 10 秒。
   - `all`：先列文件名再搜文本，`engine` 字段反映文本搜索使用的引擎。
7. `handleSearch` 包装统一 JSON 响应，将 `SearchError` 映射为固定的 HTTP 状态码与 `code`。

### 2. 本会话内容搜索

1. 前端从 `ctx.sessions.list` 确定当前主视图会话：优先取 `uiSession.adapter.current`，其次 `retainedBy.mainView > 0`，最后回退到 `better-sidebar` 的 `sessionId`。
2. 输入防抖后请求 `/dsh-simple-search/conversation?sessionId=…&q=…&case=…&regex=…&limit=…`，切换范围或关闭面板时立即中止请求。
3. 服务端复用同一套 `fence`，校验 `q`（非空且 ≤300 字符）与 `sessionId` 白名单后，调用 `ctx.sessionQuery.observeSession(sessionId, {projectionMode:'none', signal: 8s})`。
4. `conversationDocuments` 只保留 `user/message` 中 `source.kind === 'user'` 的用户发言，以及 `assistant/message` 的 `text` 块；思考过程（`reasoning`）、工具调用与结果、系统/开发者消息及合成上下文全部丢弃。
5. 提取结果在服务端内存中按日志 `cursor` 缓存（最多保留 3 个会话），仅当日志追加导致 `cursor` 变化时才重新提取。
6. `matchConversation` 按时间倒序（最新消息优先）匹配并生成单行摘录，包装后返回。

### 3. 面板内 `Alt+Enter` 插入 `@` 引用

1. 搜索框聚焦时，面板的 `onPanelKeyDown` 捕获 `Alt+Enter`；仅对文件名行和文本命中行生效，其他行不处理也不拦截默认行为。
2. 目标会话取当前主视图会话（`currentSessionId`）。光标位置由会话级桥接组件（挂载在 `conversation.input.overlay`）通过 `inputActions.captureInsertion()` 提供并存入模块级 `Map`；面板打开期间输入框失焦，`captureInsertion` 会返回最近一次选区或文档末尾，并携带当前 `draftRev`。
3. 通过 `ctx.get('sessions').scope(id)` 和 `ctx.get('conversation').input.for(scope)` 获取 `SessionInput`，调用 `insertReference({source:'reference', ref:'@path', appearance:'file', clipboardText:'@path'}, span)`；成功后关闭面板并重新聚焦输入框。
4. 含空白字符的路径写作 `@"path"`；若路径含控制字符或引号无法安全表示，或当前无会话、草稿冻结、旧版 DSH 缺少该接口，则回退为复制 `@path` 文本并给出提示。
5. 该快捷键仅绑定在面板挂载期间（不注册全局 `window` 监听，不接管输入框），不影响输入框的 `Shift+Enter` 换行；面板内单行搜索框没有换行语义，`Shift+Enter` 与 `Enter` 行为一致。
6. 文本命中插入的同样是文件引用（`@path`），不含行号，因为 DSH 文件引用语法本身不支持行号字段。

### 4. 会话标题搜索

会话标题搜索完全在浏览器端完成：`ctx.sessions.list` 已包含跨工作区的会话目录快照。前端按 `title`/`displayTitle`、工作区目录名和会话 ID 做子串匹配，过滤空白占位会话与 subagent 子会话，按 `updatedAt` 倒序展示。按 `Enter` 调用 `ctx.get('uiWorkspace').openSession(id)` 打开会话；缺少该服务时回退复制会话 ID。每次打开面板都会触发 `sessions.refresh()` 以同步最新会话。

## 目录解析规则

按固定优先级解析搜索根目录：

1. **会话目录**：`sessionId` 通过白名单校验后，取 `sessions.get(id)` 的已提交工作目录（`workingDirectory.get(session)`），缺失时回退到 `session.header.cwd`，且 `realpath` 必须是有效目录。
2. **显式 `root`**：先 `path.resolve` 再 `realpath`，必须落在会话目录或任一已注册工作区的 `realpath` 内；越界返回 `403 denied`，目录不存在返回 `422 bad-root`。
3. **默认工作区**：前两者均未提供时，取 `workspaceRegistry.list()` 中 `updatedAt` / `createdAt` 最新的已注册工作区。
4. **无可用根目录**：直接返回 `422 bad-root`，绝不回退到服务端进程的 `process.cwd()`。

路径包含判断 `isWithin` 严格按路径段边界比对，不使用字符串前缀，避免 `/repo-evil` 误匹配 `/repo`。

## 文件搜索引擎与上限

所有文件搜索限制集中维护在 `search.js`，调用方不要重复定义：

| 常量 | 值 | 说明 |
|---|---|---|
| `MAX_MATCHES` | 400 | 单次总命中上限（路由 `limit` 参数也钳制到此值） |
| `MAX_MATCHES_PER_FILE` | 40 | 单文件命中上限，防止超大日志占满结果 |
| `MAX_LINE_CHARS` | 400 | 单行文本截断长度（ripgrep 侧通过 `--max-columns` 控制） |
| `MAX_FILE_BYTES` | 1,500,000 | 回退遍历跳过的单文件体积上限 |
| `MAX_VISITED` | 40,000 | 回退遍历的最大目录项访问数 |
| `SEARCH_TIMEOUT_MS` | 8,000 | 单次搜索超时上限（ms） |
| `MAX_FILE_RESULTS` | 120 | 文件名搜索结果上限 |
| 文件列表缓存 | 10,000 ms | 连续输入期间避免重复扫描目录 |

ripgrep 调用的关键参数：

- `--hidden` 与 `--no-ignore-vcs`：包含隐藏文件且不遵循 `.gitignore`，以便多仓库工作区在根 `.gitignore` 忽略子仓库时仍能搜到子仓库源码。
- `--no-config`、`--no-messages`、`--color never`、`--no-heading`、`--line-number`、`--column`、`--max-columns`、`--max-count`、`--threads 4`。
- 排除规则统一由 `SKIP_DIR_NAMES` 派生（含 `node_modules`、`.git`、构建产物、虚拟环境、`.dsh-memory` 等），ripgrep 与回退遍历共用同一份列表。

回退遍历还会跳过符号链接、常见二进制扩展名、含 NUL 字节的文件、空文件及超大文件，并对目录项排序保证结果顺序稳定。

## 会话内容提取与上限

会话提取与匹配上限由 `conversation.js` 维护，`index.js` 只负责日志读取与超时控制：

| 常量 | 值 | 说明 |
|---|---|---|
| `MAX_CONVERSATION_MESSAGES` | 5,000 | 参与搜索的最近消息条数上限，超出丢弃旧消息并置 `truncated` |
| `MAX_CONVERSATION_MATCHES` | 200 | 单次命中上限（路由 `limit` 参数也钳制到此值） |
| `MAX_CONVERSATION_COUNT_PER_MESSAGE` | 50 | 单条消息内的最大命中计数 |
| `MAX_CONVERSATION_STORED_TEXT_CHARS` | 20,000 | 单条消息参与匹配的最大字符前缀 |
| `MAX_CONVERSATION_TOTAL_CHARS` | 2,000,000 | 单会话保留的总文本上限，超出从最旧消息起裁剪 |
| `MAX_CONVERSATION_TEXT_CHARS` | 4,000 | 返回给前端用于复制的文本上限 |
| `MAX_CONVERSATION_SNIPPET_CHARS` | 260 | 列表展示的单行摘录长度 |
| `CONVERSATION_TIMEOUT_MS`（`index.js`） | 8,000 | 单次 `observeSession` 超时上限（ms） |

提取规则属于明确的产品与安全边界：

- `user/message` 只计入 `data.source.kind === 'user'` 的消息；同为 user 角色的合成上下文（如 `AGENTS.md`、skill 正文、定时提醒）不参与搜索。
- `assistant/message` 只取 `text` 块；思考过程（`reasoning`）与工具调用（`tool-call`）不纳入搜索范围。
- `tool/result`、`system/message`、`developer/message` 与 `session/title` 不生成搜索文档。
- 零宽正则匹配不产出摘录，避免返回没有实际高亮文本的空命中。

## Chat 消息定位机制

在「本会话」结果上按 `Enter` 时，前端优先尝试在当前 Chat 视图中定位并滚动到该消息，失败再回退为复制消息全文：

1. 服务端直接返回事件自带的 `seq`、`turn`、`step`、`messageId`，前端不做猜测。
2. DSH Conversation 节点键格式为 `${kind.length}:${kind}${id}`：用户消息对应 `input-message` + `messageId`，助手消息对应 `assistant-step` + `turn:step`。Chat 视图的每一行带有 `data-chat-anchor-key` 属性（回复行等于节点键，助手思考行是 `["<key>","reasoning"]`），两行共用 `data-chat-node-key`，因此必须按 `data-chat-anchor-key` 精确查找，避免误定位到隐藏的思考行。查询范围限定在 `[data-conversation-session="<sessionId>"]` 容器内，防止匹配到侧栏其他会话的同键节点。
3. 若目标消息不在当前已渲染窗口内，前端先通过 `ctx.sessions.retain(sessionId, {source:'simpleSearch'})` 等待 `reference.ready`，再调用 `session.loadThrough(seq)` 加载更早历史并释放引用，随后最多等待 1.5 秒待 React 完成渲染。
4. 找到锚点后调用 `scrollIntoView({block:'center'})` 并关闭面板；若当前不在 Chat 视图、DSH 版本不兼容或未找到锚点，则复制消息内容并提示。
5. 该定位属于尽力而为（best-effort）：DSH 暂未提供公开的 `revealMessage` 服务，若上游调整锚点属性格式，功能会平滑退化为复制，不影响搜索本身。

插件只读取该 DOM 属性，不修改 Chat 视图的任何节点、状态或样式。

## 统一响应格式

### 工作区文件搜索成功

```json
{
  "ok": true,
  "value": {
    "root": "/abs/workspace",
    "sessionId": "session-…",
    "mode": "text",
    "engine": "rg",
    "files": [],
    "matches": [{ "path": "src/a.ts", "line": 2, "column": 7, "text": "…" }],
    "matchCount": 1,
    "fileCount": 0,
    "textFileCount": 1,
    "scanned": 0,
    "truncated": false,
    "elapsedMs": 12
  }
}
```

- `fileCount` 为文件名命中数，`textFileCount` 为文本命中所涉及的不重复文件数。
- `scanned` 由文件列举阶段提供；纯 `text` 模式下为 `0`。
- `truncated` 表示触发了任一上限或超时。
- `root` 为 `realpath` 后的绝对路径；`sessionId` 仅在会话目录解析成功时非空。

### 本会话内容搜索成功

```json
{
  "ok": true,
  "value": {
    "sessionId": "session-…",
    "title": "当前会话标题",
    "cwd": "/abs/workspace",
    "messageCount": 42,
    "matchCount": 1,
    "matches": [{
      "seq": 8,
      "role": "assistant",
      "time": 1794984793619,
      "turn": 1,
      "step": 1,
      "messageId": "…",
      "text": "返回给客户端复制的消息文本（≤4000 字符）",
      "textTruncated": false,
      "snippet": "…单行摘录…",
      "matchCount": 1
    }],
    "scanned": 42,
    "truncated": false,
    "elapsedMs": 12
  }
}
```

- `matches` 按最新消息优先排序；`seq` 为日志序号；`role` 仅限 `user` 或 `assistant`；`turn`、`step`、`messageId` 用于前端定位 Chat 节点。
- `text` 供复制使用，`snippet` 供面板展示；`textTruncated` 标明复制文本是否被截断；`matchCount` 为该条消息内的命中次数。
- `truncated` 表示消息条数、单消息计数或总命中数任一触顶。

### 失败响应与错误码

```json
{ "ok": false, "error": { "code": "denied", "message": "只能搜索已注册工作区内的目录" } }
```

| HTTP 状态码 | `code` | 触发条件 |
|---|---|---|
| 400 | `invalid-pattern` | 空查询、超过 300 字符或非法正则 |
| 401 | `forbidden` | `connection.requestRejection` 返回 401 |
| 403 | `forbidden` | 跨站请求、异源 `Origin`、鉴权检查抛错、非回环非 GET 请求 |
| 403 | `denied` | 显式 `root` 越界，或 ripgrep 不可用/启动失败 |
| 404 | `not-found` | 会话不存在或尚未落盘 |
| 422 | `bad-root` | 目录不存在，或当前无可用工作区 |
| 422 | `bad-session` | 缺少 `sessionId` 或格式不合法 |
| 500 | `internal` | 未归类异常（含会话日志损坏） |
| 503 | `auth-unavailable` | 缺少 `connection` 服务或缺少 `requestRejection` 方法 |
| 503 | `unavailable` | 宿主未挂载 `sessionQuery` 服务 |
| 504 | `timeout` | 读取会话日志超过 8 秒 |

## 核心约束

- 鉴权默认拒绝（fail-closed）：任何无法确认调用者身份的分支一律拒绝，绝不放行。
- 搜索根目录只来自当前会话或已注册工作区，显式 `root` 必须做二次边界校验。
- 所有路由只读，不提供写文件、改工作区或执行命令的能力。
- 插件标识（见 `AGENTS.md`）多处联动，改动路由前缀时必须同步客户端、patch、loader ID 和 slot key。
- 版本号只来自 `package.json`，`/version` 响应由单元测试守住。
- 用户可见文案统一来自 locale 字典。

## 测试分层

| 层级 | 实现方式 | 覆盖重点 |
|---|---|---|
| 搜索核心 | 直接 import `search.js` + 真实临时目录 | ripgrep 解析、匹配编译、排序、上限、回退遍历 |
| 会话核心 | 直接 import `conversation.js` + 事件样本 | 提取规则、思考/工具过滤、正则、摘录、上限、排序 |
| 服务端路由 | `apply()` + mock `webServer`/`effect`/`get` 直接调用 handler | 鉴权拦截、目录解析、会话读取、响应格式、错误映射 |
| 浏览器端 | `vm.runInNewContext(client.js)` + mock React / `localStorage` | 注册、外观偏好、主题跟随、范围切换、标题匹配、`@` 引用插入与复制回退 |
| 鉴权集成 | 临时本地 HTTP 服务 + 6 种 `connection` 场景 | 缺服务、`null`、抛错、拒绝透传、放行、跨站 |

## 非目标

- 不建持久索引、不做增量索引、不常驻文件监听。
- 不遵循 `.gitignore`，排除目录表是明确的产品选择。
- 不提供文件写入、替换、重构或命令执行能力。
- 不维护持久化服务端状态；文件列表缓存与会话提取缓存均为进程内短期缓存。
- 不做跨会话全文检索；会话相关范围仅覆盖「跨工作区会话标题」与「当前会话正文」。
- 不修改 Chat 视图的 DOM 或内部状态，消息定位失败一律回退复制。
- 不索引思考过程、工具调用/结果或系统提示词。
