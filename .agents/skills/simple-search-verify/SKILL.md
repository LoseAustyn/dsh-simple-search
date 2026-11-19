---
name: simple-search-verify
description: "Use before claiming dsh-simple-search work is done, committing, pushing, or reviewing a change; selects the smallest evidence for the touched surface and reports verified, unverified, and blocked items separately."
---

# Simple Search verification

用于“我改完了”之前，以及提交、推送、评审时。目标不是跑最多命令，而是让每条结论都有证据。

## 1. 按改动面选证据

| 改动面 | 必跑 | 附加 |
|---|---|---|
| 搜索核心 | `node --test tests/search.test.mjs` | 触碰限制/排序时补边界用例 |
| 路由、栅栏、根解析 | `node --test tests/route.test.mjs` | `npm run check:auth` |
| 客户端/外观 | `node --test tests/client.test.mjs` | 刷新页面人工检查 |
| 清单、locale、图标 | `npm run check:pack` | 重装后看插件页 |
| 版本 | `npm test` 中的 `reports the package version` | `curl /version` |
| 文档/脚本 | 受影响命令 | 链接与命令可复制 |

不确定时先跑 `npm run check`；它覆盖语法、单测、认证、打包，是提交前的统一入口。

## 2. 必跑门禁

```sh
npm run check
```

期望：

- 单测全绿（当前 44 项，含版本测试）。
- 认证栅栏 `6/6 scenarios matched`、exit 0。
- `npm pack --dry-run` 只包含预期文件，不带 `tests/`、`scripts/`、`docs/`、`*.tgz`。

单独复核：

```sh
npm run check:auth
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3080/dsh-simple-search/version'
```

`401` = 路由已注册但没有页面 cookie，正常；`404` = 未注册或前缀不一致。

## 3. 人工检查

只有用户能确认的项，不要替用户宣布通过：

1. 刷新页面，双击 Shift，输入查询。
2. 切换 `All` / `Files` / `Text`，`↑`/`↓`、`Enter`、`Esc`。
3. **Plugins → Simple Search → Appearance**：Light / Dark / Follow DSH；重开面板确认。
4. Follow DSH 下切换 DSH 主题，面板立即跟随。
5. 插件详情页标题、描述、图标正确。

没做就写“未验证”，并说明需要用户做什么。

## 4. 安全复核

改路由、认证、根解析时，逐项过 `references/security-checklist.md`。不要用“现有测试还绿”代替逐项检查。

## 5. 报告格式

```text
Verified:
- npm run check — 44/44, auth 6/6, pack 11 files
- 版本路由返回 1.2.1（与 package.json 一致）

Unverified:
- 浏览器外观卡视觉（需用户刷新后确认）

Blocked:
- 无 / 具体原因
```

规则：

- 不把“路由 401”写成“插件已加载”；401 只证明路由存在。
- 不把“install_bundle applied”写成“交互已通过”。
- 不把“单测绿”写成“视觉已通过”。
- 不省略失败命令或未跑项。

## 成功判据

- 每条“已通过”都有命令或可复现观察。
- 未验证项单独列出，且说明如何验证。
- 安全清单逐项有结论，没有“应该没问题”。
- 没有用更宽松的断言或跳过测试来换绿色。

## 参考

- `references/security-checklist.md`
- `../../../docs/SECURITY.md`
- `../../../docs/DEVELOPMENT.md`
- `../../../AGENTS.md`
