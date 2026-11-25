# 开发与调试指南

本文档涵盖本地安装、调试、测试与验收流程；修改代码前请先阅读 `ARCHITECTURE.md` 和 `SECURITY.md`。

## 环境要求

- Node.js 24.x（与当前 DSH 运行时和 CI 保持一致）。
- 零运行时依赖，不需要执行 `npm install`。
- Profile 通过 `link:` 直接指向本源码目录，改代码请在本仓库操作，不要直接编辑 `~/.dsh/profiles/web` 下的文件。

## Skill 自动发现说明

DSH 会以当前会话工作目录最近的 `.git` 祖先目录作为项目根目录。本仓库自身是独立的 Git 仓库，只有在 `simple-search/` 目录内工作时，`.agents/skills/` 下的 skill 才会被自动扫描加入目录；如果会话停在上层 `dsh-plugins/` 根目录，需先切换工作目录或让子代理以 `simple-search/` 为 cwd 启动（`AGENTS.md` 不受影响，读写该目录下文件时会自动加载）。

## 常用命令

```sh
npm run check        # 语法检查 + 全部单测 + 鉴权集成检查 + 打包清单校验（提交前统一入口）
npm test             # 仅运行单元测试
npm run check:auth   # 启动临时本地 HTTP 服务，运行 6 个鉴权场景
npm run check:pack   # 仅检查 npm pack 打包内容
npm run check:syntax # 仅运行 node --check 语法检查
```

运行单个测试文件或指定用例：

```sh
node --test tests/route.test.mjs
node --test --test-name-pattern 'version' tests/route.test.mjs
node --test --test-name-pattern 'appearance' tests/client.test.mjs
node --test tests/conversation.test.mjs
```

CI 与本地提交执行同一条 `npm run check`。

## 本地安装与重载

本插件通过 profile 的 `link:` 挂载。安装或更新 bundle 时，可使用 `plugin_manager` 的 `install_bundle`（`target` 填本目录绝对路径），或在 DSH Web 的 **插件 → 添加插件** 中选择本地目录。以返回 `application=applied` 且 `warnings=[]` 作为安装成功标准。

| 改动内容 | 生效方式 | 验证方式 |
|---|---|---|
| `index.js` / `search.js` / `conversation.js` | Node.js 按真实路径缓存 ESM 模块，`link:` 本地包不会热更新。需先 `remove_bundle`、修改目录名后再 `install_bundle`，或直接重启宿主 | 核对 `/dsh-simple-search/version` 的 `version` / `pid` 变化；运行 `npm run check:auth` |
| `client.js` | 刷新浏览器页面即可；若同时在运行 `pnpm run dev:web`，客户端 bundle 支持热替换 | 双击 `Shift` 测试三个搜索范围与插件详情页外观卡 |
| `package.json` / `cordis.patch.yml` / `locale` / `icon.svg` | 重新安装 bundle 并刷新页面 | `install_bundle` 返回 `applied` 且 `warnings=[]`；检查插件页标题与图标 |
| `tests/` / `scripts/` | 无需重载 | 运行对应检查命令 |

注意：服务端代码改完后，单测通过不代表页面已生效——测试直接加载磁盘文件，而页面访问的是宿主缓存的模块，务必确认 `/version` 或重启宿主。

## 编写测试

开始前先读 `tests/AGENTS.md`。本仓库按三类场景组织测试：

1. **纯核心模块**（`search.test.mjs`、`conversation.test.mjs`）：直接 import 模块；文件测试使用 `mkdtemp` 创建真实临时目录并在 `after` 中清理，不 mock 文件系统。
2. **服务端路由**（`route.test.mjs`）：用 `fakeContext(services)` 捕获路由 handler，再通过 `call(handler, url, headers)` 直接调用，不监听端口。
3. **浏览器端**（`client.test.mjs`）：用 `vm.runInNewContext` 加载 `client.js`，传入精简版 mock React 与 `localStorage`，不引入 jsdom。

新增测试需先确认在代码修复前能够失败（修代码前跑一次，或临时改坏断言验证）。如有新增测试文件，记得加进 `package.json` 的 `test` 脚本。

## 人工验收步骤

先检查路由是否已注册：

```sh
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3080/dsh-simple-search/version'
# 无页面 cookie 时返回 401 属正常；404 表示路由未注册
```

再在浏览器中逐项确认：

1. 刷新页面，连按两次 `Shift` 呼出面板，输入关键词，在「工作区文件」下切换「全部 / 文件 / 文本」。
2. 焦点在搜索框时按 `Tab`，确认依次切换「工作区文件 → 会话标题 → 本会话」并循环；`Shift+Tab` 反向切换。
3. 使用 `↑`/`↓` 移动选中项，`Enter` 打开命中结果，`Esc` 关闭面板。
4. 切到「会话标题」，输入任意会话标题片段，确认跨工作区列出结果，`Enter` 能正常打开该会话。
5. 搜索一个文件名或代码片段，选中后按 `Alt+Enter`，确认原生 `@` 引用插入输入框、面板关闭且焦点回到输入框；在无打开会话时应回退复制 `@路径` 并给出提示。
6. 切到「本会话」，输入近期对话中的词，确认结果只含双方可见文字（不含思考过程、工具调用或系统提示）；`Enter` 应定位并滚动到 Chat 视图中的该条消息；切到非 Chat 视图或锚点不可用时应回退复制并提示。
7. 打开 **插件 → 简单搜索**，在「外观」卡片依次切换 **浅色 / 深色 / 跟随 DSH**，重开面板确认配色一致。
8. 在「跟随 DSH」状态下切换 DSH 主题，确认面板配色立即跟随变化。

> 提示：「本会话」依赖服务端新增的 `/dsh-simple-search/conversation` 路由。若只刷新页面而未重载服务端模块，该范围会报路由不存在，请按上表重启或重装后再验收。

在没有真实浏览器验证手段时，以上人工项只能标为「待用户确认」，不得写成已通过。

## 常见问题排查

- **`/version` 返回 404**：bundle 未注册或路由前缀不一致，检查 `cordis.patch.yml` 与 `index.js`。
- **`/version` 返回 401**：路由已注册，只是 `curl` 未携带页面登录 cookie，属于预期行为。
- **版本号未更新**：Node.js 缓存了旧版服务端模块，按上表重启或改目录名重装。
- **页面出现两个搜索面板**：存在旧 slot ID 或残留旧 bundle，移除旧 bundle 后刷新页面。
- **底部显示 `engine=walk`**：未找到 `@vscode/ripgrep` 且 `PATH` 中无 `rg`，已自动回退到 Node 遍历；功能正常但速度较慢，可通过环境变量 `DSH_SIMPLE_SEARCH_RG` 指定 `rg` 路径。
- **搜不到子仓库文件**：插件默认开启 `--no-ignore-vcs` 不受 `.gitignore` 影响；若仍搜不到，检查目录名是否命中了 `SKIP_DIR_NAMES`。
- **「本会话」提示未提供会话查询服务**：当前 profile 未挂载 `sessionQuery`（DSH base bundle 默认包含）。检查 profile 配置并重启，插件不会降级为直接读取会话文件。
- **「本会话」提示当前无打开会话**：主视图未选中任何会话，先在侧栏打开一个会话（subagent 子会话页不支持该范围）。
- **「会话标题」搜不到某个会话**：空白占位会话和 subagent 子会话被主动排除；刚新建或改名的会话需等待目录刷新（打开面板会自动调用 `sessions.refresh()`）。
- **「本会话」返回 504**：读取会话日志超过 8 秒超时上限，多见于超长会话或磁盘较慢，重试即可。

## 发布说明

完整发布流程见 `.agents/skills/simple-search-release/SKILL.md`。变更日志同步维护在 `CHANGELOG.md`（中文）与 `CHANGELOG.en.md`（英文）。当前包为 `private: true`，通过 profile `link:` 本地安装；如后续计划发布至 npm，需先单独决策分发方式。
