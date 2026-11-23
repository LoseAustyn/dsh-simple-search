# simple-search AI 工程化：剩余工作

状态：P0 + P1 已落地（2026-11-19）；2026-11-23 精简，只保留未完成与已放弃的事项
范围：`/home/chen/Projects/dsh-plugins/simple-search`（独立 Git 仓库 `dsh-simple-search`）

> 现状以 `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、
> `docs/SECURITY.md`、`docs/decisions/` 为准；本文不重复结构、命令与不变量。
> 原始提案（P0/P1 的完整设计与验收过程）见
> `git show 9c03f5b:docs/plans/2026-11-19-ai-engineering.md`。

## 已落地

| 提案项 | 落点 |
|---|---|
| 单一入口指令 | `AGENTS.md`、`tests/AGENTS.md` |
| 一个命令 | `npm run check`（语法 + 单测 + 认证栅栏 + 打包清单），CI 复用 |
| 版本单源 | `index.js` 读 `package.json`，`route.test.mjs` 覆盖漂移 |
| 三条高频流程 | `.agents/skills/simple-search-{change,verify,release}` |
| 架构 / 开发 / 安全文档 | `docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、`docs/SECURITY.md` |
| 决策账 | `docs/decisions/`（6 条 ADR） |
| 变更日志 | `CHANGELOG.md` / `CHANGELOG.en.md` |
| CI | `.github/workflows/ci.yml` |

原提案的 9 条验收标准已全部满足。复核证据（2026-11-23）：`npm run check` 通过，
84/84 单测、认证 6/6、`npm pack --dry-run` 12 files；版本 1.4.0、`private: true`，
profile 仍以 `link:` 安装。

## 未完成：可选项

原提案的 P2 与「可选」子文件均未做，也都不阻塞当前开发；出现触发条件时再做：

| 可选项 | 触发条件 | 说明 |
|---|---|---|
| `scripts/verify-identity.mjs` 机械校验身份四处一致 | 身份同步再次漂移，或重装后路由 / loader 失配 | 解析 YAML/JS 有维护成本，先确认值得 |
| `.githooks/` 或 lefthook 提交前拦截 | 本地提交经常跳过 `npm run check` | 现在 CI + 单一入口够用 |
| Issue / PR 模板 | 开始接收外部贡献 | 单作者阶段不需要 |
| Agent preset bundle | 出现稳定的角色隔离需求（如只读评审者） | 先用 skill 分角色，避免多一份 profile 状态 |
| 覆盖率门槛 | 测试增长到「按面选证据」覆盖不住回归 | 现阶段 84 项按面分布够用 |
| `docs/AGENTS.md` | 文档多到需要独立规则 | 现在三份文档 + ADR 索引够用 |
| `scripts/AGENTS.md` | 门禁脚本增至多个 | 现在只有 `verify-auth-fence.mjs` |

## 已放弃的提案内容

- `CLAUDE.md` 与 `.claude/skills` 兼容软链：项目不使用 Claude Code，
  2026-11-20 移除（提交 `9c03f5b`）；指令与 skill 只保留 `AGENTS.md` 与
  `.agents/skills/`。
- npm 分发：2026-11-23 尝试后回滚（npm 账号注册受限），保持
  `private: true` + profile `link:` 安装；分发渠道待定。
