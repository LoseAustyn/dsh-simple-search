# 安全说明

`dsh-simple-search` 的服务端路由会将工作区文件内容与会话消息返回给浏览器，因此鉴权、目录边界与会话访问约束属于硬性安全边界，而非体验优化。

## 威胁模型

- **攻击面**：本机回环 HTTP 路由 `/dsh-simple-search/{version,search,conversation}`。
- **潜在调用方**：合法的 DSH 页面（携带页面登录 cookie）、本机其他进程、被诱导访问本地端口的第三方网页、DNS rebinding 页面。
- **保护资产**：工作区文件内容与路径、会话消息正文、工作区与会话元数据。
- **非目标场景**：远程多租户、公网直接暴露、跨操作系统用户隔离（不在当前插件契约范围内）。

## 信任链路

```text
浏览器页面
  │  Host / Origin / sec-fetch-site / cookie
  ▼
index.js 鉴权与同源拦截（fence）
  │  校验 Host 可解析、拒绝 cross-site、要求 Origin 同源
  ▼
connection.requestRejection
  │  校验 Host 权威（loopback / bind address / trustedHosts）
  │  校验浏览器登录态
  ▼
resolveRoot → searchWorkspace            sessionId 白名单 → sessionQuery.observeSession
  │  目录必须落在会话或已注册工作区内        │  仅通过宿主接口只读读取，防越权访问
  ▼                                        ▼
只读响应（文件内容）                       只读响应（用户提问 + 助手正文）
```

Host 权威列表由 DSH 的 `connection` 服务统一判定，插件不自行维护 `trustedHosts`。插件自身的 `fence` 负责把关：`Host` 可解析、`sec-fetch-site` 非 `cross-site`、`Origin` 与 `Host` 同源、`connection` 存在且具备 `requestRejection`、拒绝非回环的非 GET 请求。

## 拒绝策略矩阵

| 触发条件 | HTTP 状态码 | `code` | 处理方式 |
|---|---|---|---|
| `connection` 服务缺失 | 503 | `auth-unavailable` | 拒绝，绝不降级放行 |
| `connection` 为 `null` | 503 | `auth-unavailable` | 拒绝 |
| 缺少 `requestRejection` 方法 | 503 | `auth-unavailable` | 拒绝 |
| `requestRejection` 抛出异常 | 403 | `forbidden` | 拒绝 |
| `requestRejection` 返回 401 | 401 | `forbidden` | 透传状态码拒绝 |
| `requestRejection` 返回 403 或其他数字 | 原状态码 | `forbidden` | 透传状态码拒绝 |
| `Host` 无法解析为 URL | 403 | `forbidden` | 拒绝 |
| `sec-fetch-site: cross-site` | 403 | `forbidden` | 拒绝 |
| `Origin` 与 `Host` 不同源 | 403 | `forbidden` | 拒绝 |
| `Origin: null` | 403 | `forbidden` | 拒绝 |
| 非 GET 且 Host 非回环地址 | 403 | `forbidden` | 拒绝 |

只有当 `requestRejection` 明确返回 `undefined`、`null` 或 `false` 时才会放行。当 `connection` 服务不可用时，插件**不会**退化为「本机请求直接放行」。

## 搜索目录边界

1. **会话目录**：`sessionId` 通过白名单正则校验后，读取 `sessions.get(id)` → `workingDirectory.get(session)`，缺失时回退到 `session.header.cwd`，且 `realpath` 必须指向真实目录。
2. **显式 `root`**：经 `path.resolve` 与 `realpath` 解析后，必须落在会话目录或任一已注册工作区的 `realpath` 内部。
3. **默认目录**：取 `workspaceRegistry.list()` 中最近更新的已注册工作区。
4. **兜底行为**：以上均不可用时返回 `422 bad-root`，绝不回退到服务端 `process.cwd()`。

路径归属函数 `isWithin` 按路径段边界比较，而非字符串前缀。显式 `root` 虽先经 `path.resolve`，但后续仍受已注册工作区边界校验约束；前端实际只传绝对路径。

## 会话内容访问规则

1. `sessionId` 必须符合白名单正则（字母数字开头，长度 ≤200，仅含字母数字、`.`、`_`、`-`），否则返回 `422 bad-session`。
2. 仅通过宿主的 `sessionQuery.observeSession` 读取会话，不拼接路径，也不直接打开 `~/.dsh/sessions` 下的文件。
3. 只提取 `user/message` 中 `source.kind === 'user'` 的文本与 `assistant/message` 的 `text` 块；思考过程（`reasoning`）、工具调用/结果、系统/开发者消息与合成上下文一律过滤，不进入响应体。
4. 单次读取受 8 秒超时限制；最多扫描 5,000 条消息、保留 2,000,000 字符、返回 200 条命中，触顶时置 `truncated: true`。
5. 提取结果缓存最多保留 3 个会话，按日志 `cursor` 失效，仅驻留进程内存，不落盘也不跨进程共享。
6. 会话不存在返回 `404 not-found`，宿主缺少 `sessionQuery` 返回 `503 unavailable`，两种情况均不回退到直接读盘。
7. 消息跳转完全在浏览器端执行：只读查询 Chat 的 `data-chat-anchor-key` 并调用公开的 `session.loadThrough(seq)`，不修改 Chat 的 DOM 或状态；找不到锚点时仅复制文本。`turn`/`step`/`messageId` 原本就随会话事件下发到页面，不增加新的信息暴露面。

**会话标题**搜索同样在浏览器端完成，只读 `ctx.sessions.list` 的本地快照，不发额外网络请求。打开会话调用 `ctx.get('uiWorkspace').openSession(id)`，缺少该服务时仅复制会话 ID。

## 只读与资源上限

- 三条路由严格只读，不具备写文件、改工作区或执行命令的能力。
- `MAX_MATCHES`、`MAX_MATCHES_PER_FILE`、`MAX_LINE_CHARS`、`MAX_FILE_BYTES`、`MAX_VISITED`、`SEARCH_TIMEOUT_MS` 由 `search.js` 统一维护。
- `MAX_CONVERSATION_*` 由 `conversation.js` 维护，`CONVERSATION_TIMEOUT_MS` 由 `index.js` 维护。
- 触发超时或预算上限时返回 `truncated: true`，杜绝无界扫描。
- 响应体包含 `root` 绝对路径与会话 `cwd`（供页面展示和打开文件），不要将响应转发给不受信任的第三方。

## 已知限制

- 鉴权完全依托 DSH 的 `connection` 服务，插件不实现独立 token 机制。
- 未内置请求速率限制，同机同用户进程理论上可高频调用。
- 不对搜索结果做敏感信息脱敏，返回的是工作区与会话原文。
- 会话内容搜索强依赖宿主 `sessionQuery` 服务，缺失时整体返回 `503`，不降级读盘。
- 无法防范用户主动将页面 cookie 泄露给第三方等终端侧风险。
- 非回环或反向代理部署下的 Host 校验权威完全取决于 DSH `connection` 的 `trustedHosts` 与绑定配置。

## 改动路由时的核对要求

修改路由、鉴权或目录逻辑时，需逐项过 `.agents/skills/simple-search-verify/references/security-checklist.md`，并确认：

- `tests/route.test.mjs` 完整覆盖：缺服务、`null`、抛错、拒绝状态码透传、跨站与目录越界。
- 会话路由额外覆盖：缺 `sessionQuery`、非法 `sessionId`、会话不存在、观察超时，以及 `observeSession` lease 正确释放。
- `scripts/verify-auth-fence.mjs` 跑满 6/6；新增拒绝分支时补充对应场景。
- `/version` 同样经过完整鉴权拦截，不成为未认证探测接口。
- 新增错误分支均映射稳定 `code`，不向未授权调用方暴露内部异常堆栈或原文。
