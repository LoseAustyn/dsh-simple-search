# Test patterns

本仓库只使用 `node:test`。先读 `../../../tests/AGENTS.md`；下面是三种模式的落点，不是要复制整段测试。

## 1. 纯核心（`tests/search.test.mjs`）

直接 import `search.js`，用真实临时目录：

```js
const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'ss-search-'))
try {
  await fsp.writeFile(nodePath.join(root, 'a.txt'), 'needle\n')
  const result = await searchWorkspace({ root, query: 'needle', mode: 'text', preferWalk: true })
  assert.equal(result.matches[0].path, 'a.txt')
} finally {
  await fsp.rm(root, { recursive: true, force: true })
}
```

适合：匹配、排序、上限、跳过目录、回退 walk。不要 mock `fs`。

## 2. 路由（`tests/route.test.mjs`）

用 `apply()` + fake ctx 捕获 handler，直接调用：

```js
const { ctx, routes } = fakeContext({
  workspaceRegistry: { list: () => [{ path: root, updatedAt: new Date().toISOString() }] },
})
apply(ctx)
const { status, body } = await call(routes.get('/dsh-simple-search/search'), '/dsh-simple-search/search?q=needle')
assert.equal(status, 200)
```

适合：栅栏、根解析、envelope、错误码。不要监听端口；真实 HTTP 归 `scripts/verify-auth-fence.mjs`。

## 3. 浏览器半（`tests/client.test.mjs`）

`vm.runInNewContext` 执行 `client.js`，fake React/localStorage：

```js
const sandbox = {
  window: { localStorage: createStorage(), __ModuleLoader__: { load(def) { factory = def.factory } } },
  document: { body, baseURI: 'http://localhost/' },
  console, URL, AbortController,
}
vm.runInNewContext(SOURCE, sandbox, { filename: 'client.js' })
const plugin = factory(name => name === 'react' ? createReact() : (() => { throw new Error(name) })())
```

适合：注册、外观偏好、主题跟随、字典。不要引入 jsdom；只实现被测组件用到的 hook。

## 规则

- 新测试先证明能失败：修代码前跑一次，或临时回退断言。
- 新增测试文件必须加入 `package.json` 的 `test` 脚本。
- 断言行为/响应，不断言内部 helper 调用顺序。
- fixture 用 `mkdtemp`，`after` 清理；不写仓库内文件。
- 认证、根目录、只读、上限相关断言是安全不变量；不要为通过而放宽。
