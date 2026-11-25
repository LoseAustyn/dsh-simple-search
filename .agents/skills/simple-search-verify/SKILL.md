---
name: simple-search-verify
description: "Use before claiming dsh-simple-search work is done, committing, pushing, or reviewing a change; selects the smallest evidence for the touched surface and reports verified, unverified, and blocked items separately."
---

# Simple Search 验收流程

在宣布改动完成、提交代码、推送或做代码评审前使用。核心原则是让每一条结论都有明确证据，不把推测当成验证结果。

## 1. 按改动范围选择检查项

| 改动范围 | 必跑项 | 补充项 |
|---|---|---|
| 搜索核心 | `node --test tests/search.test.mjs` | 涉及上限或排序时补边界用例 |
| 会话提取与匹配 | `node --test tests/conversation.test.mjs` | 涉及思考/工具过滤时补事件样本 |
| 路由、鉴权、目录解析、会话读取 | `node --test tests/route.test.mjs` | `npm run check:auth` |
| 浏览器端 / 范围切换 / 外观 | `node --test tests/client.test.mjs` | 刷新页面人工检查 |
| 清单、locale、图标 | `npm run check:pack` | 重装后检查插件详情页 |
| 版本号 | `npm test` 中的 `reports the package version` | `curl /version` |
| 文档 / 脚本 | 受影响的命令 | 确认链接有效、命令可直接执行 |

不确定影响面时直接跑 `npm run check`，它涵盖语法检查、全部单测、鉴权集成和打包清单，是提交前的统一入口。

## 2. 必跑检查

```sh
npm run check
```

预期结果：

- 单元测试全部通过（包含版本号检查与会话提取核心，具体数量以实际输出为准）。
- 鉴权集成检查输出 `6/6 scenarios matched`，退出码为 `0`。
- `npm pack --dry-run` 只包含预期发布文件，不夹带 `tests/`、`scripts/`、`docs/` 或 `*.tgz`。

必要时可单独复核：

```sh
npm run check:auth
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3080/dsh-simple-search/version'
```

返回 `401` 说明路由已注册但未携带页面 cookie，属正常现象；返回 `404` 说明路由未注册或前缀不一致。

## 3. 人工检查清单

以下项目只能由用户在浏览器中亲自确认，不要代为宣布通过：

1. 刷新页面，连按两次 `Shift` 呼出面板并输入关键词。
2. **工作区文件**：切换「全部 / 文件 / 文本」标签，确认 `↑`/`↓`、`Enter`、`Esc` 正常；选中文件或文本命中按 `Alt+Enter`，确认原生 `@` 引用写入输入框（无会话时回退复制）。
3. **范围切换**：焦点在搜索框时按 `Tab` / `Shift+Tab`，确认在三个范围间循环切换。
4. **会话标题**：输入标题或工作区名的一部分，确认跨工作区列出结果，`Enter` 能打开目标会话。
5. **本会话**：输入近期对话中的词，确认结果只含双方可见内容（无思考过程、工具调用或系统提示）；`Enter` 能定位到 Chat 视图中的对应消息，非 Chat 视图时回退为复制。
6. **插件 → 简单搜索 → 外观**：依次切换浅色 / 深色 / 跟随 DSH，重开面板确认配色生效；在「跟随 DSH」下切换 DSH 主题，确认面板实时跟随。
7. 确认插件详情页的标题、描述与图标显示正常。

未执行的项目一律归入「待验证」，并说明用户需要如何确认。

## 4. 安全复核

只要改动触及路由、鉴权、目录解析或会话读取，必须逐项核对 `references/security-checklist.md`，不要用「现有测试都过了」替代逐项检查。

## 5. 验收报告格式

```text
已验证：
- npm run check — 单测全绿，auth 6/6，pack 12 个文件
- /dsh-simple-search/version 返回 `<version>`（与 package.json 一致）

待验证：
- 浏览器面板交互与外观卡视觉效果（需用户刷新后确认）

受阻项：
- 无 / 具体阻塞原因
```

汇报原则：

- 不要把「路由返回 401」写成「插件已正常运行」，401 只说明路由存在。
- 不要把「`install_bundle` 返回 applied」写成「交互已通过」。
- 不要把「单测通过」写成「视觉效果已通过」。
- 不隐瞒失败的命令或跳过的检查项。

## 验收标准

- 每一条「已验证」都有对应的命令输出或可复现依据。
- 未验证项单独列出，并附带验证方式。
- 安全清单逐项有明确结论，不写「应该没问题」。
- 不通过放宽断言或跳过测试来换取绿灯。

## 参考文档

- `references/security-checklist.md`
- `../../../docs/SECURITY.md`
- `../../../docs/DEVELOPMENT.md`
- `../../../AGENTS.md`
