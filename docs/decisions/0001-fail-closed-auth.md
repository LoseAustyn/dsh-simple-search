# 0001 路由鉴权默认拒绝（fail-closed）

Status: accepted
Date: 2026-11-19

## 背景

`/dsh-simple-search/search` 会把工作区文件内容返回给调用方。如果运行环境中缺少 `connection` 服务，或该服务未提供 `requestRejection` 方法，插件将无法确认请求是否来自合法的页面持有者。一旦把「缺少鉴权服务」视为「本机请求默认可信」，同机任意进程都可以借此读取工作区文件。

## 决策

鉴权不可用时一律拒绝，绝不降级放行：

- 插件 `inject` 必须包含 `connection`，缺失时直接不挂载。
- `connection` 缺失、为 `null` 或缺少 `requestRejection` 方法时，返回 `503 auth-unavailable`。
- `requestRejection` 抛出异常时返回 `403`。
- 只有当 `requestRejection` 明确返回 `undefined`、`null` 或 `false` 时才允许请求通过。

## 影响

- 未启用 `connection` 服务的部署环境无法使用本插件，这是为了安全主动接受的可用性代价。
- `tests/route.test.mjs` 与 `scripts/verify-auth-fence.mjs` 必须持续覆盖服务缺失与异常分支。
- 不得为了方便本地 `curl` 调试而开未认证后门。

## 备选方案

- **无鉴权服务时默认放行**：实现最省事，但会把工作区文件暴露给同机任意进程，放弃。
- **仅校验 Host 是否为回环地址**：回环地址无法证明调用者是浏览器页面持有者，本机其他进程同样可以发起回环请求，放弃。
- **插件自建独立 token**：需要额外的凭据签发与轮换机制，与 DSH 现有的页面认证体系重复，当前规模下得不偿失，放弃。
