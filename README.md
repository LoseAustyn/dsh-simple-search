# 简单搜索（Simple Search）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![支持的 DSH 版本: 0.2.2-rc.2+](https://img.shields.io/badge/DSH-0.2.2--rc.2%2B-4d6bfe)](https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions)
[![开放插件市场](https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-simple-search.json)](https://dshopen.org/zh/plugins/dsh-simple-search/)

[English](README.en.md)

一个 DSH Web UI 插件：在页面任意位置**双击 Shift**，即可打开 JetBrains 风格的**简单搜索**面板，提供三个搜索范围：

- **工作区文件**：搜索当前工作区的**文件名**与**每个文件的内容**，提供「全部 / 文件 / 文本」三个标签页；`Enter` 在侧栏卡片编辑器中打开选中项（文本命中会定位到对应行）。
- **会话标题**：**跨工作区**搜索会话标题（同时匹配标题、工作区目录名与会话 id）；`Enter` 打开该会话，需要时切换到对应工作区。
- **本会话**：搜索**当前对话的内容**，只包含双方实际看到的文字——你输入的消息与助手可见的回复；思考过程、工具调用/结果、合成上下文与系统提示都不参与。`Enter` 在 Chat 视图中定位到该条消息（必要时先加载更早历史）；找不到 Chat 锚点时回退为复制整条消息。

`↑`/`↓` 切换结果，`Tab` / `Shift+Tab` 循环切换三个范围，`Esc` 关闭。打开面板时会选中上一次的查询，直接输入或粘贴即可替换。

有会话打开时，在面板里选中一个文件（或文件内的文本命中），按 **`Alt+Enter`** 即可把该文件作为 DSH 原生 `@` 引用插入当前会话输入框；面板关闭，焦点回到输入框。

## 功能

- 双击判定为 400 ms 内两次干净的 Shift 按键：按住 Shift 或输入 `Shift`+字母不会误触发。
- 内容搜索由宿主执行：优先使用可解析到的随包 ripgrep（`@vscode/ripgrep`、`PATH` 上的 `rg`，或 `DSH_SIMPLE_SEARCH_RG`）；不可用时回退到有界的 Node.js 遍历，没有 ripgrep 也能工作。
- 文件名搜索会列出工作区文件（输入时缓存 10 秒），排序使用 JetBrains 风格评分：完全匹配 basename、basename 子串、路径子串，最后是模糊子序列（例如 `htexec` 能找到 `http-executor.ts`）。「全部」在一次请求中返回两类结果。
- **不应用** `.gitignore` 规则（`--no-ignore-vcs`）：很多工作区是忽略所有子仓库的根仓库，JetBrains 风格搜索需要能看到子仓库内部。改为显式排除重目录（`.git`、`node_modules`、`dist`、`.venv*`、缓存、`.dsh-memory`），两种引擎共用同一份排除表。
- 支持大小写敏感（`Aa`）与正则表达式（`.*`）开关。
- 会话标题在浏览器内匹配页面已加载的会话目录，不需要宿主往返，天然覆盖所有工作区；空白占位与 subagent 子会话被排除，结果按最近更新排序。
- 本会话内容由宿主读取已提交的会话日志，因此能搜到加载窗口之外的历史消息。宿主路由 `/dsh-simple-search/conversation` 与文件路由共用同一套信任栅栏，并限制扫描（5,000 条消息）、返回（200 条命中）与观察时间（8 秒），提取结果按日志 cursor 缓存。思考块、工具调用/结果与系统提示不会进入搜索面。
- **从搜索面板插入 @ 文件引用**：在面板里选中文件名行或文件内的文本命中后按 `Alt+Enter`，该文件作为原生 DSH `@路径` 引用插入当前会话输入框（含空格的路径写作 `@"路径"`），面板关闭、焦点回到输入框。插入时光标位置来自会话输入框公开的 `inputActions`（`captureInsertion`，经 `conversation.input.overlay` 桥接），并走会话公开的输入面板，尊重草稿版本；没有打开的会话、或输入面板拒绝写入（草稿冻结、旧版 DSH）时改为复制 `@` 文本。该按键只存在于面板打开期间（面板自己的 keydown），不占用输入框的 `Shift+Enter` 换行。
- 焦点在搜索框时，`Tab` / `Shift+Tab` 按「工作区文件 → 会话标题 → 本会话」循环切换（反向同理）；点击范围标签仍然有效。
- 结果按文件分组并高亮命中文本；底部显示工作区根目录、命中/文件数量、引擎与耗时。
- 外观支持**浅色 / 深色 / 跟随 DSH** 三选一：在「插件 → 简单搜索」详情页的「外观」卡片中设置，选择保存在浏览器 `localStorage`（`dsh-simple-search:appearance`）。「跟随 DSH」读取 DSH 当前实际色板（`body[data-ds-dark-theme]`，并订阅 `theme/change`），DSH 切换主题或系统色板翻转时自动跟随；浅色/深色则固定面板配色。两套色板都由面板内的 CSS 变量驱动，并设置对应的 `color-scheme`，让光标、选中与滚动条跟随。
- 激活命中项（点击或 `Enter`）会打开文件**并关闭面板**。安装 better-sidebar 插件时，`Enter` 通过 `ctx.betterSidebar.openFile` 精确打开到行；其他部署会复制 `path:line`、显示短暂提示，稍后关闭。

## 文件结构

| 文件 | 作用 |
|---|---|
| `index.js` | 宿主半：回环路由 `/dsh-simple-search/version`、`/dsh-simple-search/search`（`mode=text|files|all`）与 `/dsh-simple-search/conversation`，工作区/会话根目录解析，浏览器信任栅栏。 |
| `search.js` | 可测试的搜索核心：ripgrep 参数与解析、回退遍历、跳过表、匹配器编译、文件列表与文件名排序。 |
| `conversation.js` | 可测试的会话核心：人类可见文本提取（人类 prompt + assistant 正文，排除思考与工具流量）、会话内匹配、摘录与上限。 |
| `client.js` | 浏览器半：`shell.overlay` 入口、双击 Shift 监听、范围切换（工作区文件 / 会话标题 / 本会话）与 `Tab` 循环、面板内 `Alt+Enter` 引用插入（失败回退复制）、对话框、防抖请求、打开命中项、只读 Chat 锚点定位；`conversation.input.overlay` 桥接组件把会话输入框的公开 input actions 交给根浮层；`plugins.bundle.config` 入口提供插件详情页的外观卡片。 |
| `tests/search.test.mjs` | 搜索核心的 `node --test` 覆盖。 |
| `tests/conversation.test.mjs` | 会话提取、思考/工具排除、匹配与上限的 `node --test` 覆盖。 |
| `tests/route.test.mjs` | 信任栅栏、根目录解析、会话观察与响应封装的 `node --test` 覆盖。 |
| `tests/client.test.mjs` | 外观偏好、跟随 DSH、面板色板、范围切换与 `Tab` 循环、标题匹配、消息复制、`Alt+Enter` 引用插入与复制回退的 `node --test` 覆盖（VM + 假 React，无需浏览器）。 |

路由只读，并拒绝已注册工作区或调用会话工作目录之外的根目录；会话内容路由只通过宿主的 `sessionQuery` 服务读取一个会话，不直接打开日志文件。三条路由与官方本地路由共用同一套浏览器信任栅栏（回环/`trustedHosts` Host、同源元数据、`connection.requestRejection`），因此真正授权请求的是页面自身的 auth cookie。栅栏**默认拒绝（fail-closed）**：宿主没有 Connection 服务、或该服务无法拒绝请求时，路由一律返回 `503 auth-unavailable`，不会把工作区文本交给身份无法验证的调用方。插件同时在 `inject` 中声明了 `connection`，因此在没有宿主认证的部署里根本不会挂载。

## 安装

插件以 `dsh-simple-search` bundle 形式安装到 DSH 的 `web` profile；profile 链接本目录，本目录始终是源码。

```sh
npm run check
```

`npm run check` 会跑语法检查、全部 `node:test`、6 个认证栅栏场景和
`npm pack --dry-run`；CI 使用同一条命令。修改 `client.js` 后刷新页面，新的客户端模块会替换已加载的旧模块。宿主半改动（`index.js`、`search.js`）不会对 link 安装的包重新求值（Node 按真实路径缓存模块，HMR 只清理 profile 根下的模块）：需要换一个目录名重新 remove + install，或重启宿主。

## 验证

```sh
# 路由已注册并能响应（没有页面 auth cookie 时返回 401 属正常）
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3080/dsh-simple-search/version'

# 可复跑的认证栅栏检查：真实 HTTP、一次性回环服务器、假宿主服务
npm run check:auth   # 期望 6/6，退出码 0

# 客户端实时注册
#   cordis_inspect_query Slots.listSubTree root=shell.overlay  → occupant "simple-search"
```

`scripts/verify-auth-fence.mjs` 挂载真实 handler，覆盖正常 `dsh web` 到不了的分支：完全没有 `connection` 服务（`503 auth-unavailable`）、服务为 `null`、校验抛错（`403`）、会话被接纳（`200`）、未登录（`401`）与跨站请求（`403`）。不需要运行中的宿主，也不需要 cookie。

手动验收：刷新页面，双击 Shift，输入 `RPC HTTP GET`，在第一个结果上按 Enter；再双击 Shift，按 `Tab` 依次切到「会话标题」「本会话」并确认再按 `Tab` 回到「工作区文件」；搜索一个文件名或代码片段，选中后按 `Alt+Enter`，确认输入框出现 `@` 引用、面板关闭且焦点回到输入框。随后切换到「会话标题」，搜索某个会话标题的一部分，按 Enter 打开该会话（可以跨工作区）；再切换到「本会话」，搜索最近对话里的一个词，按 Enter 定位到该条消息——思考过程与工具文本不应出现；把 Conversation View 切换到非 Chat 时应回退为复制。最后打开「插件 → 简单搜索」，在「外观」卡片中依次切换浅色 / 深色 / 跟随 DSH，再双击 Shift 确认面板配色与选项一致，DSH 切换主题时「跟随 DSH」应立即跟上。

「本会话」依赖宿主新增的 `/dsh-simple-search/conversation` 路由，必须先重载宿主半（换目录名重装或重启宿主）；只刷新页面而宿主仍是旧模块时，该范围会报路由不存在。

## 开发

面向 agent 的规则、命令和模块地图从 [AGENTS.md](AGENTS.md) 开始。架构、安全、重载矩阵与决策记录在 [docs/](docs/)；可复用流程在 `.agents/skills/`。
