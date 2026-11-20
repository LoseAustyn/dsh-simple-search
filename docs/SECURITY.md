# Security

`dsh-simple-search` 的宿主路由会把工作区文件内容与会话消息内容返回给浏览器，所以认证与根目录/会话约束是安全边界，不是“体验优化”。

## 威胁模型

- 攻击面：本机回环 HTTP 路由 `/dsh-simple-search/{version,search,conversation}`。
- 调用者：DSH 页面（带页面认证 cookie）、同机其他进程、被诱导的浏览器页面、DNS rebinding 页面。
- 资产：工作区文件内容、文件路径、会话消息内容、会话/工作区信息。
- 非目标：远程多租户、公网部署、跨用户隔离；这些不在当前插件契约内。

## 信任边界

```text
浏览器页面
  │  Host / Origin / sec-fetch-site / cookie
  ▼
index.js fence
  │  解析 Host、拒绝 cross-site、Origin 同源
  ▼
connection.requestRejection
  │  Host 权威（loopback / bind address / trustedHosts）
  │  浏览器登录态
  ▼
resolveRoot → searchWorkspace            sessionId 白名单 → sessionQuery.observeSession
  │  根必须来自会话或已注册工作区          │  只读宿主日志，会话 id 不得越权
  ▼                                        ▼
只读响应（文件内容）                       只读响应（人类 prompt + assistant 正文）
```

Host 权威由 DSH 的 Connection 服务判定，插件不自行维护 `trustedHosts` 列表。插件自己的 fence 负责：Host 可解析、`sec-fetch-site` 非 `cross-site`、`Origin` 与 Host 同源、`connection` 存在且具备 `requestRejection`、非 GET 的非回环请求拒绝。

## 拒绝矩阵

| 条件 | 状态 | code | 处理 |
|---|---|---|---|
| `connection` 缺失 | 503 | `auth-unavailable` | 拒绝；不降级为“跳过校验” |
| `connection` 为 `null` | 503 | `auth-unavailable` | 拒绝 |
| 没有 `requestRejection` | 503 | `auth-unavailable` | 拒绝 |
| `requestRejection` 抛错 | 403 | `forbidden` | 拒绝 |
| `requestRejection` 返回 401 | 401 | `forbidden` | 原状态返回 |
| `requestRejection` 返回 403 或数字 | 原状态 | `forbidden` | 原状态返回 |
| Host 不能解析 | 403 | `forbidden` | 拒绝 |
| `sec-fetch-site: cross-site` | 403 | `forbidden` | 拒绝 |
| `Origin` 与 Host 不同源 | 403 | `forbidden` | 拒绝 |
| `Origin: null` | 403 | `forbidden` | 拒绝 |
| 非 GET 且 Host 非回环 | 403 | `forbidden` | 拒绝 |

`requestRejection` 返回 `undefined`/`null`/`false` 才表示放行。插件在 Connection 服务缺失时**不会**尝试“本机请求直接放行”。

## 根目录规则

1. 会话根：`sessionId` 通过白名单正则 → `sessions.get(id)` → `workingDirectory.get(session)`，回退 `session.header.cwd`；必须 realpath 成目录。
2. 显式 `root`：`path.resolve` + realpath；必须落在会话目录或任一已注册工作区的 realpath 内。
3. 默认根：`workspaceRegistry.list()` 中最近更新的已注册工作区。
4. 都没有 → `422 bad-root`；不退回宿主 `process.cwd()`。

`isWithin` 用路径段边界，不用字符串前缀。显式 root 的 `path.resolve` 会让相对路径先按宿主 cwd 解析，但随后仍必须通过已注册工作区校验；客户端实际发送绝对路径。

## 会话内容规则

1. `sessionId` 必须先通过白名单正则（字母数字开头，≤200 字符，只含字母数字、`.`、`_`、`-`），否则 `422 bad-session`。
2. 只通过宿主的 `sessionQuery.observeSession` 读取；插件不拼接会话文件路径、不直接打开 `~/.dsh/sessions`。
3. 只返回 `user/message` 中 `source.kind === 'user'` 的文本块与 `assistant/message` 的 `text` 块。`reasoning`（思考过程）、`tool-call`、`tool/result`、`system/developer` 与合成上下文一律不进入响应。
4. 观察带 8 秒超时；单次最多扫描 5,000 条消息、保留 2,000,000 字符并返回 200 条命中，超出置 `truncated`。
5. 会话提取缓存最多保留 3 个会话，按日志 `cursor` 失效；它不落盘、不跨进程共享。
6. 会话不存在 → `404 not-found`；宿主没有 `sessionQuery` → `503 unavailable`；两者都不回退到文件系统读取。
7. 内容命中跳转只在浏览器内进行：读取 Chat 的 `data-chat-anchor-key` 响应行锚点并调用公开的 `session.loadThrough(seq)`；不修改 Chat 的 DOM/状态，找不到锚点时只复制文本。`turn`/`step`/`messageId` 是页面已持有的会话元数据，不新增暴露面。

**会话标题**搜索在浏览器内完成：只读 `ctx.sessions.list` 已加载的目录快照，不发请求、不新增路由。打开选中会话调用 `ctx.get('uiWorkspace').openSession(id)`；没有该服务时只复制 id。

## 只读与上限

- 三条路由只读；没有写文件、改工作区、执行命令的能力。
- `MAX_MATCHES`、`MAX_MATCHES_PER_FILE`、`MAX_LINE_CHARS`、`MAX_FILE_BYTES`、`MAX_VISITED`、`SEARCH_TIMEOUT_MS` 由 `search.js` 拥有。
- `MAX_CONVERSATION_*` 由 `conversation.js` 拥有；`CONVERSATION_TIMEOUT_MS` 由 `index.js` 拥有。
- 超时/预算触发时返回 `truncated: true`，不是无界扫描。
- 响应包含 `root` 绝对路径与会话 `cwd`（页面用于显示工作区与打开文件）；不要把响应转发给不受信任的第三方。

## 已知限制

- 认证完全依赖 DSH 的 `connection` 服务；插件不实现独立 token。
- 没有速率限制；本机同用户进程可以反复请求。
- 没有内容脱敏；搜索结果是工作区原文与会话原文。
- 会话内容路由依赖宿主的 `sessionQuery`；缺失时整体不可用（`503`），不会退化成直接读日志文件。
- 不防“用户自己把页面 cookie 交给他人”这类终端侧问题。
- 不覆盖非回环/反向代理部署；这类部署的 Host 权威由 `connection` 的 `trustedHosts`/bind 配置决定。

## 改动路由时的检查

逐项过 `.agents/skills/simple-search-verify/references/security-checklist.md`，并确认：

- `tests/route.test.mjs` 覆盖缺服务、null、抛错、拒绝直通、跨站、越界。
- 会话路由额外覆盖：缺 `sessionQuery`、非法 `sessionId`、会话不存在、观察超时、`observeSession` 的 lease 被释放。
- `scripts/verify-auth-fence.mjs` 仍为 6/6；新增分支要加场景。
- `/version` 仍受同一栅栏保护，不能成为未认证的探测口。
- 新增错误分支有稳定 `code`，不把内部异常文本直接返回给未授权调用者。
