---
name: simple-search-change
description: "Use when changing dsh-simple-search source, tests, routes, client UI, locale, or manifest; identifies the owning surface, applies the smallest change, runs the right checks, and verifies the installed bundle."
---

# Simple Search change workflow

用于本仓库的任何代码改动。standing rules 在 `AGENTS.md`，本 skill 只给执行顺序，不重复整段规则。

## 1. 预检

```sh
git status --short --branch
npm run check
```

- `check` 已经是红的：记录失败命令与首个错误，停止；不要在红基线上继续改。
- 用一句话写出改动面与预期效果（宿主可见 / 页面可见 / 仅内部）。
- 改路由、认证、根目录：先读 `../../../docs/SECURITY.md`。

## 2. 选定归属模块

| 改动 | 主文件 | 主测试 |
|---|---|---|
| 路由、认证、根解析、envelope | `index.js` | `tests/route.test.mjs` + `npm run check:auth` |
| 搜索、匹配、排序、限制、跳过表 | `search.js` | `tests/search.test.mjs` |
| 会话文本提取、思考/工具排除、会话上限 | `conversation.js` | `tests/conversation.test.mjs` |
| 浮层、双击、范围切换、外观卡、交互 | `client.js` | `tests/client.test.mjs` |
| 清单、locale、图标、包内容 | `package.json`、`cordis.patch.yml`、`locale/`、`icon.svg` | `npm run check:pack` |
| 测试、门禁脚本 | `tests/`、`scripts/` | 对应命令 |

跨面改动先改契约（JSDoc、`ARCHITECTURE.md` 的响应/错误表），再改实现和两侧调用方。

## 3. 实现

- 只改归属模块；不顺手重构无关代码。
- 新行为写 JSDoc 契约；注释解释“为什么”，不写改动历史。
- 错误保持稳定 `code`；不要新增“看起来合理”的静默回退。
- 搜索根不得默认 `process.cwd()`；显式 `root` 仍要经过已注册工作区校验。
- 新增用户可见文案：`locale/zh.json` 与 `locale/en.json` 同一改动补齐。
- 新增路由：`inject`、fence、根约束、拒绝场景测试四件套一起加。
- 客户端不得读文件系统或做宿主认证；只走相对路由 + 同源 cookie。
- 不加运行时依赖；确需新增时先写出当前实现的具体失败场景。

## 4. 测试

- 纯核心 → `search.test.mjs` / `conversation.test.mjs`；路由/栅栏 → `route.test.mjs`；浏览器半 → `client.test.mjs`。
- 真实 HTTP 只加在 `scripts/verify-auth-fence.mjs`，不要为此在单测里监听端口。
- 新测试先证明能失败：改代码前跑一次，或临时回退断言。
- 新测试文件必须加入 `package.json` 的 `test` 脚本。
- 测试写法遵循 `../../../tests/AGENTS.md`；不引入 jsdom/Playwright/网络依赖。

## 5. 重载

| 改动 | 生效 | 验证 |
|---|---|---|
| `index.js` / `search.js` / `conversation.js` | 换目录名重装或重启宿主 | `/dsh-simple-search/version` 的 `version`/`pid` 变化；`npm run check:auth` |
| `client.js` | 刷新页面（dev:web 可热替换） | 双击 Shift + 范围切换 + 外观卡 |
| 清单/locale/图标 | 重装 + 刷新 | `install_bundle` applied、warnings 空；插件页 |
| tests/scripts | 无需重载 | 对应命令 |

宿主半仅测试通过不等于页面生效；必须验证安装后的 `/version` 或重启。

## 6. 验收与报告

```sh
npm run check
```

安装类改动：`plugin_manager` `install_bundle` 后确认 `application=applied`、`warnings=[]`；没有工具时说明“未安装验证”。

报告固定三段：

```text
Changed:   改了哪些文件/行为
Evidence:  npm run check、单测、auth 6/6、安装/版本检查
Unverified: 浏览器交互、视觉、真实安装效果（需用户确认）
```

不要把“测试通过”写成“页面已通过”。

## 成功判据

- `npm run check` 全绿。
- 新行为有对应测试，且该测试在修复前能失败。
- 宿主半/客户端半的重载结论明确（已验证或标注待验证）。
- 没有削弱认证、根目录、只读、上限相关不变量。

## 停止条件

- 预检红且原因不明。
- 为通过测试需要放宽认证/根目录断言。
- 改动需要新增依赖、改变分发方式或改 profile。
- 用户可见行为存在歧义（先问，不猜）。

## 参考

- `references/reload-matrix.md`
- `references/test-patterns.md`
- `../../../docs/ARCHITECTURE.md`
- `../../../docs/DEVELOPMENT.md`
- `../../../AGENTS.md`
