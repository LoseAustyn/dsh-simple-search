# 架构决策记录（ADR）

本目录记录影响插件架构、安全边界、测试策略或分发方式的关键决定。每条决定单独成文、按编号递增；若后续状态发生变化，只更新 `Status` 字段，不改写当时的历史背景与理由。

## 模板

```markdown
# NNNN 标题

Status: proposed | accepted | superseded
Date: YYYY-MM-DD

## 背景
需要做决定的背景、约束条件与触发原因。

## 决策
最终采用的方案（用现在时描述）。

## 影响
带来的收益、代价，以及后续必须遵守的约束。

## 备选方案
认真评估过但未采用的方案及其放弃原因。
```

## 决策索引

- [0001 路由鉴权默认拒绝（fail-closed）](0001-fail-closed-auth.md)
- [0002 搜索不遵循 .gitignore](0002-no-ignore-vcs.md)
- [0003 保持纯 JavaScript 与 node:test](0003-plain-js-node-test.md)
- [0004 会话标题在浏览器匹配、会话内容由服务端读取](0004-session-and-conversation-search.md)
- [0005 本会话命中直接定位到 Chat 消息](0005-jump-to-chat-message.md)
- [0006 从搜索面板插入 @ 文件引用](0006-file-reference-from-search.md)

新增决定时请同步更新此索引，不要把重要权衡只留在 commit message 或聊天记录里。
