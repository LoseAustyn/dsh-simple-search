# simple-search AI 工程化规范规划

状态：implemented（P0 + P1，2026-11-19）
日期：2026-11-19
范围：`/home/chen/Projects/dsh-plugins/simple-search`（独立 Git 仓库 `dsh-simple-search`）
参考：`/home/chen/Projects/deepseek-harness` 的 `AGENTS.md`、`.agents/skills/`、`.agents/notes/`、`lefthook.yml`、`.claude/skills` 软链、`docs/AGENTS.md`

> 落地说明：本文件保留为提案背景；当前规范以 `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、`docs/SECURITY.md` 与 `docs/decisions/` 为准。源码已随本次提交落地；未推送、未重装宿主，实时 `/version` 仍可能由旧宿主模块返回，重装/重启后应返回 `1.2.1`。

## 2. 现状审计（落地前）

## 1. 结论先行

目标不是给仓库补几份说明，而是把“一个 AI 拿到这个仓库后能稳定做对事”变成可执行契约：

1. **一个入口**：根 `AGENTS.md` 说明读什么、跑什么、什么不能破坏；详细内容按需下钻。
2. **一个命令**：`npm run check` 覆盖语法、单测、版本一致性和认证栅栏，CI 跑同一入口。
3. **一套流程**：用 3 个 skill 固化“改代码 / 验收 / 发版”三条高频路径。
4. **一条边界**：认证、根目录约束、只读、插件身份四处一致，写成不变量并用测试守住。
5. **一份决策账**：影响架构或安全的选择落 ADR，避免下一个会话重新争论。

不照搬 harness 的完整体系（100% 覆盖率、快照、双语配对、190 行根指令、stacked PR），只保留其“单一事实源 + 可执行门禁 + 渐进披露”的骨架。

## 2. 现状审计

### 已有资产

| 资产 | 状态 |
|---|---|
| `index.js` / `search.js` / `client.js` | 宿主路由、搜索核心、浏览器半分开，JSDoc 较完整 |
| `tests/*.test.mjs` | 43 项 `node:test` 全绿，覆盖搜索核心、路由栅栏、客户端偏好 |
| `scripts/verify-auth-fence.mjs` | 真实 HTTP 6/6 场景通过，覆盖无 `connection`、null、抛错、跨站 |
| `README.md` / `README.zh-CN.md` | 行为、布局、安装、验证步骤齐全 |
| `package.json` | `exports`、`files`、`engines.dsh`、`repository`、MIT 齐备 |
| Git | 本地 `2b5066a` 与 `origin/main` 一致，工作区干净 |

验证记录（2026-11-19）：

```text
node --test                 43/43 pass
node --check index.js search.js client.js   ok
node scripts/verify-auth-fence.mjs          6/6, exit 0
npm pack --dry-run                          11 files
git ls-remote origin main                   2b5066a...
```

### 缺口

| 缺口 | 具体表现 | 对 AI 开发的后果 |
|---|---|---|
| 版本双源漂移 | `index.js` 的 `VERSION = '1.0.1'`，`package.json` 是 `1.2.1` | 路由自检返回旧版本，AI 会据此误判已加载代码 |
| 无命令入口 | `package.json` 没有 `scripts` | 每个会话都要从 README 拼命令，容易漏跑 |
| 无 CI | 无 `.github/workflows` | “我跑过了”只能靠口头证据，无法在推送时复核 |
| 无根 `AGENTS.md` | 新会话不知道宿主半重载规则、认证栅栏、身份四处一致 | 重复踩坑，或静默破坏安全不变量 |
| 无架构文档 | 3,000 行代码只能通读 | 上下文成本高，改动容易越界 |
| 无决策记录 | 安全栅栏、`--no-ignore-vcs`、无依赖测试等选择只存在于提交信息 | 后续会话可能“顺手简化”掉必要约束 |
| 无发布流程 | 版本、README 徽章、`index.js` 常量、tag 靠人记 | 发版不一致，回滚困难 |
| 测试约定未成文 | fake ctx、VM + fake React、真实 HTTP 三种模式混在测试里 | AI 可能引入 jsdom/Playwright 或重复桩件 |

## 3. 设计原则

1. **单一事实源**：版本只来自 `package.json`；插件身份以包名为准；测试清单以 `package.json` 的 `scripts` 为准。
2. **规则可执行**：能写成测试/脚本的，不写成散文；不能机械化的，写明人工步骤和“未验证”的标注方式。
3. **一个入口**：人和 AI 都先跑 `npm run check`；CI 复用同一命令，避免“本地绿、CI 红”。
4. **渐进披露**：`AGENTS.md` 只放每次会话都需要的规则；模块契约进 `docs/`；多步流程进 skill；长参考进 skill 的 `references/`。
5. **就近归属**：一条规则只写在一个地方，其他位置链接过去；测试规则放 `tests/AGENTS.md`，安全规则放 `docs/SECURITY.md`。
6. **验证诚实**：单元/集成能证明的写“已通过”；浏览器交互、真实安装效果必须标注“待用户确认”，不得用测试代替视觉验收。
7. **小仓库不建大体系**：不引入构建链、不强制 TypeScript、不要求覆盖率百分比；先解决“找不到、跑不对、说不清”。

## 4. 目标目录

```text
simple-search/
├── AGENTS.md                         # 根指令：读什么、跑什么、不能破坏什么（≤120 行）
├── CLAUDE.md -> AGENTS.md            # Claude Code 兼容软链
├── .claude/
│   └── skills -> ../.agents/skills   # 与 harness 相同的共享方式
├── .agents/
│   └── skills/
│       ├── simple-search-change/
│       │   ├── SKILL.md
│       │   └── references/
│       │       ├── reload-matrix.md
│       │       └── test-patterns.md
│       ├── simple-search-verify/
│       │   ├── SKILL.md
│       │   └── references/
│       │       └── security-checklist.md
│       └── simple-search-release/
│           └── SKILL.md
├── docs/
│   ├── ARCHITECTURE.md               # 模块契约、数据流、不变量
│   ├── DEVELOPMENT.md                # 环境、命令、重载矩阵、加测试
│   ├── SECURITY.md                   # 威胁模型、栅栏顺序、拒绝矩阵
│   ├── decisions/
│   │   ├── README.md                 # ADR 模板与索引
│   │   ├── 0001-fail-closed-auth.md
│   │   ├── 0002-no-ignore-vcs.md
│   │   └── 0003-plain-js-node-test.md
│   └── plans/
│       └── 2026-11-19-ai-engineering.md
├── scripts/
│   └── verify-auth-fence.mjs         # 已有
├── tests/
│   ├── AGENTS.md                     # 测试子域规则
│   ├── search.test.mjs
│   ├── route.test.mjs
│   └── client.test.mjs
├── .github/workflows/ci.yml
├── .editorconfig
├── CHANGELOG.md
└── package.json                      # 增加 scripts；版本唯一来源
```

`docs/plans/` 只放提案；提案落地后把结论迁到 `ARCHITECTURE.md` / `SECURITY.md` / `decisions/`，避免计划文档变成第二事实源。

## 5. AGENTS.md 规范

### 5.1 根 `AGENTS.md` 结构

建议控制在 120 行以内，按以下顺序写：

1. **一句话定位**：DSH Web UI bundle，双击 Shift 搜索工作区；宿主半 + 浏览器半。
2. **先读什么**：`docs/ARCHITECTURE.md`（改代码前）、`docs/SECURITY.md`（改路由/根目录前）、`docs/DEVELOPMENT.md`（装/调/验）。
3. **命令**：`npm run check`、`npm test`、`npm run check:auth`、单测过滤方式。
4. **不变量**（每条一行，链接测试）：
   - 身份四处一致：包名、patch row id、module loader id、路由前缀。
   - `/dsh-simple-search/*` 一律 fail-closed：缺 `connection` 返回 503，不得放行。
   - 搜索根只能来自会话 cwd 或已注册工作区；禁止 `process.cwd()`。
   - 路由只读，只接受 GET；错误用稳定的 `code`。
   - 结果上限、超时、跳过目录表由 `search.js` 拥有，不在调用方重复。
5. **模块地图**：一张 4 行表（`index.js` / `search.js` / `client.js` / `tests`），只写职责边界，不写实现细节。
6. **改动路由表**：改宿主半 / 浏览器半 / 搜索核心 / 清单/语言/图标，各自要读什么、跑什么、怎么重载。
7. **完成定义**：`npm run check` 绿；新增行为有对应测试；安装变更以 `application=applied` 且 `warnings=[]` 为准；浏览器交互标注“待用户确认”。
8. **风格**：ESM、无运行时依赖、JSDoc 写契约、注释解释“为什么”、不新增依赖除非有明确失败场景。
9. **决策去哪写**：架构/安全/测试策略变更写 `docs/decisions/`，不要只写在提交信息里。

写法约束：

- 每条规则自包含，但把细节链接到唯一归属。
- 命令必须是可复制的完整命令；不要写“运行相关测试”。
- 不写历史叙事、不写“当前正在做 X”；计划放 `docs/plans/`。
- 不重复 README 的用户安装说明，只链接。

### 5.2 子域 `AGENTS.md`

只在子域有独立规则时新增，避免把根文件拆碎：

| 文件 | 归属内容 |
|---|---|
| `tests/AGENTS.md` | `node:test`；禁止网络/真实浏览器；fake ctx；VM + fake React；临时目录清理；断言行为而非内部实现；新增测试必须能在修复前失败 |
| `docs/AGENTS.md`（可选，文档变多后） | 一事实一归属、当前状态、链接而非复述、ADR 模板 |
| `scripts/AGENTS.md`（可选） | 门禁脚本无副作用、退出码语义、默认不写工作区 |

### 5.3 兼容软链

```sh
ln -s AGENTS.md CLAUDE.md
mkdir -p .claude
ln -s ../.agents/skills .claude/skills
```

DSH 读取 `AGENTS.md` / `CLAUDE.md`（项目根到 cwd，嵌套文件在读取子目录后追加）；Claude Code 读取 `CLAUDE.md` 与 `.claude/skills`；`AGENTS.md` 同时服务 Codex 等遵循该约定的工具。三者共享一份内容，避免多套指令漂移。

## 6. Skills 规范

### 6.1 发现机制（已核实）

DSH 的项目级 skill 根按优先级为：

1. `<projectRoot>/.dsh/skills`（rank 100）
2. `<projectRoot>/.agents/skills`（rank 200）

`projectRoot` 是最近的含 `.git` 的祖先；`simple-search` 自己是 Git 仓库，所以在该目录工作时 `.agents/skills` 会被发现。skill 可以是 `<name>/SKILL.md` 目录包，也可以是 `<name>.md` 平铺文件；frontmatter 必填 `name`、`description`，可选 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`。上层目录的 `SKILL.md` 不会被递归发现，所以一个 skill 一个目录。

### 6.2 三个 skill

| Skill | 触发 | 产出 | 成功判据 |
|---|---|---|---|
| `simple-search-change` | 任何代码/测试/UI/清单改动 | 最小改动 + 对应测试 + 重载结论 | `npm run check` 绿；新测试在修复前能失败；安装类改动有 applied 证据 |
| `simple-search-verify` | 声称完成前、提交/推送前、评审时 | 按改动面选择的最小证据集 | 每条结论都有命令/观察支撑；未做的浏览器检查明确标注 |
| `simple-search-release` | 升版、打包、打 tag、发 GitHub Release | 版本/变更日志/包内容一致 | 版本单源、`npm pack` 内容正确、远端 SHA 复核、安装后路由自检通过 |

### 6.3 `simple-search-change`

frontmatter 示例：

```yaml
---
name: simple-search-change
description: Use when changing dsh-simple-search code, tests, routes, client UI, locale, or manifest, to identify the owning surface, implement the smallest change, run the right checks, and verify the installed bundle.
---
```

正文骨架：

1. **预检**：`git status --short --branch`；读根 `AGENTS.md` + `docs/ARCHITECTURE.md`；确认改动面。
2. **分面**：宿主路由 / 搜索核心 / 浏览器半 / 清单与语言 / 测试与脚本；每面在 `references/reload-matrix.md` 有“改什么、怎么生效、怎么验”。
3. **实现**：只改归属模块；跨面改动先改契约（JSDoc/README/docs），再改实现；不新增依赖除非写明失败场景。
4. **测试**：纯函数进 `search.test.mjs`；路由/栅栏进 `route.test.mjs`（fake ctx）；浏览器模块进 `client.test.mjs`（VM + fake React）；真实 HTTP 只进 `verify-auth-fence.mjs`。
5. **重载**：宿主半改完必须换目录名重装或重启宿主；浏览器半刷新页面；清单/语言/图标重装后刷新。
6. **报告**：改了什么、跑了什么、结果、未验证项。

`references/reload-matrix.md` 至少包含：

| 改动 | 生效方式 | 验证 |
|---|---|---|
| `index.js` / `search.js` | Node 按真实路径缓存；`link:` 包不会热更新。`remove_bundle` 后换新目录名 `install_bundle`，或重启宿主 | `curl .../version` 返回的版本/`pid` 变化；`npm run check:auth` |
| `client.js` | 刷新页面加载新模块；若 `pnpm run dev:web` 在跑，客户端 bundle 可热替换 | 页面双击 Shift；插件详情页外观卡 |
| `package.json` / `cordis.patch.yml` / `locale` / `icon.svg` | 重装 bundle + 刷新 | `install_bundle` 返回 `applied`、`warnings=[]`；插件页标题/图标 |
| `tests/` / `scripts/` | 无需重载 | `npm test` / `npm run check:auth` |

`references/test-patterns.md` 记录三种既有模式，防止 AI 引入新框架：

- 纯核心：直接 import，临时目录用 `mkdtemp`，结束清理。
- 路由：`apply()` + fake `webServer`/`effect`/`get`，捕获 handler 后直接调用，不监听端口。
- 客户端：`vm` 执行 `client.js`，fake React/localStorage，检查注册与渲染结果；不引入 jsdom。

### 6.4 `simple-search-verify`

正文骨架：

1. **选择证据**：按改动面查表，不默认跑全量；但认证/根目录/身份改动必须跑对应门禁。
2. **必跑项**：`npm run check`（语法 + 单测 + 版本 + 认证栅栏 + pack）。
3. **人工项**：刷新页面、双击 Shift、三 tab、Light/Dark/Follow DSH、Enter 打开文件；没做就写“未验证，需用户确认”。
4. **诚实规则**：不把“路由返回 401”当作“插件已加载”；不把“测试通过”当作“视觉通过”；不把“安装返回 applied”当作“交互通过”。
5. **输出格式**：`已通过` / `未验证` / `阻塞` 三类，附命令和关键输出。

`references/security-checklist.md` 把 `docs/SECURITY.md` 的检查项压缩成可勾选清单，供评审和改动前自检。

### 6.5 `simple-search-release`

正文骨架：

1. 确认分发方式：当前 `private: true` + profile `link:` 安装；若要走 npm，先改 `private`/`publishConfig` 并记录决策。
2. 版本：只改 `package.json`；`index.js` 从 `package.json` 读取版本（见第 8 节），不再手写常量。
3. 变更日志：`CHANGELOG.md` 的 Unreleased → 新版本；写用户可见行为和迁移说明。
4. 验证：`npm run check`；`npm pack --dry-run` 检查文件清单；安装到 web profile 后 `curl .../version` 与 `cordis_inspect_query` 确认。
5. Git：提交、`git tag vX.Y.Z`、`git push origin main --tags`，再用 `git ls-remote` 复核。
6. 报告：版本、tag、远端 SHA、包文件名、未验证项。

### 6.6 Skill 反模式

- 与 `AGENTS.md` 重复整段规则：skill 只写“怎么做”，standing rule 留在 `AGENTS.md`。
- 一个 skill 覆盖所有场景导致正文过长：按触发拆，长参考进 `references/`。
- 写成教程但没有成功判据：每个 skill 必须有可观察的完成条件。
- 复制 harness 的 `dsh-pre-push-checks` 全文：只保留与 3,000 行插件相关的证据选择。

## 7. Agents 规范

### 7.1 先澄清 DSH 的“agent”机制

本次安装的 DSH 版本没有提供按 `agents/*.md` 自动发现子代理的机制。实际机制是：

- **指令层**：`AGENTS.md` / `CLAUDE.md`，项目根到 cwd 逐级加载；这是“agent 的 standing orders”。
- **能力层**：skill，按 catalog 描述按需加载；这是“agent 的可复用流程”。
- **组合层**：agent preset，是安装到 profile 的 Cordis YAML bundle（`@deepseek-ai/dsh-agent-preset`），不是仓库文件；适合真正不同的工具/模型组合。
- **委派层**：`subagent` 工具按 prompt 启动子代理；未指定 preset 时沿用父代理当前的 preset revision，但不共享对话上下文，prompt 必须自包含。

因此本仓库的 “agents” 应落成 **AGENTS.md 链 + skills**，而不是新建一套仓库内 agent 定义。

### 7.2 推荐的 agent 角色划分

不建独立进程，先用 skill 固化角色职责：

| 角色 | 载体 | 职责 |
|---|---|---|
| 实现者 | `simple-search-change` | 定位归属、最小改动、补测试、重载 |
| 验收者 | `simple-search-verify` | 选最小证据、跑门禁、标注未验证 |
| 发布者 | `simple-search-release` | 版本、日志、打包、tag、远端复核 |

需要并行时再用 `subagent`，并在 prompt 里明确“先加载哪个 skill、只改哪些文件、返回什么证据”；不要把 `AGENTS.md` 整段复制进 prompt。

### 7.3 可选：真正的 agent preset（暂缓）

只有在出现“审查者需要只读工具集”“发布者需要独立模型/上下文”这类稳定需求时，才建一个本地 bundle：

```yaml
# simple-search-agents/cordis.patch.yml（示意，不在 P0 落地）
- insert:
    - id: preset-simple-search-reviewer
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: simple-search-reviewer
        name: Simple Search Reviewer
        description: Read-only review of dsh-simple-search changes.
        order: 20
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: You review dsh-simple-search changes. Load simple-search-verify first. Report evidence and unverified items.
          - id: tool-read
            name: '@deepseek-ai/dsh-tool-read'
```

代价：多一个 bundle、多一份 profile 状态、preset 变更只对新会话生效，且要维护工具清单。收益不明确前不做。

### 7.4 Agent 使用规则

- 单个子任务不分叉；只有独立、可并行、上下文可隔离的工作才用 `subagent`。
- 子代理返回“结论 + 证据 + 未验证项”，不返回过程日志。
- 主代理负责最终 diff 审查和 `npm run check`，不能把验收完全外包。
- 任何“用户人工确认”的步骤（浏览器视觉、真实安装效果）必须回到用户，不得由子代理声称通过。

## 8. 可执行门禁

### 8.1 `package.json` scripts

```json
{
  "scripts": {
    "test": "node --test tests/search.test.mjs tests/route.test.mjs tests/client.test.mjs",
    "check:syntax": "node --check index.js && node --check search.js && node --check client.js",
    "check:auth": "node scripts/verify-auth-fence.mjs",
    "check:pack": "npm pack --dry-run",
    "check": "npm run check:syntax && npm test && npm run check:auth && npm run check:pack"
  }
}
```

说明：

- 不做 `node --test` 裸跑，显式列文件，避免未来新增 fixture 被误当测试。
- `check:pack` 用 `--dry-run`，不产生 tgz；输出用于人工确认文件清单，CI 里也可 `--json` 断言必需文件。
- 若担心 `npm pack` 在 CI 产生噪音，可改为 `npm pack --dry-run --json` + 一个小断言脚本；P0 先用原命令。

### 8.2 版本单源修复（P0，先于其他文档）

当前 `index.js`：

```js
const VERSION = '1.0.1'
```

改为从 `package.json` 读取：

```js
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { version: VERSION } = require('./package.json')
```

路由保持返回 `VERSION`；在 `tests/route.test.mjs` 增加：

```js
it('reports the package version', async () => {
  const pkg = JSON.parse(await fsp.readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const { routes } = fakeContext({})
  const { body } = await call(routes.get('/dsh-simple-search/version'), '/dsh-simple-search/version')
  assert.equal(body.value.version, pkg.version)
})
```

这样版本只有一个事实源，且测试会在漂移时失败。本次没有另建 `scripts/verify-version.mjs`：route 测试已经覆盖同一不变量，再加脚本会维护第二个检查。

### 8.3 CI

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24.x
      - run: npm run check
```

- 不跑 `npm install`（零依赖）。
- Node 版本跟随 DSH 运行时；若声明 `engines.node >=22`，再加 22.x 矩阵，不要凭空承诺兼容。
- 私有仓库也可用；若不用 GitHub Actions，至少保留 `npm run check` 作为本地唯一入口。

### 8.4 可选 hooks

P0 不引入 lefthook。若需要提交前拦截：

```sh
git config core.hooksPath .githooks
```

`.githooks/pre-commit` 只跑 `npm run check:syntax` 和版本测试；`pre-push` 跑 `npm run check`。保持快，完整证据交给 CI。

### 8.5 测试归属

| 测试面 | 文件 | 允许 | 禁止 |
|---|---|---|---|
| 搜索核心 | `tests/search.test.mjs` | 临时目录、纯函数、真实文件系统 | 监听端口、浏览器 |
| 路由/栅栏/根解析 | `tests/route.test.mjs` | fake ctx、捕获 handler、直接调用 | 真实 HTTP（交给 auth 脚本） |
| 浏览器半 | `tests/client.test.mjs` | `vm`、fake React/localStorage | jsdom、Playwright、真实页面 |
| 认证集成 | `scripts/verify-auth-fence.mjs` | 真实 loopback HTTP、6 场景 | 依赖运行中的 DSH |

## 9. 文档与决策记录

### 9.1 `docs/ARCHITECTURE.md`

只写当前事实，建议 5 节：

1. **运行时拓扑**：浏览器 `client.js` → `/dsh-simple-search/*` → `index.js` → `search.js`。
2. **模块契约表**：每个文件的职责、输入、输出、失败码。
3. **请求流程**：`q/mode/regex/case/limit/root/sessionId` → `resolveRoot` → `searchWorkspace` → 响应 envelope。
4. **不变量**：认证 fail-closed、根目录约束、只读、上限/超时、身份四处一致。
5. **测试缝**：fake ctx、VM、真实 HTTP 三种 seams 的边界。

不写历史、不写“未来计划”、不复制 JSDoc 全文。

### 9.2 `docs/DEVELOPMENT.md`

- 前置：Node 版本、无需 `npm install`。
- 命令：`npm run check`、`npm test`、单文件/单名称过滤。
- 安装：profile `link:` 指向本目录；改宿主半/浏览器半的重载矩阵。
- 加测试：三种模式各一个最小示例，指向现有测试。
- 人工验收：双击 Shift、三 tab、外观卡、Enter 打开文件。

### 9.3 `docs/SECURITY.md`

- 威胁模型：本机回环、浏览器 cookie、跨站请求、未注册根目录。
- 栅栏顺序：Host 回环/trustedHosts → `sec-fetch-site` → Origin 同源 → `connection` 存在/类型 → `requestRejection` → 方法。
- 拒绝矩阵：缺服务 503、null 503、抛错 403、拒绝 401、跨站 403。
- 根目录规则：会话 cwd → 显式 root 必须在已注册工作区/会话目录内 → 最近工作区；禁止 `process.cwd()`。
- 评审清单：每条对应 `route.test.mjs` 或 `verify-auth-fence.mjs` 的断言。

### 9.4 `docs/decisions/`

轻量 ADR，不引入 harness 的 lifecycle/class 目录：

```markdown
# 0001 路由认证 fail-closed

Status: accepted
Date: 2026-11-19

## Context
## Decision
## Consequences
## Alternatives
```

建议先补三条，都是本次审计中“看起来可以简化、其实不能”的选择：

- `0001-fail-closed-auth.md`：缺 `connection` 为什么必须 503，而不是跳过校验。
- `0002-no-ignore-vcs.md`：为什么搜索不遵守 `.gitignore`，以及排除表由谁维护。
- `0003-plain-js-node-test.md`：为什么保持零运行时依赖、`node:test` + VM，而不引入 TypeScript/jsdom。

### 9.5 `CHANGELOG.md`

Keep a Changelog 风格，`Unreleased` 常驻；发布 skill 负责把条目移到新版本标题下。它是用户可见行为的账本，不复制 commit 列表。

## 10. 分阶段落地

### P0：让 AI 不再靠猜（约 2–3 小时）

| 文件 | 动作 |
|---|---|
| `AGENTS.md` | 新增，按第 5.1 节结构，≤120 行 |
| `CLAUDE.md` | 软链到 `AGENTS.md` |
| `tests/AGENTS.md` | 新增测试约定 |
| `package.json` | 增加第 8.1 节 scripts；版本以它为准 |
| `index.js` | 删除手写 `VERSION`，改读 `package.json` |
| `tests/route.test.mjs` | 增加版本一致性测试 |
| `docs/ARCHITECTURE.md` | 新增，按第 9.1 节 |
| `docs/DEVELOPMENT.md` | 新增，按第 9.2 节 |
| `.github/workflows/ci.yml` | 新增，跑 `npm run check` |

验收：`npm run check` 绿；CI 绿；新会话只读 `AGENTS.md` 就能说出“宿主半怎么重载、认证为什么 fail-closed、改哪跑哪”。

### P1：固化高频流程（约 3–4 小时）

| 文件 | 动作 |
|---|---|
| `.agents/skills/simple-search-change/` | SKILL.md + reload matrix + test patterns |
| `.agents/skills/simple-search-verify/` | SKILL.md + security checklist |
| `.agents/skills/simple-search-release/` | SKILL.md |
| `.claude/skills` | 软链到 `../.agents/skills` |
| `docs/SECURITY.md` | 新增 |
| `docs/decisions/` | 模板 + 3 条 ADR |
| `CHANGELOG.md` | 初始化 |

验收：在一个新会话里，仅凭 skill 名称和 `AGENTS.md` 能完成一次“改客户端 → 刷新验证 → 声明未验证项”和一次“升版 → 打包 → 远端复核”。

### P2：可选增强

- `scripts/verify-identity.mjs`：机械检查包名/patch row/路由前缀/loader id 四处一致（解析 YAML/JS 有成本，先确认值得）。
- `.githooks/` 或 lefthook：提交前快速检查。
- Issue/PR 模板：只在开始接收外部贡献后加。
- Agent preset bundle：只在出现稳定角色隔离需求后加。
- 覆盖率门槛：只有在测试数量增长到无法靠“按面选证据”覆盖时再加。

## 11. 验收标准

- [ ] 新会话在 2 分钟内能从 `AGENTS.md` 找到模块地图、命令、三个不变量。
- [ ] `npm run check` 一条命令覆盖语法、43+ 单测、认证 6 场景、版本一致性、打包清单。
- [ ] CI 对每次 push/PR 跑同一命令，且不依赖 `npm install`。
- [ ] 改 `index.js` 的人知道必须换目录名重装/重启；改 `client.js` 的人知道刷新即可。
- [ ] 任何新增路由都有：`inject` 声明、fence、根目录约束、拒绝场景测试。
- [ ] 版本只存在于 `package.json`；`/dsh-simple-search/version` 返回一致值。
- [ ] 3 个 skill 都有明确触发、步骤、成功判据；没有与 `AGENTS.md` 重复的整段规则。
- [ ] 浏览器/视觉/真实安装效果在未人工确认时标注为“待验证”，不以测试替代。
- [ ] 架构/安全/测试策略的“为什么”能在 `docs/decisions/` 找到，而不是只存在于提交信息。

## 12. 取舍与风险

| 风险 | 处理 |
|---|---|
| 文档/技能过多导致漂移 | 一条规则一个归属；`AGENTS.md` 只链接；季度删减一次 |
| skill 与 `AGENTS.md` 重复 | skill 只写步骤和判据，standing rule 留在 `AGENTS.md` |
| CI 对私有仓库不可用 | `npm run check` 保持为唯一入口；本地 hook 兜底 |
| 版本单源改动影响打包 | `package.json` 一定在 `files` 中；测试覆盖路由返回值 |
| 引入 TypeScript/lint 的诱惑 | 先不引入；等出现具体类型/风格失败再评估，避免为工具而工具 |
| agent preset 增加 profile 状态 | 暂缓；先用 skill 角色划分，出现稳定隔离需求再建 bundle |
| 人工验收被跳过 | 验收 skill 强制三分类输出；未确认项不得写成已通过 |

## 13. 参考映射（harness → simple-search）

| harness 做法 | 本仓库适配 | 不照搬的原因 |
|---|---|---|
| 根 `AGENTS.md` + `CLAUDE.md` 软链 | 同构，压到 ≤120 行 | 仓库只有 3,000 行，不需要 189 行 standing orders |
| `.agents/skills/` + `.claude/skills` 软链 | 同构，3 个 skill | 只保留高频路径，避免 20+ skill 的目录噪音 |
| `.agents/notes/` 生命周期/分类 | `docs/decisions/` 轻量 ADR | 决策量不足以维护 proposed/implemented/rejected 树 |
| `lefthook.yml` | CI + 可选 `.githooks` | 零依赖仓库不必引入 Node 工具链 |
| `scripts/run-gates.ts` 聚合门禁 | `npm run check` | 无需自建 gate runner |
| 100% 覆盖率 + 快照 + 双语配对 | `node:test` + 认证集成 | 规模不匹配，收益低于维护成本 |
| agent preset bundle | 暂缓，先 skill 分角色 | 单插件无需独立工具/模型组合 |

---

本文件是提案。P0 落地后，把“当前结构/命令/不变量”迁入 `AGENTS.md` 与 `docs/`，本文件保留在 `docs/plans/` 作为决策背景，不再更新为现状文档。
