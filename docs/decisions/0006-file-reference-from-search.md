# 0006 从搜索面板插入 @ 文件引用

Status: accepted
Date: 2026-11-23

## 背景

在搜索面板里找到目标文件后，很常见的一步是把它作为 `@` 引用插入当前对话输入框。DSH 的输入框基于 Lexical 编辑器，文件引用通过携带 `draftRev` 的 CAS 操作插入（`slash/input-insert-reference` 事件与 `SessionInput.insertReference`），不能直接拼接 DOM 文本。

触发按键需要在「面板内选中后一步填入」和「不干扰输入框原有按键」之间做权衡。`Shift+Enter` 已被 DSH 固定用于换行，如果在输入框层拦截它会破坏换行体验。把快捷键绑定在搜索面板自身的 `keydown` 上，生命周期与面板挂载一致，关闭面板后自动解除，不会影响输入框任何按键。结合用户「在打开的面板里选中后按 `Alt+Enter` 直接插入」的明确诉求，决定采用面板内 `Alt+Enter`。

## 决策

- 在搜索面板的 `keydown` 中处理 `Alt+Enter`：当焦点在搜索框且当前选中项为文件名行或文本命中行时，把对应文件插入当前会话输入框；其他行不处理也不阻止默认行为。
- 目标会话取当前主视图会话（按 `uiSession.adapter.current` → `retainedBy.mainView` → `better-sidebar` 的 `sessionId` 顺序解析）。光标位置由会话级桥接组件（挂载在 `conversation.input.overlay`）通过 `inputActions.captureInsertion()` 同步给根浮层；面板打开期间输入框失焦，`captureInsertion` 会返回最近一次选区或文档末尾，并附带当前 `draftRev`。
- 插入调用会话公开输入接口：通过 `ctx.get('sessions').scope(id)` 和 `ctx.get('conversation').input.for(scope)` 拿到 `SessionInput`，调用 `insertReference({source:'reference', ref, appearance:'file', clipboardText: ref})`；成功后关闭面板并把焦点还给输入框。
- 若当前没有打开的会话、`insertReference` 返回 `false`（草稿冻结或版本号冲突），或旧版 DSH 缺少该接口，则回退复制 `@` 文本并弹出提示，不静默丢弃用户操作。
- 同期在面板内支持 `Tab` / `Shift+Tab` 循环切换三个搜索范围。

## 影响

- 输入框的 `Shift+Enter` 换行及其他快捷键完全不受影响，面板关闭后无残留事件监听。
- 依赖 DSH 0.2.x 的公开会话输入契约（`inputActions` 与 `conversation.input.for`），不直接操作输入框 DOM；`package.json` 中 `engines.dsh` 的上界 `<0.3.0` 即为此契约边界。
- 桥接组件作为 `conversation.input.overlay` 列表插槽的一个节点，自身渲染 `null`，不影响输入框布局；卸载时按会话 ID 清理映射，避免串用旧会话的 actions。
- 含空白字符的路径写作 `@"path"`；路径包含控制字符或引号而无法安全表示时，直接回退复制。
- 文本命中插入的也是文件引用（`@path`），不带行号——DSH 的文件引用语法没有行号字段。

## 备选方案

- **在输入框层用 `Shift+Enter` 唤起引用模式**：会破坏 DSH 的换行快捷键，且违背用户明确提出的面板内 `Alt+Enter` 交互，放弃。
- **在面板内用普通 `Enter` 插入**：`Enter` 已固定用于打开文件、切换会话或跳转消息，需要修饰键区分，放弃。
- **直接修改 contenteditable 或拼接草稿文本**：违反不修改输入框 DOM 的边界，绕过 `draftRev` CAS 会引发输入法、引用卡片和撤销栈冲突，放弃。
- **只插入纯文本 `@path`**：虽然模型能读懂，但缺少可点击的文件引用卡片；保留为插入失败时的剪贴板回退方案。
