# AGENTS.md

`dsh-simple-search` 是 DSH Web UI 插件：双击 Shift 搜索工作区文件名与全文、跨工作区会话标题、以及当前会话的消息内容。宿主半（Node）提供只读路由，浏览器半（`client.js`）提供浮层、双击检测、范围切换和插件详情页外观卡。

## 先读

- 改代码前：`docs/ARCHITECTURE.md`
- 改路由、认证、根目录解析前：`docs/SECURITY.md`
- 装、调、验收：`docs/DEVELOPMENT.md`
- 多步流程：`.agents/skills/simple-search-change/SKILL.md`、`simple-search-verify`、`simple-search-release`（DSH 以 cwd 最近的 `.git` 祖先为 project root；在 `simple-search/` 内工作时才会发现这些 skill）

## 命令

```sh
npm run check        # 语法 + 单测 + 认证栅栏 + 打包清单；提交前必须绿
npm test             # 只跑单测
npm run check:auth   # 真实 loopback HTTP 的认证栅栏 6 场景
node --test tests/route.test.mjs
node --test --test-name-pattern 'version' tests/route.test.mjs
```

零运行时依赖，不需要 `npm install`。CI 跑 `npm run check`。

## 不变量

- **身份同步**：包名 `dsh-simple-search`；patch row id 与 slot id `simple-search`；module loader id `dsh-simple-search`；`plugins.bundle.config` key `dsh-simple-search`；路由前缀 `/dsh-simple-search`；locale NS `simpleSearch`。改一处要同步其余并重装。
- **认证 fail-closed**：`inject` 必须含 `connection`。缺服务或没有 `requestRejection` 返回 `503 auth-unavailable`；检查抛错返回 `403`；绝不“没有就放行”。
- **根目录约束**：搜索根只来自会话 cwd → 显式 `root`（必须在已注册工作区或会话目录内）→ 最近更新的已注册工作区。不得把 `process.cwd()` 当默认搜索根。
- **只读**：路由只读；非 GET 的非回环请求被拒绝。错误返回稳定 `code`：`auth-unavailable` 503、`unavailable` 503、`forbidden` 401/403、`invalid-pattern` 400、`denied` 403、`bad-root` 422、`bad-session` 422、`not-found` 404、`timeout` 504、`internal` 500。
- **上限归属**：结果上限、超时、跳过目录表由 `search.js` 拥有（`MAX_*`、`SEARCH_TIMEOUT_MS`、`SKIP_DIR_NAMES`）；会话提取与命中上限由 `conversation.js` 拥有（`MAX_CONVERSATION_*`）；调用方不要复制。
- **版本单源**：版本只来自 `package.json`；`index.js` 不得再写版本字面量。
- **文案双写**：用户可见文案走 `locale/{zh,en}.json` 与 `t()`；两种语言同一改动里补齐。
- **依赖克制**：不加运行时依赖；确需新增时，先在改动说明里写出当前实现的具体失败场景。

## 模块地图

| 文件 | 负责 | 不负责 |
|---|---|---|
| `index.js` | 路由、信任栅栏、根解析、会话观察、响应 envelope | 搜索算法、会话文本提取 |
| `search.js` | rg/walk、排序、匹配、限制、跳过表、`SearchError` | HTTP、ctx、DOM |
| `conversation.js` | 人类可见消息提取（排除思考/工具）、会话内匹配、摘录、会话上限 | HTTP、ctx、文件系统 |
| `client.js` | 浮层、双击 Shift、范围切换、对话框、外观卡、fetch、Chat 锚点定位（只读） | 宿主认证、文件系统、跨工作区标题索引、修改 Chat DOM |
| `tests/*.mjs` | 单元、路由、客户端测试 | 真实浏览器 |
| `scripts/verify-auth-fence.mjs` | 真实 loopback HTTP 认证集成 | 运行中的 DSH |

## 改动路由

| 改动 | 先读 | 跑 | 生效与验证 |
|---|---|---|---|
| 宿主路由、认证、根解析 | `docs/SECURITY.md` | `route.test.mjs` + `npm run check:auth` | 换目录名重装或重启宿主；`/dsh-simple-search/version` 的版本/`pid` 变化 |
| 搜索核心、限制、排序 | `docs/ARCHITECTURE.md` | `search.test.mjs` | 同上（宿主半） |
| 会话提取、思考/工具排除、会话上限 | `docs/ARCHITECTURE.md`、`docs/SECURITY.md` | `conversation.test.mjs` | 同上（宿主半） |
| `client.js`、范围切换、外观、交互 | `docs/DEVELOPMENT.md` | `client.test.mjs` | 刷新页面；双击 Shift、范围切换与外观卡人工确认 |
| 清单、locale、图标 | `docs/DEVELOPMENT.md` | `npm run check:pack` | 重装 + 刷新；插件页标题/图标 |
| 仅 docs/tests/scripts | 对应文档 | 受影响命令 | 无需重载 |

## 完成定义

- `npm run check` 绿；新增行为有对应测试，且测试在修复前能失败。
- 安装类改动以 `install_bundle` 返回 `application=applied`、`warnings=[]` 为准；否则写明原因。
- 浏览器、视觉、真实安装效果未由用户确认时，只能写“待验证”，不得写“已通过”。
- 不把无关重构混进行为改动；不删除或弱化认证、根目录、只读、上限相关测试。

## 风格

- ESM；2 空格；单引号；JS 行尾不加分号（CSS 除外，跟随现有文件）。
- JSDoc 写非显然契约；注释解释“为什么”，不写改动历史。
- 不在 `search.js` 引入 `ctx`/HTTP；不在 `conversation.js` 引入 `ctx`/HTTP/文件系统；不在 `index.js` 复制搜索或提取算法。
- 新增测试遵循 `tests/AGENTS.md`；不要引入 jsdom/Playwright 或网络依赖。
- 消息定位只读 Chat 的 `data-chat-anchor-key`（assistant 的 response 行；reasoning 行共用 node-key 但不可见）并调用 `session.loadThrough`；不得写 Chat 的 DOM/状态，找不到锚点必须回退复制。

## 决策与计划

- 架构、安全、测试策略的“为什么”写 `docs/decisions/`；提案写 `docs/plans/`。不要只写在提交信息里。
- 当前架构与命令以本文件和 `docs/` 为准；`docs/plans/` 是背景，不是现状。
