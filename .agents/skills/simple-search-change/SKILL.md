---
name: simple-search-change
description: "Use when changing dsh-simple-search source, tests, routes, client UI, locale, or manifest; identifies the owning surface, applies the smallest change, runs the right checks, and verifies the installed bundle."
---

# Simple Search 改动流程

适用于本仓库的各类代码修改。项目级规范见根目录 `AGENTS.md`，这里只列出具体执行步骤。

## 1. 改动前检查

```sh
git status --short --branch
npm run check
```

- 如果 `npm run check` 已经失败，先记录失败命令和首个报错并停止，不要在坏基线上继续改代码。
- 动手前先明确这次改动的影响范围和预期效果（服务端可见 / 前端页面可见 / 仅内部实现）。
- 涉及路由、鉴权或搜索根目录解析时，先阅读 `../../../docs/SECURITY.md`。

## 2. 确定归属模块

| 改动内容 | 主要文件 | 对应测试 |
|---|---|---|
| 路由、鉴权、目录解析、统一响应格式 | `index.js` | `tests/route.test.mjs` + `npm run check:auth` |
| 搜索、匹配、排序、上限、排除目录 | `search.js` | `tests/search.test.mjs` |
| 会话文本提取、思考/工具过滤、会话上限 | `conversation.js` | `tests/conversation.test.mjs` |
| 搜索面板、双击 `Shift`、范围切换、外观卡、交互 | `client.js` | `tests/client.test.mjs` |
| 清单、locale、图标、打包内容 | `package.json`、`cordis.patch.yml`、`locale/`、`icon.svg` | `npm run check:pack` |
| 测试与检查脚本 | `tests/`、`scripts/` | 对应测试命令 |

如果改动跨模块，先对齐契约（JSDoc 与 `docs/ARCHITECTURE.md` 中的响应/错误表），再修改实现和调用方。

## 3. 编码要求

- 只改归属模块，不要顺手重构无关代码。
- 非显而易见的接口契约用 JSDoc 写清楚；注释说明「为什么这样做」，不记录修改历史。
- 错误保持稳定 `code`，不要增加「看起来合理」的静默兜底。
- 搜索根目录不能默认回退到 `process.cwd()`；显式传入的 `root` 必须经过已注册工作区校验。
- 新增用户可见文案时，同一次改动里同步补齐 `locale/zh.json` 和 `locale/en.json`。
- 新增路由时，同时补齐 `inject` 声明、鉴权拦截、目录约束和拒绝场景测试。
- 浏览器端不得读写文件系统或自行处理服务端鉴权，只通过相对路由携带同源 cookie 请求。
- 保持零运行时依赖；如确需新增，先在改动说明中写清现有实现无法解决的具体场景。

## 4. 补充测试

- 搜索与会话核心 → `tests/search.test.mjs` / `tests/conversation.test.mjs`；路由与鉴权 → `tests/route.test.mjs`；浏览器端 → `tests/client.test.mjs`。
- 需要真实本地 HTTP 服务的鉴权测试只加在 `scripts/verify-auth-fence.mjs`，不要在单元测试里监听端口。
- 写完新测试后，先确认它在代码修复前会失败（修之前跑一次，或临时回退断言验证）。
- 新增测试文件需加入 `package.json` 的 `test` 脚本。
- 测试风格遵循 `../../../tests/AGENTS.md`，不引入 jsdom、Playwright 或网络请求。

## 5. 重载与生效

| 改动文件 | 生效方式 | 验证手段 |
|---|---|---|
| `index.js` / `search.js` / `conversation.js` | 重启宿主，或改目录名重新安装 | `/dsh-simple-search/version` 的版本号或 `pid` 变化；`npm run check:auth` |
| `client.js` | 刷新页面（`dev:web` 运行时支持热替换） | 双击 `Shift`、范围切换、`Alt+Enter` 引用与外观卡 |
| 清单 / locale / 图标 | 重新安装 bundle 并刷新页面 | `install_bundle` 返回 `applied` 且 `warnings=[]`；检查插件页 |
| 测试 / 脚本 | 无需重载 | 运行对应命令 |

服务端代码改完后，单测通过不代表运行中的页面已经生效，必须通过 `/version` 确认或重启宿主。

## 6. 最终检查与汇报

```sh
npm run check
```

涉及安装变动时，使用 `plugin_manager` 的 `install_bundle` 安装后确认 `application=applied` 且 `warnings=[]`；若当前环境没有该工具，明确注明「未做安装验证」。

汇报固定包含三段：

```text
已修改：  改动的文件与行为说明
已验证：  npm run check、单测、鉴权 6/6、安装或 /version 检查结果
待确认：  浏览器交互、视觉样式或真实安装效果（需用户亲自确认）
```

不要把「单测通过」写成「页面已通过」。

## 完成标准

- `npm run check` 全部通过。
- 新增行为有对应测试，且确认过修复前会失败。
- 服务端或前端的重载状态交代清楚（已验证或明确标注待验证）。
- 没有削弱鉴权、目录边界、只读限制或上限相关的约束。

## 何时停下

- 改动前基线检查已经失败且原因不明。
- 为了让测试通过需要放宽鉴权或目录边界断言。
- 改动涉及新增运行时依赖、调整分发方式或修改 profile 配置。
- 用户可见行为存在歧义（先向用户确认，不要自行猜测）。

## 参考文档

- `references/reload-matrix.md`
- `references/test-patterns.md`
- `../../../docs/ARCHITECTURE.md`
- `../../../docs/DEVELOPMENT.md`
- `../../../AGENTS.md`
