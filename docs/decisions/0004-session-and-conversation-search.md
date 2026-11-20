# 0004 会话标题在浏览器匹配、会话内容由宿主读取

Status: accepted
Date: 2026-11-19

## Context

插件需要两个新范围：

1. **会话标题搜索（可跨工作区）**：按标题找到任意工作区的会话并打开。
2. **当前会话内的内容搜索**：搜当前对话，但不包含模型思考过程。

约束：

- 插件零运行时依赖，不新增索引、不常驻监听、不写会话文件。
- 认证 fail-closed；任何读取会话内容的路由必须复用现有信任栅栏。
- 不把模型思考、工具流量或系统提示当成“会话内容”返回给搜索面板。
- DSH 的 `sessionQuery` 服务在 Web profile 中已挂载，但全文索引默认 `openAt: never`（只保留精确读取与标题折叠）。

## Decision

**标题在浏览器内匹配。** `ctx.sessions.list` 已经是覆盖所有工作区的目录快照（`ids`、`byId`、标题、cwd、更新时间）。`client.js` 在快照上按 `title`/`displayTitle`、工作区目录名（cwd 的 basename）与会话 id 做不区分大小写的子串匹配，排除空白占位与 subagent 子会话，按 `updatedAt` 倒序。`Enter` 通过 `ctx.get('uiWorkspace').openSession(id)` 打开；没有该服务时退回复制 id。打开面板时调用 `sessions.refresh()`。

**内容由宿主读取。** 新增 `/dsh-simple-search/conversation`：

- 复用同一 `fence`；校验 `sessionId` 白名单与查询长度。
- 只调用 `ctx.sessionQuery.observeSession(sessionId, {projectionMode:'none'})`，带 8 秒超时；不拼接会话文件路径，不直接读 `~/.dsh/sessions`。
- `conversation.js` 提取人类可见文本：`user/message` 且 `source.kind === 'user'`，以及 `assistant/message` 的 `text` 块。`reasoning`、`tool-call`、`tool/result`、`system/developer` 与合成上下文全部排除。
- 提取结果按日志 `cursor` 缓存（最多 3 个会话），日志追加后才重新提取。
- 上限由 `conversation.js` 拥有：5,000 条消息、200 条命中、单消息计数 50、返回文本 4,000 字符、摘录 260 字符。

## Consequences

- 标题搜索零延迟、零宿主成本，并且天然覆盖所有工作区；代价是只能匹配目录里已有的标题，不能做标题的模糊/语义搜索。
- 标题搜索只做主会话（排除 subagent 子会话与空白占位）；用户要打开子会话需要从所属会话进入。
- 内容搜索能读到加载窗口之外的历史，代价是一次会话观察与提取；cursor 缓存把连续输入的成本压到一次提取。
- 内容面是有意的产品边界：思考过程与工具流量永远不出现，因此用户不能靠这个面板搜“模型当时怎么想的”或命令输出。
- 依赖宿主的 `sessionQuery`；缺失时返回 `503 unavailable`，不退化成直接读日志文件。

## Alternatives

- **在 `~/.dsh/sessions` 上跑 ripgrep**：日志是 zstd 压缩的 v4 JSONL，需要解压、解析与格式跟随；还要自行判断哪些事件是思考/工具。放弃。
- **启用 `session-query-sqlite` 全文索引**：Web profile 默认 `openAt: never`；启用会引入持久索引、启动与磁盘成本，而且索引的是全部事件（含 reasoning/tool），仍需同一套过滤。放弃。
- **内容搜索也放在浏览器**：聊天记录是分页加载的，加载窗口之外的历史搜不到；需求是“当前会话内”，应覆盖完整日志。放弃。
- **标题搜索也走宿主**：需要为每个会话折叠标题（读取日志）或新增标题索引；目录快照已经包含标题，没有必要。放弃。
