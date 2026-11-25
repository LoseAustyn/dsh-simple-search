# tests/AGENTS.md

本目录存放基于 `node:test` 的行为测试。不要引入第三方测试框架、断言库、jsdom 或 Playwright。

## 文件分工

- `search.test.mjs`：覆盖 `search.js` 的核心搜索逻辑，使用真实临时目录。
- `conversation.test.mjs`：覆盖 `conversation.js` 的核心逻辑，通过事件样本验证用户消息、助手正文、思考/工具过滤与上限控制。
- `route.test.mjs`：通过 `apply()` 搭配 mock `ctx` 覆盖路由鉴权、目录解析、会话读取与响应格式。
- `client.test.mjs`：在 `vm` 沙箱中执行 `client.js`（搭配精简版 mock React 与 `localStorage`），覆盖插件注册、外观偏好、主题跟随、范围切换、标题匹配、消息跳转与复制回退、`Alt+Enter` 引用插入。
- `scripts/verify-auth-fence.mjs` 不在 `tests/` 内：它通过临时本地 HTTP 服务做真实鉴权集成测试，专门覆盖运行中 DSH 无法触达的 `connection` 缺失分支。

## 编写规范

- 断言可观察的行为与输出结果，不要耦合内部 helper 的调用顺序。
- 临时目录用 `mkdtemp` 创建，在 `after` 钩子中清理；不要修改仓库内文件，也不要依赖当前工作目录。
- 测试必须离线、独立：不联网、不依赖真实浏览器或运行中的 DSH。
- 路由测试直接用 `fakeContext` + `call` 调用 handler，不要监听端口；需要真实 HTTP 请求的场景放到 `scripts/verify-auth-fence.mjs`。
- 浏览器端测试用 `vm.runInNewContext` 运行 `client.js`，mock React 只实现被测组件实际用到的 hook。
- 写完新测试后，先确认它在代码修复前会失败（修之前跑一次，或临时改坏断言验证），避免写出永不失败的空断言。
- 新增测试文件时，记得加进 `package.json` 的 `test` 脚本，否则 CI 不会运行。
- 测试名称直接描述预期行为（例如 `reports the package version`），不要写含糊的 `should work`。
- 涉及鉴权、目录边界、只读限制和上限控制的测试属于安全底线，不得为了跑通而放宽或删除。
