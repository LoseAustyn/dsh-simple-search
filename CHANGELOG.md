# 变更日志

`dsh-simple-search` 所有值得注意的用户可见变更。格式遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号跟随
`package.json`。影响项目开发方式的面向 agent 的流程变更也会列出。

[English](CHANGELOG.en.md)

## [1.4.0] - 2026-11-23

### 新增

- **从面板插入 @ 文件引用**：在面板里选中文件名行或文件内的文本命中，按
  `Alt+Enter`，该文件即以原生 DSH `@路径` 引用（路径含空白时写作 `@"路径"`）
  插入当前会话输入框，面板关闭，焦点回到输入框。新增会话级
  `conversation.input.overlay` 桥接，发布输入框公开的 `inputActions`，使面板
  能取到光标位置；插入走会话公开的输入面板（`insertReference`）并尊重草稿
  修订。没有打开的会话、或输入框无法接受编辑（草稿冻结、旧版 DSH）时，改为
  复制 `@` 文本。
- **`Tab` 循环切换范围**：搜索框获得焦点时，`Tab` / `Shift+Tab` 按
  「工作区文件 → 会话标题 → 本会话」循环（反向同理）；页脚列出该按键。

### 变更

- 引用动作位于面板自身的按键处理中，只在面板打开期间存在。`Shift+Enter` 及
  输入框的其他快捷键均不受影响；面板页脚在工作区范围下显示 `Alt+Enter 引用`。
- 文本命中引用其所在文件（`@路径`）；DSH 文件引用没有行字段，插入的引用因此
  不含行号。
- 页脚只提示用户猜不到的按键——`Alt+Enter` 引用、`Tab` 切换范围与 `Esc`
  关闭；`↑`/`↓` 与 `Enter` 提示已移除。
- `README.md` 与 `CHANGELOG.md` 改为中文默认版本；英文版为 `README.en.md` 与
  `CHANGELOG.en.md`，两版互相链接。

## [1.3.0] - 2026-11-20

### 新增

- **跨工作区会话标题搜索**：新增「会话标题」范围，在页面已加载的会话目录中
  匹配会话标题、工作区目录名与会话 id；`Enter` 通过 `uiWorkspace` 打开所选
  会话，需要时切换到对应工作区。
- **本会话内容搜索**：新增「本会话」范围，通过新的受信任栅栏保护的宿主路由
  `/dsh-simple-search/conversation` 搜索当前会话的人类可见文本——人类 prompt
  与 assistant 回复；思考块、工具调用/结果、合成上下文与系统提示均被排除。
  `Enter` 在 Chat 视图中跳转到命中消息，必要时按消息 seq 先加载更早历史；没有
  可用的 Chat 锚点时回退为复制整条消息。
- `conversation.js`：纯提取/匹配核心，自带上限（`MAX_CONVERSATION_*`）、按最新
  优先的命中、有界单行摘录、正则与大小写选项；宿主按日志 cursor 缓存提取结果，
  并返回用于 Chat 跳转的 `turn`/`step`/`messageId` 标识。
- `tests/conversation.test.mjs`、会话路由测试与客户端范围测试；ADR 0004 记录
  标题搜索为何放在客户端、会话内容搜索为何放在宿主，ADR 0005 记录尽力而为的
  Chat 跳转及其复制回退。

### 变更

- 面板新增范围切换器（工作区文件 / 会话标题 / 本会话）；原有的
  「全部 / 文件 / 文本」标签只在工作区范围下出现。
- 错误分类新增 `bad-session`（422）、`not-found`（404）、`unavailable`（503）
  与 `timeout`（504）。

### 新增（面向 agent）

- 新增 `AGENTS.md` 与 `tests/AGENTS.md`，提供面向 agent 的开发说明；仓库只面向
  DSH（不再包含 Claude Code 兼容层）。
- 新增 `.agents/skills/` 流程：改动、验证与发布插件。
- 新增 `docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、`docs/SECURITY.md` 与
  `docs/decisions/` 决策记录，说明当前设计及其安全规则。
- 新增 `npm run check` 与运行同一道门的 GitHub Actions 工作流。

### 修复

- assistant 命中现在滚动到 assistant 的回复行：跳转改为匹配
  `data-chat-anchor-key`，因为 reasoning 行与 response 行共享同一个
  `data-chat-node-key`，按该键匹配会选中隐藏的 reasoning 行。
- `/dsh-simple-search/version` 现在返回 `package.json` 的版本，不再使用已漂移为
  `1.0.1` 的手写常量。

## [1.2.1] - 2026-11-19

### 新增

- 新增浏览器信任栅栏的路由测试，以及可复跑的
  `scripts/verify-auth-fence.mjs` 六场景检查。
- 新增 `repository` 元数据与中英双 README。

### 修复

- 宿主 Connection 服务缺失或无法拒绝请求时，两条路由都以
  `503 auth-unavailable` 失败关闭。

## [1.2.0] - 2026-11-18

### 新增

- 插件详情页新增浅色 / 深色 / 跟随 DSH 外观选项，保存在浏览器
  `localStorage`。

## [1.1.0] - 2026-11-18

### 新增

- 首个版本：双击 Shift 搜索文件名与工作区文本，优先使用 ripgrep，并提供有界
  回退遍历。
