# 简单搜索（Simple Search）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![支持的 DSH 版本: 0.2.2-rc.2+](https://img.shields.io/badge/DSH-0.2.2--rc.2%2B-4d6bfe)](https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions)

[English](README.md)

一个 DSH Web UI 插件：在页面任意位置**双击 Shift**，即可打开 JetBrains 风格的**简单搜索**面板。它同时搜索**文件名**与**每个文件的内容**，提供「全部 / 文件 / 文本」三个标签页。`↑`/`↓` 切换结果，`Enter` 在侧栏卡片编辑器中打开选中项（文本命中会定位到对应行），`Esc` 关闭。打开面板时会选中上一次的查询，直接输入或粘贴即可替换。

## 功能

- 双击判定为 400 ms 内两次干净的 Shift 按键：按住 Shift 或输入 `Shift`+字母不会误触发。
- 内容搜索由宿主执行：优先使用可解析到的随包 ripgrep（`@vscode/ripgrep`、`PATH` 上的 `rg`，或 `DSH_SIMPLE_SEARCH_RG`）；不可用时回退到有界的 Node.js 遍历，没有 ripgrep 也能工作。
- 文件名搜索会列出工作区文件（输入时缓存 10 秒），排序使用 JetBrains 风格评分：完全匹配 basename、basename 子串、路径子串，最后是模糊子序列（例如 `htexec` 能找到 `http-executor.ts`）。「全部」在一次请求中返回两类结果。
- **不应用** `.gitignore` 规则（`--no-ignore-vcs`）：很多工作区是忽略所有子仓库的根仓库，JetBrains 风格搜索需要能看到子仓库内部。改为显式排除重目录（`.git`、`node_modules`、`dist`、`.venv*`、缓存、`.dsh-memory`），两种引擎共用同一份排除表。
- 支持大小写敏感（`Aa`）与正则表达式（`.*`）开关。
- 结果按文件分组并高亮命中文本；底部显示工作区根目录、命中/文件数量、引擎与耗时。
- 外观支持**浅色 / 深色 / 跟随 DSH** 三选一：在「插件 → 简单搜索」详情页的「外观」卡片中设置，选择保存在浏览器 `localStorage`（`dsh-simple-search:appearance`）。「跟随 DSH」读取 DSH 当前实际色板（`body[data-ds-dark-theme]`，并订阅 `theme/change`），DSH 切换主题或系统色板翻转时自动跟随；浅色/深色则固定面板配色。两套色板都由面板内的 CSS 变量驱动，并设置对应的 `color-scheme`，让光标、选中与滚动条跟随。
- 激活命中项（点击或 `Enter`）会打开文件**并关闭面板**。安装 better-sidebar 插件时，`Enter` 通过 `ctx.betterSidebar.openFile` 精确打开到行；其他部署会复制 `path:line`、显示短暂提示，稍后关闭。

## 文件结构

| 文件 | 作用 |
|---|---|
| `index.js` | 宿主半：回环路由 `/dsh-simple-search/version` 与 `/dsh-simple-search/search`（`mode=text|files|all`），工作区/会话根目录解析，浏览器信任栅栏。 |
| `search.js` | 可测试的搜索核心：ripgrep 参数与解析、回退遍历、跳过表、匹配器编译、文件列表与文件名排序。 |
| `client.js` | 浏览器半：`shell.overlay` 入口、双击 Shift 监听、对话框、防抖请求、打开命中项；`plugins.bundle.config` 入口提供插件详情页的外观卡片。 |
| `tests/search.test.mjs` | 搜索核心的 `node --test` 覆盖。 |
| `tests/route.test.mjs` | 信任栅栏、根目录解析与响应封装的 `node --test` 覆盖。 |
| `tests/client.test.mjs` | 外观偏好、三选项卡片、跟随 DSH 与面板色板解析的 `node --test` 覆盖（VM + 假 React，无需浏览器）。 |

路由只读，并拒绝已注册工作区或调用会话工作目录之外的根目录。它们与官方本地路由共用同一套浏览器信任栅栏（回环/`trustedHosts` Host、同源元数据、`connection.requestRejection`），因此真正授权请求的是页面自身的 auth cookie。

## 安装

插件以 `dsh-simple-search` bundle 形式安装到 DSH 的 `web` profile；profile 链接本目录，本目录始终是源码。

```sh
node --test tests/search.test.mjs tests/route.test.mjs tests/client.test.mjs
node --check index.js && node --check search.js && node --check client.js
```

修改 `client.js` 后刷新页面，新的客户端模块会替换已加载的旧模块。宿主半改动（`index.js`、`search.js`）不会对 link 安装的包重新求值（Node 按真实路径缓存模块，HMR 只清理 profile 根下的模块）：需要换一个目录名重新 remove + install，或重启宿主。

## 验证

```sh
# 路由已注册并能响应（没有页面 auth cookie 时返回 401 属正常）
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3080/dsh-simple-search/version'

# 客户端实时注册
#   cordis_inspect_query Slots.listSubTree root=shell.overlay  → occupant "simple-search"
```

手动验收：刷新页面，双击 Shift，输入 `RPC HTTP GET`，在第一个结果上按 Enter；随后打开「插件 → 简单搜索」，在「外观」卡片中依次切换浅色 / 深色 / 跟随 DSH，再双击 Shift 确认面板配色与选项一致，DSH 切换主题时「跟随 DSH」应立即跟上。
