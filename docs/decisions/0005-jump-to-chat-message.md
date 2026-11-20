# 0005 本会话命中跳转到 Chat 消息

Status: accepted
Date: 2026-11-20

## Context

本会话内容搜索最初只能复制命中消息。用户要求跳到具体位置。

DSH 0.2.2-rc.4 没有公开的 “reveal message” 服务：

- `ChatView` 的 `TurnNavigator` / `viewport.scrollToTurn` 是组件内部状态，不对外暴露。
- `conversation.openView(view, focus)` 的 `focus` 目前只有 trajectory 视图消费，Chat 视图忽略它。
- 插件拿不到 ChatView 的 viewport，也没有 `scrollToMessage` 之类的服务。

同时 DSH 提供了两个可用的事实：

- Chat 的 flow row 渲染 `data-chat-anchor-key`：response 行等于 Conversation 的 `${kind.length}:${kind}${id}`，assistant 的 reasoning 行是 `["<key>","reasoning"]`；两行共用 `data-chat-node-key`，按后者查询会命中不可见的 reasoning 行。
- `SessionFace.loadThrough(seq)` 是公开接口，可以把历史窗口加载到指定事件，用于聊天里的 turn 跳转。

## Decision

采用插件内 best-effort 跳转：

1. 宿主在每条命中里返回 `seq`、`turn`、`step`、`messageId`，全部来自事件本身。
2. 客户端按 `${kind.length}:${kind}${id}` 计算锚点：用户消息 `input-message` + 消息 id，assistant `assistant-step` + `turn:step`；查询限定在该 Session 的 `[data-conversation-session]` 容器内，避免侧栏另一个会话的同键节点被误命中。
3. 按 `data-chat-anchor-key` 精确匹配 response 行（不能按 `data-chat-node-key`，否则 assistant 会命中 reasoning 行）；行已挂载时直接 `scrollIntoView({block:'center'})`。
4. 行不在已加载窗口时，用 `ctx.sessions.retain(sessionId, {source:'simpleSearch'})` + `await reference.ready` + `session.loadThrough(seq)`，释放引用后最多等 1.5 秒让 React 提交，再查找锚点。
5. 找不到锚点（停在别的 Conversation View、旧 DSH、无 Chat 视图）时复制消息文本并提示“未找到聊天位置，已复制消息内容”。查询限定在该 Session 的 `[data-conversation-session]` 容器内，避免侧栏会话同键冲突。

插件只读取 `data-chat-anchor-key`，不修改 Chat 的 DOM、状态或样式。

## Consequences

- 用户能从搜索结果直接落到消息；失败时仍有复制可用。
- 依赖 DSH 内部的节点键格式与 `data-chat-anchor-key` 属性（response 行规则）；DSH 升级后若改变，跳转退化为复制（搜索不受影响）。
- 需要在 Chat 视图且会话已挂载；其他视图不跳转。
- 不新增数据暴露：`turn`/`step`/`messageId` 本就随事件到了页面。
- 自动化测试只能覆盖锚点计算、DOM 查询与点击路径；真实滚动需要浏览器人工验收。

## Alternatives

- **点击 TurnNavigator 的 turn 标记**：只有 turn 粒度，标记依赖本地化 `aria-label`，比节点键更脆。放弃。
- **在 DSH 核心新增 `revealMessage` 服务**：更干净、可复用，但需要改 DSH 宿主/客户端并重启，超出本插件范围；若上游以后提供，插件可以改为优先调用该服务、保留复制回退。
- **只打开会话不跳转**：不满足“跳到具体位置”。放弃。
