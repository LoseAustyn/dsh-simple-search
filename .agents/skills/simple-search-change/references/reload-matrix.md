# Reload matrix

改完后按改动面选择生效方式；完整说明见 `../../../docs/DEVELOPMENT.md`。

| 改动 | 为什么需要这样做 | 生效 | 验证 |
|---|---|---|---|
| `index.js`、`search.js` | 宿主按真实路径缓存 ESM；`link:` 包不会因文件改动重新求值 | `remove_bundle` 后把目录改成新名字再 `install_bundle`，或重启宿主 | `curl /dsh-simple-search/version` 的 `version`/`pid` 变化；`npm run check:auth` |
| `client.js` | 浏览器模块在页面加载时执行 | 刷新页面；`pnpm run dev:web` 在跑时客户端 bundle 可热替换 | 双击 Shift、外观卡 |
| `package.json`、`cordis.patch.yml` | Loader 在安装时读取清单 | 重装 bundle + 刷新 | `install_bundle` 返回 `applied`、`warnings=[]` |
| `locale/*.json`、`icon.svg` | 安装时复制/暴露资源 | 重装 + 刷新 | 插件详情页标题、描述、图标 |
| `tests/`、`scripts/` | 不进入运行时 | 无需重载 | 对应命令 |

## 命令

```sh
# 宿主半：安装后自检
curl -s http://127.0.0.1:3080/dsh-simple-search/version

# 认证栅栏（不需要运行中的 DSH）
npm run check:auth

# 客户端注册（有 inspect 工具时）
# cordis_inspect_query Slots.listSubTree root=shell.overlay
#   → occupant id "simple-search", active true
```

## 判定

- `install_bundle` 以 `application=applied` 且 `warnings=[]` 为成功；日志、进程列表、页面 boot payload 都不算。
- `/version` 返回 401 是“路由已注册但没有页面 cookie”；404 才是“未注册”。
- 宿主半只跑测试不算生效：测试直接 import 文件，页面用的是宿主缓存模块。
- 没有运行中的浏览器控制时，交互与视觉只能标“待用户确认”。
