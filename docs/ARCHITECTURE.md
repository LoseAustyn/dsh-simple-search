# Architecture

当前状态的说明，不是提案。架构或安全决策变化时同步更新本文件。

## 运行时拓扑

```text
DSH 页面
├── client.js
│   ├── shell.overlay          双击 Shift、搜索框、结果列表
│   ├── plugins.bundle.config  插件详情页的外观卡
│   └── fetch(GET, same-origin)
│         /dsh-simple-search/version
│         /dsh-simple-search/search
└── index.js（宿主半）
    ├── 信任栅栏（Host 解析、sec-fetch-site、Origin、connection.requestRejection）
    ├── resolveRoot（会话 cwd / 显式 root / 最近工作区）
    └── searchWorkspace（search.js）
          ├── rg（优先）
          └── bounded walk（回退）
```

`client.js` 通过 `document.baseURI` 解析相对路由，`credentials: 'same-origin'` 携带页面自己的认证 cookie。插件不保存、不读取凭据。

## 模块契约

| 文件 | 契约 | 边界 |
|---|---|---|
| `index.js` | 导出 `name`、`inject=['webServer','connection']`、`apply(ctx)`；注册两条 exact 路由；返回 `{ok,value}` 或 `{ok:false,error:{code,message}}` | 不实现搜索算法，不读 DOM |
| `search.js` | 导出限制常量、`SearchError`、匹配/排序/引擎函数、`searchWorkspace(request)` | 不依赖 `ctx`、HTTP、浏览器；不读环境 cwd 作为搜索根 |
| `client.js` | `__ModuleLoader__.load({id:'dsh-simple-search', factory})`；注册 `shell.overlay` 与 `plugins.bundle.config`；`inject=['slots','locale']` | 不做宿主认证，不直接读文件系统 |
| `tests/*.mjs` | `node:test` 行为测试；见 `tests/AGENTS.md` | 不依赖真实浏览器或运行中的 DSH |
| `scripts/verify-auth-fence.mjs` | 真实 loopback HTTP 的认证集成，6 个场景 | 不依赖运行中的 DSH |

## 请求流程

1. 双击 Shift 打开浮层；输入经防抖后构造查询参数：`q`、`mode=text|files|all`、`regex=1`、`case=1`、`limit=300`（客户端常量 `RESULT_LIMIT`），有会话时加 `sessionId`。
2. `fetch` 相对路径，`AbortController` 取消上一请求；响应是 JSON envelope。
3. 宿主 `fence` 依次检查：Host 可解析 → `sec-fetch-site` 非 `cross-site` → `Origin` 与 Host 同源 → `connection` 存在且 `requestRejection` 是函数 → 调用 `requestRejection`（Host 权威与登录态由 Connection 服务判定）→ 非 GET 的非回环请求拒绝。
4. `resolveRoot` 决定搜索根（见下节）。
5. `searchWorkspace` 按模式执行：
   - `text`：优先 rg；不可用则 bounded walk。
   - `files`：优先 `rg --files`；不可用则 walk；结果缓存 10 秒。
   - `all`：先列文件名，再搜内容；`engine` 反映内容引擎。
6. `handleSearch` 返回 envelope；`SearchError` 映射为稳定状态码与 `code`。

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
| 422 | `bad-root` | 目录不存在、无工作区可搜索 |
| 500 | `internal` | 未归类异常 |
| 503 | `auth-unavailable` | 缺 `connection` 或没有 `requestRejection` |

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
| 宿主路由 | `apply()` + fake `webServer`/`effect`/`get`，捕获 handler 直接调用 | 栅栏、根解析、envelope、错误映射 |
| 浏览器半 | `vm.runInNewContext(client.js)` + fake React/localStorage | 注册、外观偏好、主题跟随、字典 |
| 认证集成 | 真实 loopback HTTP + 6 种 `connection` | 缺服务、null、抛错、拒绝、放行、跨站 |

## 非目标

- 不建索引、不做增量索引、不常驻文件监听。
- 不遵守 `.gitignore`；排除表是显式产品选择。
- 不提供写操作、替换、重构或命令执行。
- 不引入服务端会话状态；文件名列表缓存只是进程内短期缓存。
