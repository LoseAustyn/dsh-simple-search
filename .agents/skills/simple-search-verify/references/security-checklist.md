# 安全核对清单

修改 `index.js` 中的路由、鉴权、目录解析，或调整 `search.js` / `conversation.js` 的目录与上限约束时，逐项核对以下条目。完整威胁模型见 `../../../docs/SECURITY.md`。

## 路由与鉴权

- [ ] 插件的 `inject` 列表包含 `connection`；缺少该服务时不挂载。
- [ ] 所有路由 handler 都经过同一套鉴权与同源拦截逻辑，不存在「内部路由跳过校验」的例外。
- [ ] `connection` 缺失、为 `null` 或缺少 `requestRejection` 方法时，返回 `503 auth-unavailable`，绝不降级放行。
- [ ] `requestRejection` 抛出异常时返回 `403`。
- [ ] `requestRejection` 返回 `401`、`403` 或其他数字状态码时原样透传状态码，响应体 `code` 为 `forbidden`。
- [ ] `Host` 头无法解析为合法 URL 时返回 `403`。
- [ ] `sec-fetch-site: cross-site` 返回 `403`。
- [ ] 存在 `Origin` 头且与 `Host` 不同源时返回 `403`；`Origin: null` 返回 `403`。
- [ ] 非回环地址上的非 GET 请求返回 `403`。
- [ ] 所有路由严格只读，不提供写文件、修改工作区或执行命令的能力。

## 目录解析

- [ ] 默认搜索根目录只来自当前会话工作目录或已注册工作区，不回退到 `process.cwd()`。
- [ ] 显式传入的 `root` 先做 `path.resolve` 和 `realpath`，再校验是否落在会话目录或已注册工作区内。
- [ ] 路径包含关系通过 `isWithin` 按路径段边界判断，不使用字符串前缀匹配。
- [ ] 目标目录不存在返回 `422 bad-root`，越界返回 `403 denied`。
- [ ] 符号链接和 `..` 无法绕过 `realpath` 校验。

## 搜索与上限控制

- [ ] 空查询、超长查询或非法正则返回 `400 invalid-pattern`。
- [ ] 路由参数 `limit` 被限制在 `MAX_MATCHES`（会话路由为 `MAX_CONVERSATION_MATCHES`）以内，单文件命中受 `MAX_MATCHES_PER_FILE` 限制。
- [ ] 超时预算、遍历目录项上限与单文件大小上限均正常生效。
- [ ] 排除目录列表由 `SKIP_DIR_NAMES` 统一派生并由两个引擎共用，调用方没有另起一份。
- [ ] 错误信息不泄露未授权路径的目录或文件内容。

## 测试覆盖

- [ ] `tests/route.test.mjs` 覆盖：缺少服务 503、`null` 503、抛错 403、拒绝码透传、跨站 403、目录越界 403。
- [ ] `scripts/verify-auth-fence.mjs` 跑满 6/6；新增鉴权分支时同步补充对应场景。
- [ ] 版本号测试仍校验 `/version` 与 `package.json` 一致。

只要有任意一项无法确认勾选，立即停止推进，不要以「其他测试都过了」为由跳过。
