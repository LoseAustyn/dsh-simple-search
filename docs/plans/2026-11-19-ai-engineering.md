# simple-search 工程化收尾记录

状态：P0 与 P1 已全部落地（2026-11-19）；2026-11-23 精简为当前状态与待评估项  
范围：`/home/chen/Projects/dsh-plugins/simple-search`（独立 Git 仓库 `dsh-simple-search`）

> 当前架构、命令与约束以 `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、`docs/SECURITY.md` 与 `docs/decisions/` 为准，本文不再重复。  
> 原始完整提案与验收过程可通过 `git show 9c03f5b:docs/plans/2026-11-19-ai-engineering.md` 查看。

## 已落地事项

| 事项 | 落地位置 |
|---|---|
| Agent 统一入口指引 | `AGENTS.md`、`tests/AGENTS.md` |
| 统一检查命令 | `npm run check`（语法 + 单测 + 鉴权集成 + 打包清单），CI 直接复用 |
| 版本号单一来源 | `index.js` 读取 `package.json`，由 `route.test.mjs` 防止漂移 |
| 高频工作流 Skill | `.agents/skills/simple-search-{change,verify,release}` |
| 核心工程文档 | `docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、`docs/SECURITY.md` |
| 架构决策记录 | `docs/decisions/`（6 篇 ADR） |
| 双语变更日志 | `CHANGELOG.md` / `CHANGELOG.en.md` |
| 持续集成 | `.github/workflows/ci.yml` |

原提案的 9 条验收标准已全部达成。2026-11-23 复核结果：`npm run check` 全绿（84/84 单测、鉴权 6/6、`npm pack --dry-run` 共 12 个文件）；版本 `1.4.0`、`private: true`，继续通过 profile `link:` 安装。

## 暂缓的可选项

原提案中的 P2 及部分可选文档目前均未阻塞开发，待实际触发条件出现后再按需补充：

| 可选项 | 触发条件 | 暂缓原因 |
|---|---|---|
| `scripts/verify-identity.mjs` 自动校验多处插件标识一致 | 插件标识再次出现漂移，或重装后路由与 loader 不匹配 | 解析 YAML/JS 有一定维护成本，暂不值得 |
| `.githooks/` 或 lefthook 提交前钩子 | 本地提交频繁漏跑 `npm run check` | 当前 CI 加统一入口命令已够用 |
| Issue / PR 模板 | 开始接受外部社区贡献 | 现阶段单人维护不需要 |
| 独立 Agent preset bundle | 出现稳定的角色隔离需求（如只读评审者） | 先用 skill 区分流程，避免多维护一份 profile 状态 |
| 测试覆盖率门槛 | 测试规模扩大到按模块自选检查已拦不住回归 | 目前 84 个用例分布清晰，暂不需要 |
| `docs/AGENTS.md` | 文档膨胀到需要独立维护规则 | 当前三篇核心文档加 ADR 索引已足够清晰 |
| `scripts/AGENTS.md` | 辅助脚本增至多个 | 目前只有 `verify-auth-fence.mjs` 一个脚本 |

## 已放弃的方案

- **`CLAUDE.md` 与 `.claude/skills` 兼容软链**：项目不使用 Claude Code，已于 2026-11-20 移除（commit `9c03f5b`），仅保留 `AGENTS.md` 与 `.agents/skills/`。
- **发布至 npm**：2026-11-23 尝试受阻于 npm 账号注册限制后回滚，继续保持 `private: true` 与 profile `link:` 安装，后续分发渠道另行评估。
