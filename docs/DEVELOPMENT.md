# Development

本文件是安装、调试、验证的操作说明；改代码前的架构与安全约束见 `ARCHITECTURE.md`、`SECURITY.md`。

## 前置

- Node.js 24.x（与当前 DSH 运行时、CI 一致）。
- 零运行时依赖；不需要 `npm install`。
- 插件源码就是 profile 链接的目录；不要直接编辑 `~/.dsh/profiles/web` 里的副本。

## 技能发现

DSH 以当前会话 cwd 的最近 `.git` 祖先为 project root；本仓库自身是 Git 仓库，所以在 `simple-search/` 内工作时才会扫描 `.agents/skills/`。如果会话停在 `dsh-plugins/` 工作区根，先把 cwd 切到 `simple-search/`，或让子代理以该目录为 `cwd` 启动；否则 skill 目录存在但不会进入 catalog（AGENTS.md 仍会在读写该目录文件时加载）。

## 命令

```sh
npm run check        # 语法 + 单测 + 认证栅栏 + 打包清单
npm test             # 只跑单测
npm run check:auth   # 真实 loopback HTTP 的认证栅栏 6 场景
npm run check:pack   # 只检查 npm 包内容
npm run check:syntax # 只做 node --check
```

单文件或单名称：

```sh
node --test tests/route.test.mjs
node --test --test-name-pattern 'version' tests/route.test.mjs
node --test --test-name-pattern 'appearance' tests/client.test.mjs
node --test tests/conversation.test.mjs
```

`npm run check` 是提交前唯一入口；CI 跑同一命令。

## 安装与重载

源码目录通过 profile 的 `link:` 指向本仓库。安装/更新 bundle 时，用 `plugin_manager` 的 `install_bundle`，`target` 传本目录绝对路径；没有该工具时，在 **Plugins → Add plugin** 选择本地目录。只以返回 `application=applied` 且 `warnings=[]` 判定安装成功。

| 改动 | 生效方式 | 验证 |
|---|---|---|
| `index.js` / `search.js` / `conversation.js` | Node 按真实路径缓存 ESM；`link:` 包不会热更新。`remove_bundle` 后把目录改成新名字再 `install_bundle`，或重启宿主 | `/dsh-simple-search/version` 的 `version`/`pid` 变化；`npm run check:auth` |
| `client.js` | 刷新页面加载新模块；若 `pnpm run dev:web` 在跑，客户端 bundle 可热替换 | 双击 Shift；三个搜索范围；插件详情页外观卡 |
| `package.json` / `cordis.patch.yml` / `locale` / `icon.svg` | 重装 bundle + 刷新页面 | `install_bundle` 返回 applied、warnings 空；插件页标题/图标 |
| `tests/` / `scripts/` | 无需重载 | 对应命令 |

宿主半改完只看测试通过不算生效：测试加载的是文件，页面加载的是宿主已缓存的模块；必须验证 `/version` 或重启。

## 新增测试

先读 `tests/AGENTS.md`。三种模式：

1. **纯核心**（`search.test.mjs`）：直接 import；临时目录用 `mkdtemp`，`after` 清理；不要 mock 文件系统。
2. **路由**（`route.test.mjs`）：用 `fakeContext(services)` 捕获 handler，用 `call(handler, url, headers)` 直接调用；不监听端口。
3. **客户端**（`client.test.mjs`）：`vm.runInNewContext` 执行 `client.js`，fake React/localStorage；不引入 jsdom。

新增测试必须先证明能失败：修代码前跑一次，或临时回退断言。新增测试文件要加入 `package.json` 的 `test` 脚本。

## 人工验收

```sh
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3080/dsh-simple-search/version'
# 无页面 cookie 时 401 正常；404 表示路由未注册
```

浏览器：

1. 刷新页面，双击 Shift；输入查询；切换 `工作区文件` 下的 `All` / `Files` / `Text`。
2. 焦点在搜索框时按 `Tab`：范围应依次切到「会话标题」「本会话」再回到「工作区文件」；`Shift+Tab` 反向。
3. `↑`/`↓` 移动，`Enter` 打开命中，`Esc` 关闭。
4. 切到 `会话标题`：输入某个会话标题的一部分，结果应跨工作区列出；`Enter` 打开该会话。
5. 在面板里搜索一个文件名或代码片段，用 `↑`/`↓` 选中后按 `Alt+Enter`：输入框应出现原生 `@` 引用、面板关闭且焦点回到输入框；没有打开的会话时应改为复制 `@路径` 并提示。
6. 切到 `本会话`：输入最近对话里的一个词，结果应只包含双方可见文字，不含思考过程、工具调用或系统提示；`Enter` 应滚动到 Chat 里的该条消息；如果把 Conversation View 切到非 Chat 或锚点不可用，应回退为复制并提示。
7. **Plugins → Simple Search** → *Appearance*：Light / Dark / Follow DSH；切换后重开面板确认。
8. Follow DSH 下切换 DSH 主题，面板应立即跟随。

注意：`本会话` 依赖宿主新增的 `/dsh-simple-search/conversation` 路由。只刷新页面而宿主模块未重载时，该范围会报“路由不存在”一类错误；按上表重装/重启后再验收。

没有浏览器控制时，以上只能写“待用户确认”，不能写成已通过。

## 常见问题

- **`/version` 404**：bundle 未注册或路由前缀不一致；检查 `cordis.patch.yml` 与 `index.js`。
- **`/version` 401**：路由已注册，但请求没有页面认证 cookie；这是预期。
- **版本还是旧的**：宿主半模块被缓存；按上表重装/重启。
- **出现两个面板**：旧 slot id 或旧 bundle 残留；移除旧 bundle 后刷新。
- **`engine=walk`**：`@vscode/ripgrep` 未解析到且 `PATH` 没有 `rg`；功能可用，结果可能更慢。可用 `DSH_SIMPLE_SEARCH_RG` 指定二进制。
- **搜索不到子仓内容**：这是 `--no-ignore-vcs` 的有意行为；若仍缺失，检查 `SKIP_DIR_NAMES` 与目标目录名。
- **`本会话` 提示宿主未提供会话查询服务**：profile 没有挂载 `sessionQuery`（DSH 的 base bundle 默认挂载）。确认宿主 bundle 组成后重启；插件不会退化成直接读会话文件。
- **`本会话` 提示当前没有打开的会话**：主视图没有选中会话。先在侧栏打开一个会话；subagent 子会话页不提供该范围。
- **会话标题搜不到某个会话**：空白占位与 subagent 子会话被有意排除；刚创建/改名的会话需要目录刷新（打开面板会触发 `sessions.refresh()`）。
- **`本会话` 返回 504**：读取会话日志超过 8 秒；通常是超长会话或磁盘慢，重试即可，不会无界扫描。

## 发布

见 `.agents/skills/simple-search-release/SKILL.md`；变更日志写 `CHANGELOG.md`（中文默认）与 `CHANGELOG.en.md`（英文），两版同一次改动里同步。当前包是 `private: true`，安装方式是 profile `link:`；若要发 npm，先按决策记录改分发方式。
