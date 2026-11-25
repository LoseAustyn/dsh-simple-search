# 0003 保持纯 JavaScript 与 node:test

Status: accepted
Date: 2026-11-19

## 背景

本插件以本地 bundle 形式由 DSH profile 直接加载，服务端与浏览器端都是标准 ESM。若引入 TypeScript、构建工具链、jsdom 或第三方测试框架，会带来额外的安装步骤、构建产物与版本耦合；而目前代码体量在数千行以内，配合 JSDoc 和 `node:test` 行为测试已足够维持质量。

## 决策

- 运行时保持纯 ESM JavaScript，零运行时依赖。
- 单元测试直接使用 Node.js 内置的 `node:test` 与 `node:assert/strict`。
- 搜索核心用真实临时目录测试；服务端路由用 mock `ctx` 直接调用 handler；浏览器端通过 `vm` 搭配精简版 mock React 和 `localStorage` 测试。
- 需要真实本地 HTTP 服务的鉴权集成测试放在独立脚本 `scripts/verify-auth-fence.mjs`，不混入单元测试。

## 影响

- 新环境拉下代码即可运行，无需 `npm install`，CI 也无需维护依赖缓存。
- 缺少编译期静态类型检查，接口契约依靠 JSDoc、测试覆盖与代码评审来约束。
- `vm` 沙箱测试无法覆盖真实 DOM 渲染与视觉布局，交互和样式仍需人工在浏览器中验收。
- 后续若要引入任何依赖，必须给出当前方案无法解决的具体失败场景，不为追求「更现代」而增加构建链。

## 备选方案

- **TypeScript + 构建链**：类型安全收益明确，但会引入编译步骤、产物管理、source map 及与 DSH 的版本耦合，当前体量不划算，放弃。
- **Vitest + jsdom**：测试 API 更丰富，但引入外部依赖与 DOM 模拟成本，现有 `vm` 模式已足以覆盖注册、状态与偏好逻辑，暂不引入。
- **Playwright 端到端测试**：能覆盖真实页面，但依赖浏览器环境与运行中的 DSH 实例，运行成本与稳定性不适合作为每次提交的门禁，继续保留人工验收。
