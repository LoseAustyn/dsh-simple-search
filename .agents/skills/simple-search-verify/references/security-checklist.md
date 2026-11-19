# Security checklist

改 `index.js` 的路由、认证、根解析，或改 `search.js` 的 root/limit 时逐项过。完整威胁模型见 `../../../docs/SECURITY.md`。

## 路由与认证

- [ ] 新路由所在插件 `inject` 含 `connection`；没有它不应挂载。
- [ ] 每个 handler 都走同一个 `guard`/`fence`，没有“内部路由跳过”。
- [ ] `connection` 缺失、为 `null`、或没有 `requestRejection` → `503 auth-unavailable`，不是放行。
- [ ] `requestRejection` 抛错 → `403`。
- [ ] `requestRejection` 返回 401/403/数字 → 原状态返回，body `code=forbidden`。
- [ ] Host 不能解析为 URL → `403`。
- [ ] `sec-fetch-site: cross-site` → `403`。
- [ ] `Origin` 存在且与 Host 不同源 → `403`；`Origin: null` → `403`。
- [ ] 非 GET 的非回环请求 → `403`。
- [ ] 路由只读：没有写文件、改工作区、执行命令。

## 根解析

- [ ] 默认根只来自会话已提交 cwd 或已注册工作区，不是 `process.cwd()`。
- [ ] 显式 `root` 先 `path.resolve` + `realpath`，再校验落在会话目录或已注册工作区内。
- [ ] 路径边界用 `isWithin` 的路径段判断，不用字符串前缀。
- [ ] 目录不存在 → `422 bad-root`；越界 → `403 denied`。
- [ ] 符号链接/`..` 不会绕过 realpath 校验。

## 搜索与上限

- [ ] 空查询、超长查询、非法正则 → `400 invalid-pattern`。
- [ ] `limit` 被钳到 `MAX_MATCHES`；单文件命中受 `MAX_MATCHES_PER_FILE` 限制。
- [ ] 超时、目录项预算、文件大小上限仍然生效。
- [ ] 排除表由 `SKIP_DIR_NAMES` 派生，两个引擎共用；没有在调用方另建一份。
- [ ] 错误信息不泄露未授权路径的目录内容。

## 测试映射

- [ ] `tests/route.test.mjs` 覆盖：缺服务 503、null 503、抛错 403、拒绝直通、跨站 403、越界 403。
- [ ] `scripts/verify-auth-fence.mjs` 6/6；新增分支要加场景。
- [ ] 版本测试仍验证 `/version` 等于 `package.json`。

任何一项无法勾选：停止，不要用“其他测试还绿”代替。
