# AGENTS.md

`dsh-simple-search` 是 DSH Web 的全局搜索插件：连按两次 `Shift` 即可搜索工作区文件名与内容、跨工作区会话标题，以及当前会话中双方可见的消息内容。服务端（Node）负责只读路由与检索，浏览器端（`client.js`）负责面板 UI、快捷键、范围切换和插件详情页的外观设置。

## 必读文档

- 修改代码前：先看 `docs/ARCHITECTURE.md`
- 涉及路由、鉴权或目录解析：先看 `docs/SECURITY.md`
- 本地安装、调试与验收：见 `docs/DEVELOPMENT.md`
- 多步骤流程：见 `.agents/skills/` 下的 `simple-search-change`、`simple-search-verify` 与 `simple-search-release`（DSH 会以当前工作目录最近的 `.git` 目录作为项目根，需在 `simple-search/` 目录内才能自动发现这些 skill）

## 常用命令

```sh
npm run check        # 语法检查 + 单元测试 + 鉴权集成检查 + 打包清单校验（提交前必跑）
npm test             # 仅运行单元测试
npm run check:auth   # 启动临时本地 HTTP 服务，验证 6 个鉴权场景
node --test tests/route.test.mjs
node --test --test-name-pattern 'version' tests/route.test.mjs
```

本仓库零运行时依赖，不需要 `npm install`。CI 与本地提交共用 `npm run check`。

## 核心约束

- **插件标识一致**：包名 `dsh-simple-search`、patch 行 ID 与 slot ID `simple-search`、模块加载器 ID `dsh-simple-search`、`plugins.bundle.config` 键名 `dsh-simple-search`、路由前缀 `/dsh-simple-search`、locale 命名空间 `simpleSearch`。改动其中任意一项都必须同步其余各处并重新安装。
- **鉴权默认拒绝（fail-closed）**：`inject` 必须声明 `connection`。当 `connection` 缺失或缺少 `requestRejection` 时，返回 `503 auth-unavailable`；校验抛出异常时返回 `403`；严禁在鉴权不可用时降级放行。
- **搜索目录受限**：搜索根目录只按「当前会话 cwd → 显式传入的 `root`（必须落在已注册工作区或会话目录内）→ 最近更新的已注册工作区」顺序解析，绝不能把进程 `process.cwd()` 当作默认根目录。
- **路由只读与稳定错误码**：所有路由只读，拒绝非回环的非 GET 请求。错误响应统一返回稳定 `code`：`auth-unavailable`（503）、`unavailable`（503）、`forbidden`（401/403）、`invalid-pattern`（400）、`denied`（403）、`bad-root`（422）、`bad-session`（422）、`not-found`（404）、`timeout`（504）、`internal`（500）。
- **上限常量集中管理**：文件搜索的命中上限、超时与排除目录由 `search.js` 统一维护（`MAX_*`、`SEARCH_TIMEOUT_MS`、`SKIP_DIR_NAMES`）；会话提取与匹配上限由 `conversation.js` 维护（`MAX_CONVERSATION_*`）。调用方不要各自复制一份。
- **版本号单一来源**：版本号只在 `package.json` 中维护，`index.js` 直接读取它，不要写死版本常量。
- **双语文案同步**：用户可见文案统一通过 `locale/{zh,en}.json` 和 `t()` 管理，中英文需在同一次改动中补齐。
- **零运行时依赖**：不引入新的运行时依赖；若确有必要，先在改动说明中写清现有方案无法解决的具体问题。

## 模块分工

| 文件 | 负责 | 不负责 |
|---|---|---|
| `index.js` | 注册本地路由、鉴权拦截、目录解析、读取会话日志、统一响应格式 | 具体搜索算法、会话文本提取 |
| `search.js` | ripgrep 调用与回退遍历、文件排序、匹配编译、上限控制、排除目录表、`SearchError` | HTTP、Cordis `ctx`、DOM |
| `conversation.js` | 提取双方可见消息（排除思考与工具调用）、会话内匹配、生成摘录、上限控制 | HTTP、Cordis `ctx`、文件系统 |
| `client.js` | 搜索面板、双击 `Shift`、`Tab` 切换范围、`Alt+Enter` 插入 `@` 引用（走会话公开输入接口）、外观设置卡、只读定位 Chat 锚点 | 服务端鉴权、文件系统读写、跨工作区标题索引、修改 Chat 或输入框 DOM |
| `tests/*.mjs` | 搜索核心、会话提取、路由与浏览器端行为单测 | 真实浏览器环境 |
| `scripts/verify-auth-fence.mjs` | 基于临时本地 HTTP 服务的鉴权集成测试 | 连接运行中的 DSH |

## 改动对照表

| 改动内容 | 先读文档 | 运行检查 | 生效与验收方式 |
|---|---|---|---|
| 服务端路由、鉴权、目录解析 | `docs/SECURITY.md` | `route.test.mjs` + `npm run check:auth` | 重启宿主或改目录名重装；核对 `/dsh-simple-search/version` 的版本号或 `pid` |
| 搜索核心、上限、排序 | `docs/ARCHITECTURE.md` | `search.test.mjs` | 同上（服务端模块） |
| 会话提取、思考/工具过滤、会话上限 | `docs/ARCHITECTURE.md`、`docs/SECURITY.md` | `conversation.test.mjs` | 同上（服务端模块） |
| `client.js`、范围切换、外观、交互 | `docs/DEVELOPMENT.md` | `client.test.mjs` | 刷新页面；人工确认双击 `Shift`、`Tab` 切换、`Alt+Enter` 引用及外观卡 |
| 清单、locale、图标 | `docs/DEVELOPMENT.md` | `npm run check:pack` | 重装 bundle 并刷新页面；检查插件页标题与图标 |
| 仅文档 / 测试 / 脚本 | 对应文档 | 受影响的检查命令 | 无需重载 |

## 验收标准

- `npm run check` 全部通过；新增行为需补充对应测试，并在修复前确认该测试能够触发失败。
- 安装类改动必须以 `install_bundle` 返回 `application=applied` 且 `warnings=[]` 为准，否则如实说明原因。
- 涉及浏览器交互、视觉样式或真实安装效果，在未由用户亲自确认前一律标注为「待验证」，不得写成「已通过」。
- 不把无关重构混入功能改动；不得删除或放宽与鉴权、目录边界、只读限制、上限控制相关的测试。

## 代码与文档风格

- 纯 ESM；2 空格缩进；单引号；JS 行尾不加分号（CSS 沿用现有风格）。
- 非显而易见的契约用 JSDoc 注明；注释解释「为什么这样做」，不记录修改历史。
- 保持模块边界：`search.js` 不引入 `ctx` 或 HTTP；`conversation.js` 不引入 `ctx`、HTTP 或文件系统；`index.js` 不复制搜索或提取逻辑。
- 新增测试遵循 `tests/AGENTS.md`，不引入 jsdom、Playwright 或网络请求。
- 文档默认以中文为主：`README.md` 与 `CHANGELOG.md` 为中文版，英文版对应 `README.en.md` 与 `CHANGELOG.en.md`，同一改动需同步更新双语版本。
- 会话消息定位只读取 Chat 的 `data-chat-anchor-key`（对应 assistant 的回复行；reasoning 行共用 `data-chat-node-key` 但不可见），并调用 `session.loadThrough`；不得修改 Chat 的 DOM 或状态，定位失败必须回退为复制消息。

## 设计决策与计划

- 架构、安全、测试策略背后的权衡记录在 `docs/decisions/`，背景提案放在 `docs/plans/`，不要只留在 commit message 里。
- 当前架构与操作方式以本文件及 `docs/` 根目录文档为准；`docs/plans/` 仅作历史背景参考。
