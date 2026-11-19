# 0001 路由认证 fail-closed

Status: accepted
Date: 2026-11-19

## Context

`/dsh-simple-search/search` 返回工作区文件内容。宿主部署可能没有 `connection` 服务，或该服务没有 `requestRejection`；此时插件无法判断调用者是不是页面所有者。把“没有认证服务”当作“本机请求可信”会让任何同机进程读到工作区内容。

## Decision

认证缺失时拒绝，不降级：

- `inject` 必须包含 `connection`；没有它插件不挂载。
- `connection` 缺失、为 `null`、或没有 `requestRejection` → `503 auth-unavailable`。
- `requestRejection` 抛错 → `403`。
- 只有 `requestRejection` 明确返回 `undefined`/`null`/`false` 才放行。

## Consequences

- 没有 Connection 服务的部署无法使用本插件；这是有意的可用性代价。
- `tests/route.test.mjs` 与 `scripts/verify-auth-fence.mjs` 必须覆盖缺失分支。
- 不能为了“让本地 curl 能通”而加未认证旁路。

## Alternatives

- **没有认证就放行**：实现最简单，但把文件内容暴露给同机任意调用者；否决。
- **只检查 Host 是否回环**：回环不能证明调用者是页面所有者；同机进程也能构造回环请求；否决。
- **加独立 token**：需要额外的凭据分发与轮换，和 DSH 的页面认证重复；当前规模不值得。
