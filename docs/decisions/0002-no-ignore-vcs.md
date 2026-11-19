# 0002 搜索不服从 .gitignore

Status: accepted
Date: 2026-11-19

## Context

工作区经常是“根仓库 + 多个子仓库”。根 `.gitignore` 常用 `/*` 忽略所有子目录，再由子仓库各自管理内容。如果搜索服从 `.gitignore`，JetBrains 风格的“搜整个工作区”会看不到子仓库源码。

## Decision

内容搜索与文件名列举都使用 `--no-ignore-vcs`，不服从 `.gitignore`；改用显式的 `SKIP_DIR_NAMES` 排除依赖、VCS 内部、构建产物、虚拟环境与缓存目录。rg 与 walk 两套引擎共用同一份排除表。

## Consequences

- 子仓库内容可被搜到，符合“全局搜索”预期。
- 被 `.gitignore` 忽略但仍存在的生成文件可能出现在结果里；需要时扩充排除表。
- 两个引擎的排除规则必须从同一来源派生，避免 rg 与 walk 结果不一致。
- `.gitignore` 不再能作为“不要搜这里”的用户开关；文档必须说明。

## Alternatives

- **服从 `.gitignore`**：多仓工作区会漏掉子仓；否决。
- **只排除 `node_modules` 和 `.git`**：构建产物、虚拟环境、缓存会污染结果并拖慢搜索；否决。
- **让用户配置排除表**：当前没有配置界面，增加状态与迁移成本；先用固定表，出现真实需求再评估。
