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
```

`npm run check` 是提交前唯一入口；CI 跑同一命令。

## 安装与重载

源码目录通过 profile 的 `link:` 指向本仓库。安装/更新 bundle 时，用 `plugin_manager` 的 `install_bundle`，`target` 传本目录绝对路径；没有该工具时，在 **Plugins → Add plugin** 选择本地目录。只以返回 `application=applied` 且 `warnings=[]` 判定安装成功。

| 改动 | 生效方式 | 验证 |
|---|---|---|
| `index.js` / `search.js` | Node 按真实路径缓存 ESM；`link:` 包不会热更新。`remove_bundle` 后把目录改成新名字再 `install_bundle`，或重启宿主 | `/dsh-simple-search/version` 的 `version`/`pid` 变化；`npm run check:auth` |
| `client.js` | 刷新页面加载新模块；若 `pnpm run dev:web` 在跑，客户端 bundle 可热替换 | 双击 Shift；插件详情页外观卡 |
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

1. 刷新页面，双击 Shift；输入查询；切换 `All` / `Files` / `Text`。
2. `↑`/`↓` 移动，`Enter` 打开命中，`Esc` 关闭。
3. **Plugins → Simple Search** → *Appearance*：Light / Dark / Follow DSH；切换后重开面板确认。
4. Follow DSH 下切换 DSH 主题，面板应立即跟随。

没有浏览器控制时，以上只能写“待用户确认”，不能写成已通过。

## 常见问题

- **`/version` 404**：bundle 未注册或路由前缀不一致；检查 `cordis.patch.yml` 与 `index.js`。
- **`/version` 401**：路由已注册，但请求没有页面认证 cookie；这是预期。
- **版本还是旧的**：宿主半模块被缓存；按上表重装/重启。
- **出现两个面板**：旧 slot id 或旧 bundle 残留；移除旧 bundle 后刷新。
- **`engine=walk`**：`@vscode/ripgrep` 未解析到且 `PATH` 没有 `rg`；功能可用，结果可能更慢。可用 `DSH_SIMPLE_SEARCH_RG` 指定二进制。
- **搜索不到子仓内容**：这是 `--no-ignore-vcs` 的有意行为；若仍缺失，检查 `SKIP_DIR_NAMES` 与目标目录名。

## 发布

见 `.agents/skills/simple-search-release/SKILL.md`；变更日志写 `CHANGELOG.md`。当前包是 `private: true`，安装方式是 profile `link:`；若要发 npm，先按决策记录改分发方式。
