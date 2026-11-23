# 0006 从搜索面板插入 @ 文件引用

Status: accepted
Date: 2026-11-23

## Context

按内容找到文件之后，下一步通常是把该文件作为 `@` 引用放进会话输入框。DSH 的输入框是
Lexical 编辑器：引用是带 `draftRev` 的 CAS 插入（`slash/input-insert-reference` 事件与
`SessionInput.insertReference`），不是可以安全拼接的 DOM 文本。

触发键需要在“面板内选中后直接填入”和“不占用输入框按键”之间取舍。`Shift+Enter` 已被 DSH
固定为换行；若在输入框层接管它会破坏换行。把按键绑定在面板自己的 keydown 里，绑定只在面板
挂载期间存在，关闭面板后自然消失，输入框的按键完全不受影响。用户明确要求“在打开的面板中选中
后按 Alt+Enter 直接填入”，因此采用面板内 `Alt+Enter`，而不是在输入框层触发引用模式。

## Decision

- 在搜索面板的 keydown 中处理 `Enter + Alt`：焦点在搜索框、当前行是文件名行或文本命中行时，
  把该文件插入当前会话输入框；其他行不动作，也不阻止默认行为。
- 目标会话是当前主视图会话（`uiSession.adapter.current` → `retainedBy.mainView` →
  better-sidebar 的 `sessionId`）。光标位置来自会话 slot 的公开
  `inputActions.captureInsertion()`；`conversation.input.overlay` 桥接组件按会话 id 把它
  发布给根浮层。面板打开时输入框不在焦点，`captureInsertion` 给出最后一次选择或文档末尾，
  并携带当前 `draftRev`。
- 插入走公开的会话输入面：`ctx.get('sessions').scope(id)` + `ctx.get('conversation').input.for(scope)`
  得到 `SessionInput`，调用 `insertReference({source:'reference', ref, appearance:'file',
  clipboardText: ref})`；成功后关闭面板并 `focus()` 输入框。
- 没有打开的会话、`insertReference` 返回 false（草稿冻结 / rev 不符）或旧版 DSH 没有输入面时，
  复制 `@` 文本并提示，不静默丢弃这次选择。
- 面板内 `Tab` / `Shift+Tab` 循环三个范围。

## Consequences

- `Shift+Enter` 与输入框的其他快捷键完全不受影响；面板关闭后没有残留绑定。
- 功能依赖 DSH 0.2.x 的公开会话输入契约（会话 slot 的 `inputActions`、`conversation.input.for`），
  不写输入框 DOM；`engines.dsh` 的上界 `<0.3.0` 是这层依赖的边界。
- 桥接组件是 `conversation.input.overlay` list slot 的一个条目，渲染 `null`，不改变输入框布局；
  卸载时按会话 id 清理映射，旧会话的 actions 不会被新会话复用。
- 含空白路径写作 `@"path"`；控制字符或引号无法被 mention 语法安全表示时直接复制回退。
- 文本命中插入的是文件引用（`@path`），不携带行号——DSH 的文件引用语法没有行号字段。

## Alternatives

- **在输入框层用 `Shift+Enter` 打开引用模式**：会破坏 DSH 的换行快捷键；且“打开面板后再绑定”
  无法用于打开面板。用户明确要求面板内 `Alt+Enter`。
- **在面板内用普通 `Enter` 插入**：`Enter` 已被“打开文件/会话/消息”占用，需要修饰键区分。
- **直接写 contenteditable 或拼接草稿文本**：违反“不修改输入框 DOM”，并绕过 `draftRev` CAS，
  会与输入法、引用 chip、撤销栈冲突。
- **插入纯文本 `@path`**：模型可读，但失去可点击的引用卡片；作为插入失败时的复制回退仍保留。
