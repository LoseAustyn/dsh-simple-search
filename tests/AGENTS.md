# tests/AGENTS.md

本目录是 `node:test` 的行为测试。不要引入测试框架、断言库、jsdom 或 Playwright。

## 归属

- `search.test.mjs`：`search.js` 的纯核心；可用真实临时目录。
- `conversation.test.mjs`：`conversation.js` 的纯核心；事件 fixture 覆盖人类 prompt、assistant 正文、思考/工具排除与上限。
- `route.test.mjs`：`apply()` + fake ctx；覆盖栅栏、根解析、会话观察、响应 envelope。
- `client.test.mjs`：`vm` 执行 `client.js` + fake React/localStorage；覆盖注册、外观偏好、主题跟随、范围切换、标题匹配与消息定位/复制回退。
- `scripts/verify-auth-fence.mjs` 不属于本目录：它是真实 loopback HTTP 的认证集成，覆盖运行中 DSH 到不了的 `connection` 缺失分支。

## 规则

- 断言可观察行为或响应，不断言内部 helper 的调用顺序。
- fixture 用 `mkdtemp` 创建，`after` 里删除；不写仓库内文件，不依赖当前工作目录。
- 不联网、不启动真实 DSH、不依赖浏览器。
- 路由测试用 `fakeContext` + `call`，不要监听端口；真实 HTTP 归认证脚本。
- 客户端测试用 `vm.runInNewContext` 执行 `client.js`；fake React 只实现被测组件用到的 hook。
- 新测试先证明能失败：修代码前跑一次，或临时回退断言确认它会红。
- 新增测试文件必须加进 `package.json` 的 `test` 脚本，否则 CI 不会跑。
- 测试名描述行为，例如 `reports the package version`，不要写 `should work`。
- 认证、根目录、只读、上限相关测试是安全不变量；不要为了通过而放宽或删除它们。
