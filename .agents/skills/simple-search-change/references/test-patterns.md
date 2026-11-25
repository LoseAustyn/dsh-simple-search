# 测试编写模式

本仓库只使用 Node.js 内置的 `node:test`。写测试前先看 `../../../tests/AGENTS.md`；以下是三种常见测试模式的写法示例，供参考落点，无需整段照搬。

## 1. 搜索与会话核心（`tests/search.test.mjs`、`tests/conversation.test.mjs`）

直接 import 纯函数模块，文件搜索用例使用真实临时目录：

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

适用场景：匹配逻辑、排序打分、上限控制、排除目录、Node 回退遍历与会话提取。不要 mock `fs`。

## 2. 服务端路由（`tests/route.test.mjs`）

通过 `apply()` 配合 `fakeContext` 捕获路由 handler 并直接调用：

```js
const { ctx, routes } = fakeContext({
  workspaceRegistry: { list: () => [{ path: root, updatedAt: new Date().toISOString() }] },
})
apply(ctx)
const { status, body } = await call(routes.get('/dsh-simple-search/search'), '/dsh-simple-search/search?q=needle')
assert.equal(status, 200)
```

适用场景：鉴权拦截、目录解析、统一响应格式与错误码映射。不要在单测里监听端口，真实 HTTP 场景统一写在 `scripts/verify-auth-fence.mjs`。

## 3. 浏览器端（`tests/client.test.mjs`）

用 `vm.runInNewContext` 加载 `client.js`，传入精简版 mock React 与 `localStorage`：

```js
const sandbox = {
  window: { localStorage: createStorage(), __ModuleLoader__: { load(def) { factory = def.factory } } },
  document: { body, baseURI: 'http://localhost/' },
  console, URL, AbortController,
}
vm.runInNewContext(SOURCE, sandbox, { filename: 'client.js' })
const plugin = factory(name => name === 'react' ? createReact() : (() => { throw new Error(name) })())
```

适用场景：插槽注册、外观偏好、主题跟随、范围切换、标题匹配与引用插入。不要引入 jsdom，mock React 只实现被测组件实际用到的 hook。

## 基本要求

- 新测试先验证能失败：在修复代码前跑一次，或临时改坏断言确认它会红。
- 新增测试文件必须加进 `package.json` 的 `test` 脚本。
- 断言对外行为和返回结果，不要绑定内部 helper 的调用顺序。
- 临时目录用 `mkdtemp` 创建并在 `after` 中清理，不写入仓库目录。
- 涉及鉴权、目录边界、只读限制和上限控制的断言属于安全底线，不得为跑通测试而放宽。
