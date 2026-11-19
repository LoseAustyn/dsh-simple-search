# Security

`dsh-simple-search` 的宿主路由会把工作区文件内容返回给浏览器，所以认证与根目录约束是安全边界，不是“体验优化”。

## 威胁模型

- 攻击面：本机回环 HTTP 路由 `/dsh-simple-search/{version,search}`。
- 调用者：DSH 页面（带页面认证 cookie）、同机其他进程、被诱导的浏览器页面、DNS rebinding 页面。
- 资产：工作区文件内容、文件路径、会话/工作区信息。
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
resolveRoot → searchWorkspace
  │  根必须来自会话或已注册工作区
  ▼
只读响应
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

## 只读与上限

- 两个路由只读；没有写文件、改工作区、执行命令的能力。
- `MAX_MATCHES`、`MAX_MATCHES_PER_FILE`、`MAX_LINE_CHARS`、`MAX_FILE_BYTES`、`MAX_VISITED`、`SEARCH_TIMEOUT_MS` 由 `search.js` 拥有。
- 超时/预算触发时返回 `truncated: true`，不是无界扫描。
- 响应包含 `root` 绝对路径（页面用于显示工作区与打开文件）；不要把响应转发给不受信任的第三方。

## 已知限制

- 认证完全依赖 DSH 的 `connection` 服务；插件不实现独立 token。
- 没有速率限制；本机同用户进程可以反复请求。
- 没有内容脱敏；搜索结果是工作区原文。
- 不防“用户自己把页面 cookie 交给他人”这类终端侧问题。
- 不覆盖非回环/反向代理部署；这类部署的 Host 权威由 `connection` 的 `trustedHosts`/bind 配置决定。

## 改动路由时的检查

逐项过 `.agents/skills/simple-search-verify/references/security-checklist.md`，并确认：

- `tests/route.test.mjs` 覆盖缺服务、null、抛错、拒绝直通、跨站、越界。
- `scripts/verify-auth-fence.mjs` 仍为 6/6；新增分支要加场景。
- `/version` 仍受同一栅栏保护，不能成为未认证的探测口。
- 新增错误分支有稳定 `code`，不把内部异常文本直接返回给未授权调用者。
