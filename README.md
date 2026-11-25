# 简单搜索（Simple Search）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![支持的 DSH 版本: 0.2.2-rc.2+](https://img.shields.io/badge/DSH-0.2.2--rc.2%2B-4d6bfe)](https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions)
[![开放插件市场](https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-simple-search.json)](https://dshopen.org/zh/plugins/dsh-simple-search/)

[English](README.en.md)

适用于 DSH Web 的全局搜索插件。在页面任意位置连按两次 `Shift`，即可呼出类似 JetBrains Search Everywhere 的搜索面板，支持三个搜索范围：

- **工作区文件**：同时搜当前工作区的文件名与文件内容，可在「全部 / 文件 / 文本」标签间切换。
- **会话标题**：跨工作区搜索已有会话（匹配标题、工作区目录名与会话 ID），回车直接打开，必要时自动切换工作区。
- **本会话**：搜索当前对话记录，只匹配你的提问与助手的正文回复，自动跳过思考过程、工具调用和系统提示词。

每次呼出面板都会默认全选上一次的搜索词，直接输入或粘贴即可替换。结果按文件分组并高亮匹配片段，面板底部显示当前工作区路径、命中数、搜索引擎及耗时。

## 快捷键

| 按键 | 作用 |
|---|---|
| `Shift` × 2 | 打开搜索面板（400 ms 内连按两次；按住 `Shift` 或输入大写字母不会误触） |
| `Tab` / `Shift+Tab` | 在「工作区文件 → 会话标题 → 本会话」之间循环切换（焦点在搜索框时） |
| `↑` / `↓` | 上下选择结果 |
| `Enter` | 打开选中文件、切换到目标会话，或在对话视图中定位到该条消息 |
| `Alt+Enter` | 将选中项所在文件作为原生 `@路径` 引用插入当前对话输入框 |
| `Esc` | 关闭面板 |

面板内快捷键仅在面板打开期间生效，不会占用对话输入框原本的 `Shift+Enter` 换行等按键。

## 安装

本插件无运行时依赖，不需要执行 `npm install`。

- **开放插件市场**：前往 [DSH 开放插件市场](https://dshopen.org/zh/plugins/dsh-simple-search/) 查看安装说明。
- **本地目录安装**：克隆或下载本仓库后，在 DSH Web 的 **插件 → 添加插件** 中选择 `simple-search` 目录；或在终端执行：
  ```sh
  dsh plugin --profile web add /path/to/simple-search
  ```
  使用命令行添加后，重启一次 DSH 即可加载。

## 功能说明

### 文件与全文搜索

- **搜索引擎**：全文搜索优先调用本地 ripgrep（DSH 自带的 `@vscode/ripgrep`、`PATH` 中的 `rg`，或 `DSH_SIMPLE_SEARCH_RG` 指定的路径）；若环境中没有 ripgrep，则自动回退到内置的 Node.js 目录遍历，无需额外配置也能正常使用。
- **匹配与排序**：支持区分大小写（`Aa`）和正则表达式（`.*`）。文件名列表在输入期间缓存 10 秒，按「完整文件名 → 文件名子串 → 路径子串 → 模糊子序列」打分排序（例如输入 `htexec` 即可搜到 `http-executor.ts`）。「全部」标签会在一次请求内同时返回文件名与文本结果。
- **不遵循 `.gitignore`**：许多多仓库工作区会在根目录 `.gitignore` 中忽略所有子仓库。为了能搜到子仓库代码，插件默认开启 `--no-ignore-vcs`，改为统一排除 `.git`、`node_modules`、`dist`、`.venv*`、各类缓存和 `.dsh-memory` 等目录。
- **打开或复制路径**：配合 `better-sidebar` 插件使用时，点击或按 `Enter` 会在侧栏编辑器中直接打开文件（文本命中会精确跳到对应行）；未安装该插件时，则自动复制 `path` 或 `path:line` 并关闭面板。
- **插入 `@` 文件引用**：选中文件名或某条代码命中后按 `Alt+Enter`，对应文件会以 DSH 原生 `@路径` 引用（路径含空格时自动加引号写作 `@"路径"`）插入当前对话输入框，随后关闭面板并将焦点切回输入框。若当前没有打开的会话，或草稿处于不可编辑状态，则回退为复制 `@路径` 文本。

### 会话与当前对话搜索

- **跨工作区会话标题**：直接在浏览器端检索页面已加载的会话列表，无需后端请求即可覆盖全部工作区；空白占位会话与 subagent 子会话会自动过滤，结果按最近更新时间倒序排列。
- **当前对话全文**：「本会话」由服务端读取已提交的会话日志，因此能够搜到当前滚动加载窗口之外的早期历史消息（单次最多扫描最近 5,000 条消息、返回 200 条命中，超时上限 8 秒）。按 `Enter` 会在 Chat 视图中自动加载并滚动到对应消息；若当前不在 Chat 视图或无法定位锚点，则复制整条消息文本。

### 外观设置

在 **插件 → 简单搜索** 详情页的「外观」卡片中，可选择 **浅色**、**深色** 或 **跟随 DSH**（配置保存在浏览器 `localStorage` 中）。设为「跟随 DSH」时，面板配色、光标与滚动条会随 DSH 主题或系统深浅色切换实时更新。

## 安全边界

插件在本地注册了三条只读路由：`/dsh-simple-search/version`、`/dsh-simple-search/search` 与 `/dsh-simple-search/conversation`。

- **默认拒绝（Fail-closed）**：所有路由均接入 DSH 的 `connection` 鉴权与同源校验，仅放行携带页面有效登录 cookie 的同源请求。若运行环境未启用 `connection` 服务，插件不会挂载，路由也会直接返回 `503 auth-unavailable`，绝不降级放行。
- **访问范围受限**：文件搜索严格限制在已注册工作区或当前会话的工作目录内；对话内容仅通过宿主的 `sessionQuery` 接口按会话读取，不直接访问底层日志文件。

完整的威胁模型与拒绝策略见 [docs/SECURITY.md](docs/SECURITY.md)。

## 开发与验证

| 路径 | 职责 |
|---|---|
| `index.js` | Node 服务端入口：注册本地只读路由、同源与登录态校验、工作区根目录解析 |
| `search.js` | 文件搜索核心：ripgrep 调用与回退遍历、排除目录表、匹配编译与文件名排序 |
| `conversation.js` | 对话搜索核心：提取双方可见文本、过滤思考与工具记录、生成命中摘录 |
| `client.js` | 浏览器端入口：搜索面板 UI、双击 `Shift` 检测、范围切换、`@` 引用插入与外观设置卡 |
| `tests/*.test.mjs` | 基于 `node:test` 的单元测试（覆盖搜索算法、对话提取、路由鉴权与前端状态） |
| `scripts/verify-auth-fence.mjs` | 基于临时本地 HTTP 服务的 6 场景鉴权集成检查（无需启动 DSH） |

常用检查命令（CI 执行同一入口）：

```sh
npm run check        # 语法检查 + 单元测试 + 鉴权集成检查 + npm pack 清单校验
npm test             # 仅运行单元测试
npm run check:auth   # 运行 6 个本地 HTTP 鉴权场景（期望 6/6 通过）
```

本地联调提示：

- 修改 `client.js` 后，刷新浏览器页面即可加载新模块。
- 修改 `index.js`、`search.js` 或 `conversation.js` 后，由于 Node.js 会按真实路径缓存 `link:` 方式安装的模块，原地重装不会刷新服务端代码——请重启 DSH，或修改目录名后重新安装（「本会话」范围依赖 `/dsh-simple-search/conversation` 路由，升级后若未重载服务端会提示路由不存在）。

架构细节、重载矩阵与历史设计决策见 [docs/](docs/)（[ARCHITECTURE.md](docs/ARCHITECTURE.md)、[DEVELOPMENT.md](docs/DEVELOPMENT.md)、[decisions/](docs/decisions/)），面向 Agent 的开发约束见 [AGENTS.md](AGENTS.md)。
