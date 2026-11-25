# 0005 本会话命中直接定位到 Chat 消息

Status: accepted
Date: 2026-11-20

## 背景

「本会话」内容搜索最初只支持复制命中消息，用户希望按回车后能直接定位到对话里的对应位置。

DSH 0.2.2-rc.4 尚未提供公开的「定位消息」服务：

- `ChatView` 的 `TurnNavigator` 与 `viewport.scrollToTurn` 属于组件内部状态，未对外暴露。
- `conversation.openView(view, focus)` 的 `focus` 参数目前仅被 trajectory 视图消费，Chat 视图会忽略它。
- 插件既拿不到 `ChatView` 的 viewport，也没有现成的 `scrollToMessage` 接口可调。

不过 DSH 提供了两个可利用的条件：

- Chat 视图的每一行都渲染了 `data-chat-anchor-key` 属性：回复行等于 Conversation 节点键 `${kind.length}:${kind}${id}`，助手思考行则为 `["<key>","reasoning"]`。由于两行共用同一个 `data-chat-node-key`，按后者查询会误命中隐藏的思考行。
- `SessionFace.loadThrough(seq)` 是公开方法，能把历史消息窗口加载到指定日志序号，本身就用于对话内的 turn 跳转。

## 决策

在插件侧实现尽力而为（best-effort）的消息定位，定位失败时回退为复制：

1. 服务端在每条命中中直接返回事件自带的 `seq`、`turn`、`step` 与 `messageId`。
2. 前端按 `${kind.length}:${kind}${id}` 计算节点键（用户消息用 `input-message` + `messageId`，助手消息用 `assistant-step` + `turn:step`），并把 DOM 查询严格限定在 `[data-conversation-session="<sessionId>"]` 容器内，防止误命中侧栏其他会话的同键节点。
3. 按 `data-chat-anchor-key` 精确匹配回复行（避免命中思考行）；若节点已在当前 DOM 中，直接调用 `scrollIntoView({block:'center'})`。
4. 若目标行尚未加载，先通过 `ctx.sessions.retain(sessionId, {source:'simpleSearch'})` 等待 `reference.ready`，调用 `session.loadThrough(seq)` 加载更早历史后释放引用，再最多等待 1.5 秒待 React 完成渲染后重新查找锚点。
5. 若仍找不到锚点（例如当前不在 Chat 视图、旧版 DSH 或锚点格式变化），则复制消息文本并提示「未找到聊天位置，已复制消息内容」。

插件只读取 `data-chat-anchor-key` 属性，不修改 Chat 视图的任何 DOM、状态或样式。

## 影响

- 大多数场景下用户可以从搜索结果直接跳到对应消息，失败时仍有复制兜底。
- 定位依赖 DSH 内部的节点键格式与 `data-chat-anchor-key` 约定；若未来上游变更格式，定位会平滑退化为复制，不影响搜索本身。
- 仅在主视图处于 Chat 视图且会话已挂载时生效，其他视图直接回退复制。
- 不增加新的数据暴露面：`turn`、`step`、`messageId` 本就随会话事件传到页面。
- 单元测试只能覆盖节点键计算、DOM 查询与回退分支，真实滚动效果需要人工在浏览器中验收。

## 备选方案

- **模拟点击 TurnNavigator 的 turn 标记**：只能定位到 turn 粒度而非具体 step，且依赖本地化的 `aria-label`，比节点键更脆弱，放弃。
- **在 DSH 核心新增 `revealMessage` 服务**：更干净且可复用，但需要改动 DSH 本体并重启，超出插件边界；若上游后续提供该服务，插件可直接优先调用并保留复制兜底。
- **只打开会话不滚动定位**：无法满足跳到具体消息位置的诉求，放弃。
