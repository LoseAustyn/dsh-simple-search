# Architecture

当前状态的说明，不是提案。架构或安全决策变化时同步更新本文件。

## 运行时拓扑

```text
DSH 页面
├── client.js
│   ├── shell.overlay          双击 Shift、搜索框、三个搜索范围、结果列表
│   ├── conversation.input.overlay
│   │   └── 桥接组件           把会话输入框的公开 inputActions 交给根浮层
│   ├── plugins.bundle.config  插件详情页的外观卡
│   ├── 会话标题搜索           在 ctx.sessions.list 快照上本地过滤（跨工作区）
│   ├── 面板内 Alt+Enter 引用   captureInsertion → insertReference（原生 @ 引用）
│   └── fetch(GET, same-origin)
│         /dsh-simple-search/version
│         /dsh-simple-search/search
│         /dsh-simple-search/conversation
└── index.js（宿主半）
    ├── 信任栅栏（Host 解析、sec-fetch-site、Origin、connection.requestRejection）
    ├── resolveRoot（会话 cwd / 显式 root / 最近工作区）
    ├── searchWorkspace（search.js）
    │     ├── rg（优先）
    │     └── bounded walk（回退）
    └── sessionQuery.observeSession → conversationDocuments/matchConversation（conversation.js）
          ├── 只取人类 prompt 与 assistant 的 text 块
          └── 排除 reasoning、tool-call/result、system/developer、合成上下文
```

三个搜索范围各自独立：工作区文件走宿主文件搜索；会话标题完全在浏览器内完成（页面已经持有跨工作区的会话目录）；本会话内容走宿主会话日志。`client.js` 通过 `document.baseURI` 解析相对路由，`credentials: 'same-origin'` 携带页面自己的认证 cookie。插件不保存、不读取凭据。

## 模块契约

| 文件 | 契约 | 边界 |
|---|---|---|
| `index.js` | 导出 `name`、`inject=['webServer','connection']`、`apply(ctx)`；注册三条 exact 路由；返回 `{ok,value}` 或 `{ok:false,error:{code,message}}` | 不实现搜索算法，不读 DOM |
| `search.js` | 导出限制常量、`SearchError`、匹配/排序/引擎函数、`searchWorkspace(request)` | 不依赖 `ctx`、HTTP、浏览器；不读环境 cwd 作为搜索根 |
| `conversation.js` | 导出 `MAX_CONVERSATION_*`、`conversationDocuments(events)`、`matchConversation(extracted, request)`、`searchConversation(events, request)` | 纯函数；不依赖 `ctx`、HTTP、文件系统 |
| `client.js` | `__ModuleLoader__.load({id:'dsh-simple-search', factory})`；注册 `shell.overlay`、`conversation.input.overlay` 桥接组件与 `plugins.bundle.config`；`inject=['slots','locale']` | 不做宿主认证，不直接读文件系统；会话标题只读已加载的目录快照；消息定位只读 Chat 锚点，不修改 Chat DOM；@ 引用只走会话公开输入面板，不写输入框 DOM |
| `tests/*.mjs` | `node:test` 行为测试；见 `tests/AGENTS.md` | 不依赖真实浏览器或运行中的 DSH |
| `scripts/verify-auth-fence.mjs` | 真实 loopback HTTP 的认证集成，6 个场景 | 不依赖运行中的 DSH |

## 请求流程

1. 双击 Shift 打开浮层；范围默认是「工作区文件」。
2. **工作区文件**：输入经防抖后构造查询参数：`q`、`mode=text|files|all`、`regex=1`、`case=1`、`limit=300`（客户端常量 `RESULT_LIMIT`），有会话时加 `sessionId`。
3. `fetch` 相对路径，`AbortController` 取消上一请求；响应是 JSON envelope。
4. 宿主 `fence` 依次检查：Host 可解析 → `sec-fetch-site` 非 `cross-site` → `Origin` 与 Host 同源 → `connection` 存在且 `requestRejection` 是函数 → 调用 `requestRejection`（Host 权威与登录态由 Connection 服务判定）→ 非 GET 的非回环请求拒绝。
5. `resolveRoot` 决定搜索根（见下节）。
6. `searchWorkspace` 按模式执行：
   - `text`：优先 rg；不可用则 bounded walk。
   - `files`：优先 `rg --files`；不可用则 walk；结果缓存 10 秒。
   - `all`：先列文件名，再搜内容；`engine` 反映内容引擎。
7. `handleSearch` 返回 envelope；`SearchError` 映射为稳定状态码与 `code`。

**本会话内容**走另一条路径：

1. 客户端从 `ctx.sessions.list` 快照找出主视图会话：优先 `uiSession.adapter.current`，回退 `retainedBy.mainView > 0`，再回退 better-sidebar 的 `sessionId`。
2. 输入防抖后请求 `/dsh-simple-search/conversation?sessionId=…&q=…&case=…&regex=…&limit=…`；离开范围或关闭面板会中止请求。
3. 宿主复用同一 `fence`，校验 `q`（非空、≤300 字符）与 `sessionId` 白名单，然后 `ctx.sessionQuery.observeSession(sessionId, {projectionMode:'none', signal: 8s})`。
4. `conversationDocuments` 只保留 `user/message` 中 `source.kind === 'user'` 的事件与 `assistant/message` 的 `text` 块；`reasoning`（思考）、`tool-call`、`tool/result`、`system/developer` 与合成上下文全部丢弃。
5. 提取结果按日志 `cursor` 缓存在宿主进程内（最多 3 个会话）；日志追加后 cursor 变化才重新提取。
6. `matchConversation` 按最新消息优先匹配并生成单行摘录；返回 envelope。

**面板内 Alt+Enter 引用**：

1. 面板的 `onPanelKeyDown` 在焦点位于搜索框时识别 `Enter + Alt`；只有能表示成文件引用的行（文件名行、文本命中行）才处理，其他行不动作、也不阻止默认行为。
2. 目标会话取当前主视图会话（`currentSessionId`）；光标位置来自会话 slot 的公开 `inputActions.captureInsertion()`。桥接组件（`conversation.input.overlay`，session scope）把该 actions 按会话 id 发布到模块级 Map；面板打开期间输入框不在焦点，`captureInsertion` 给出最后一次选择或文档末尾，并携带当前 `draftRev`。
3. 通过 `ctx.get('sessions').scope(id)` + `ctx.get('conversation').input.for(scope)` 取得 `SessionInput`，调用 `insertReference({source:'reference', ref:'@path', appearance:'file', clipboardText:'@path'}, span)`；成功后关闭面板并 `focus()` 输入框。
4. 含空白路径写成 `@"path"`；控制字符或引号无法被 DSH 的 mention 语法安全表示时拒绝。没有打开的会话、`insertReference` 返回 false（草稿冻结/版本不符）或没有输入面板服务时，把 `@path` 文本复制到剪贴板并提示。
5. 该按键只存在于面板组件挂载期间（不注册 window 监听、不接管输入框），因此 `Shift+Enter` 与输入框的其他快捷键保持不变；面板内 `Shift+Enter` 与 `Enter` 一样激活当前行（单行输入框没有换行语义）。
6. 文本命中插入的是文件引用（`@path`），不携带行号——DSH 的文件引用语法没有行号字段。

**会话标题**不需要宿主路由：`ctx.sessions.list` 已经是跨工作区的目录快照。客户端按 `title`/`displayTitle`、工作区目录名、会话 id 做子串匹配，排除空白占位与 subagent 子会话，按 `updatedAt` 倒序；`Enter` 通过 `ctx.get('uiWorkspace').openSession(id)` 打开，没有该服务时退回复制会话 id。刷新面板会调用 `sessions.refresh()`，新会话与新标题由此进入目录。

## 根解析

顺序固定：

1. `sessionId` 通过白名单正则后，取 `sessions.get(id)` 的已提交工作目录（`workingDirectory.get(session)`），回退到 `session.header.cwd`；必须 realpath 成目录。
2. 显式 `root`：`path.resolve` 后 realpath；必须落在会话目录或任一已注册工作区的 realpath 内，否则 `403 denied`；目录不存在是 `422 bad-root`。
3. 没有会话、没有显式 root 时，取 `workspaceRegistry.list()` 中 `updatedAt`/`createdAt` 最新的已注册工作区。
4. 都没有则 `422 bad-root`，不退回宿主 `process.cwd()`。

`isWithin` 用路径段边界判断，不能用字符串前缀（避免 `/repo-evil` 匹配 `/repo`）。

## 搜索引擎与上限

`search.js` 拥有全部限制，调用方不要复制：

| 常量 | 值 | 作用 |
|---|---|---|
| `MAX_MATCHES` | 400 | 单次总命中上限；路由 `limit` 最大也钳到 400 |
| `MAX_MATCHES_PER_FILE` | 40 | 单文件命中上限 |
| `MAX_LINE_CHARS` | 400 | 返回行文本截断；rg 用 `--max-columns` |
| `MAX_FILE_BYTES` | 1,500,000 | walk 跳过大文件 |
| `MAX_VISITED` | 40,000 | walk 目录项预算 |
| `SEARCH_TIMEOUT_MS` | 8,000 | 单次搜索墙钟预算 |
| `MAX_FILE_RESULTS` | 120 | 文件名结果上限 |
| 文件列表缓存 | 10,000 ms | 输入时避免重复列目录 |

rg 参数的关键选择：

- `--hidden` + `--no-ignore-vcs`：搜索隐藏文件，且不服从 `.gitignore`。这是有意的：多仓工作区常用根 `.gitignore` 忽略子仓。
- `--no-config`、`--no-messages`、`--color never`、`--no-heading`、`--line-number`、`--column`、`--max-columns`、`--max-count`、`--threads 4`。
- 排除表由 `SKIP_DIR_NAMES` 派生（`node_modules`、`.git`、构建产物、虚拟环境、`.dsh-memory` 等），两个引擎共用，避免漂移。

回退 walk 额外跳过：符号链接、二进制扩展名、含 NUL 的文件、空文件、超大文件；目录项排序保证确定性。

## 会话内容提取与上限

`conversation.js` 拥有会话内容的提取与匹配上限，`index.js` 只负责观察与路由：

| 常量 | 值 | 作用 |
|---|---|---|
| `MAX_CONVERSATION_MESSAGES` | 5,000 | 参与匹配的最新消息数；更早的消息丢弃并置 `truncated` |
| `MAX_CONVERSATION_MATCHES` | 200 | 单次命中上限；路由 `limit` 也钳到这里 |
| `MAX_CONVERSATION_COUNT_PER_MESSAGE` | 50 | 单条消息的计数上限 |
| `MAX_CONVERSATION_STORED_TEXT_CHARS` | 20,000 | 单条消息参与匹配的文本前缀 |
| `MAX_CONVERSATION_TOTAL_CHARS` | 2,000,000 | 单会话保留文本总量；超出从最旧消息开始丢弃 |
| `MAX_CONVERSATION_TEXT_CHARS` | 4,000 | 返回给客户端复制的文本 |
| `MAX_CONVERSATION_SNIPPET_CHARS` | 260 | 单行摘录长度 |
| `CONVERSATION_TIMEOUT_MS`（`index.js`） | 8,000 | 单次 `observeSession` 墙钟预算 |

提取规则是安全/语义边界，不只是过滤优化：

- `user/message` 只在 `data.source.kind === 'user'` 时计入。合成上下文（AGENTS.md、skill 正文、cron/提醒）也是 user-role，但不是人类说的话。
- `assistant/message` 只取 `text` 块。`reasoning` 是模型思考过程，`tool-call` 是中间动作，均不进入搜索面。
- `tool/result`、`system/message`、`developer/message`、`session/title`（除折叠标题外）不产生文档。
- 零宽正则匹配不产生摘录，避免返回没有文本可展示的命中。

## 会话内容跳转

本会话命中后 `Enter` 先尝试在已挂载的 Chat 视图里定位该消息，定位失败才回退复制。

1. 宿主在每条命中里返回 `seq`、`turn`、`step`、`messageId`，全部来自事件本身，客户端不猜。
2. DSH Conversation 的节点键是 `${kind.length}:${kind}${id}`：用户消息为 `input-message` + 消息 id，assistant 为 `assistant-step` + `turn:step`。Chat 的 flow row 用 `data-chat-anchor-key` 标记渲染锚点：response 行等于节点键，assistant 的 reasoning 行是 `["<key>","reasoning"]`，两行共用 `data-chat-node-key`；因此必须按 `data-chat-anchor-key` 精确匹配，否则会命中不可见的 reasoning 行。查询限定在 `[data-conversation-session="<sessionId>"]` 容器内，避免侧栏另一个会话的同键节点被误命中。
3. 目标不在已加载窗口时，客户端 `ctx.sessions.retain(sessionId, {source:'simpleSearch'})`，`await reference.ready` 后调用 `session.loadThrough(seq)`，释放引用，再最多等 1.5 秒让 React 提交。
4. 找到行后 `scrollIntoView({block:'center'})` 并关闭面板；找不到（停在别的 Conversation View、旧 DSH、无锚点）则复制消息文本并提示。
5. 这是 best-effort：DSH 目前没有公开的 “reveal message” 服务，跳转依赖 Chat 的 `data-chat-anchor-key` 与公开的 `session.loadThrough`。DSH 改变锚点格式时退化为复制，搜索本身不受影响。

插件只读取该 DOM 属性，不修改 Chat 的节点、状态或样式。

## 响应 envelope

成功：

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

- `fileCount` 是文件名命中数；`textFileCount` 是内容命中涉及的 distinct 文件数。
- `scanned` 由文件名列举引擎提供；`text` 模式当前为 0。
- `truncated` 表示触达任一上限或超时。
- `root` 是 realpath；`sessionId` 只在会话根解析成功时非空。

本会话内容：

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

- `matches` 按最新消息优先排序；`seq` 是日志序列，`role` 只会是 `user` 或 `assistant`；`turn`/`step`/`messageId` 供客户端定位 Chat 节点。
- `text` 用于复制，`snippet` 用于展示；`textTruncated` 表示复制文本被截断；`matchCount` 是这条消息内的命中数。
- `truncated` 表示消息数、单消息计数或总命中任一触顶。

失败：

```json
{ "ok": false, "error": { "code": "denied", "message": "只能搜索已注册工作区内的目录" } }
```

| 状态 | code | 触发 |
|---|---|---|
| 400 | `invalid-pattern` | 空查询、超过 300 字符、非法正则 |
| 401 | `forbidden` | `connection.requestRejection` 返回 401 |
| 403 | `forbidden` | 跨站、异源 Origin、认证检查抛错、非回环非 GET |
| 403 | `denied` | 显式 root 越界；rg 不可用/启动失败 |
| 404 | `not-found` | 会话不存在或尚未落盘 |
| 422 | `bad-root` | 目录不存在、无工作区可搜索 |
| 422 | `bad-session` | 缺少或非法的会话 id |
| 500 | `internal` | 未归类异常（含会话日志损坏） |
| 503 | `auth-unavailable` | 缺 `connection` 或没有 `requestRejection` |
| 503 | `unavailable` | 宿主没有 `sessionQuery` 服务 |
| 504 | `timeout` | 读取会话日志超过 8 秒 |

## 不变量

- 认证 fail-closed；任何“无法判断调用者”的分支都拒绝，不放行。
- 根目录只来自会话/注册工作区；显式 root 必须二次校验。
- 路由只读；没有写文件、改工作区、执行命令的能力。
- 插件身份多处同步（见 `AGENTS.md`）；改路由前缀必须同时改客户端、patch、loader id、slot/key。
- 版本只来自 `package.json`；`/version` 的返回值由测试守住。
- 用户可见文案只来自 locale 字典。

## 测试缝

| 缝 | 方式 | 覆盖 |
|---|---|---|
| 搜索核心 | 直接 import `search.js` + 临时目录 | 解析、匹配、排序、上限、回退 walk |
| 会话核心 | 直接 import `conversation.js` + 事件 fixture | 提取规则、思考/工具排除、正则、摘录、上限、排序 |
| 宿主路由 | `apply()` + fake `webServer`/`effect`/`get`，捕获 handler 直接调用 | 栅栏、根解析、会话观察、envelope、错误映射 |
| 浏览器半 | `vm.runInNewContext(client.js)` + fake React/localStorage | 注册、外观偏好、主题跟随、范围切换、标题匹配、消息复制、字典 |
| 认证集成 | 真实 loopback HTTP + 6 种 `connection` | 缺服务、null、抛错、拒绝、放行、跨站 |

## 非目标

- 不建索引、不做增量索引、不常驻文件监听。
- 不遵守 `.gitignore`；排除表是显式产品选择。
- 不提供写操作、替换、重构或命令执行。
- 不引入服务端会话状态；文件名列表缓存与会话提取缓存都只是进程内短期缓存。
- 不做跨会话内容全文检索；会话范围只是“当前会话标题 + 当前会话内容”。
- 不修改 Chat 的 DOM 或状态；消息定位是只读锚点 + `loadThrough` 的 best-effort，失败回退复制。
- 不搜索思考过程、工具调用/结果或系统提示；这是有意的产品边界。
