# 0003 纯 JavaScript + node:test

Status: accepted
Date: 2026-11-19

## Context

插件是 DSH profile 直接加载的本地 bundle，宿主半与浏览器半都是普通 ESM。引入 TypeScript、构建链、jsdom 或测试框架会增加安装步骤、构建产物和版本耦合，而当前代码规模仍在数千行以内，已有 JSDoc 与 `node:test` 行为测试覆盖。

## Decision

- 运行时保持纯 ESM JavaScript，零运行时依赖。
- 测试使用 Node 内置 `node:test` + `node:assert/strict`。
- 搜索核心用真实临时目录；路由用 fake ctx 直接调用 handler；浏览器半用 `vm` + fake React/localStorage。
- 认证集成用真实 loopback HTTP 的独立脚本，不放进单测。

## Consequences

- 新环境不需要 `npm install`，CI 也不需要依赖缓存。
- 没有静态类型检查；靠 JSDoc、测试和 code review 约束契约。
- 浏览器测试不覆盖真实 DOM/布局；视觉与交互必须人工验收。
- 新增依赖需要有明确失败场景，不能为了“更现代”而引入构建链。

## Alternatives

- **TypeScript + 构建**：类型收益明确，但增加构建、产物、source map 与 DSH 版本耦合；当前规模不值得。
- **Vitest + jsdom**：测试体验更好，但引入依赖与 DOM 模拟，且现有 VM 模式已覆盖注册与偏好逻辑；暂不引入。
- **Playwright 端到端**：能覆盖真实页面，但需要浏览器与运行中的 DSH，成本和稳定性不适合作为提交门禁；保留人工验收。
