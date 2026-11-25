# 重载对照表

修改完成后，按改动类型选择对应的生效与验证方式；完整说明见 `../../../docs/DEVELOPMENT.md`。

| 改动文件 | 原因 | 生效方式 | 验证方式 |
|---|---|---|---|
| `index.js`、`search.js`、`conversation.js` | Node.js 按真实路径缓存 ESM 模块，`link:` 安装的本地包不会自动重新加载 | 先 `remove_bundle`，改目录名后再 `install_bundle`，或直接重启宿主 | `curl /dsh-simple-search/version` 核对 `version` / `pid` 变化；运行 `npm run check:auth` |
| `client.js` | 浏览器端模块在页面加载时执行 | 刷新页面；若正在运行 `pnpm run dev:web`，客户端 bundle 可热替换 | 人工验证双击 `Shift`、范围切换与外观设置卡 |
| `package.json`、`cordis.patch.yml` | 插件加载器仅在安装时读取清单 | 重新安装 bundle 并刷新页面 | `install_bundle` 返回 `applied` 且 `warnings=[]` |
| `locale/*.json`、`icon.svg` | 资源在安装阶段暴露 | 重新安装 bundle 并刷新页面 | 检查插件详情页的标题、描述和图标 |
| `tests/`、`scripts/` | 不参与运行时 | 无需重载 | 运行对应测试或检查命令 |

## 常用验证命令

```sh
# 服务端：安装或重启后检查路由响应
curl -s http://127.0.0.1:3080/dsh-simple-search/version

# 鉴权集成检查（无需启动 DSH）
npm run check:auth

# 检查客户端插槽注册（有 inspect 工具时可用）
# cordis_inspect_query Slots.listSubTree root=shell.overlay
#   → occupant id "simple-search", active true
```

## 判定标准

- `install_bundle` 必须以返回 `application=applied` 且 `warnings=[]` 为准；仅看日志、进程列表或页面 boot payload 不能算安装成功。
- `/version` 返回 `401` 表示路由已注册但缺少页面登录 cookie，属于正常现象；返回 `404` 才说明路由未注册或前缀不匹配。
- 服务端改动不能只看单测通过：单测直接加载源码文件，而运行中的页面走的是宿主缓存的旧模块。
- 没有浏览器自动化控制能力时，交互与视觉项只能标注为「待用户确认」。
