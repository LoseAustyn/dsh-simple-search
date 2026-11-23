# Decisions

记录影响架构、安全、测试策略或分发方式的决定。一条决定一个文件，编号递增；状态变化时更新 `Status`，不要改写历史理由。

## 模板

```markdown
# NNNN 标题

Status: proposed | accepted | superseded
Date: YYYY-MM-DD

## Context
为什么需要决定；约束和触发条件。

## Decision
当前采用的方案，写现在时。

## Consequences
代价、收益、必须遵守的后续约束。

## Alternatives
认真考虑过但未采用的方案，以及为什么没采用。
```

## 索引

- [0001 路由认证 fail-closed](0001-fail-closed-auth.md)
- [0002 搜索不服从 .gitignore](0002-no-ignore-vcs.md)
- [0003 纯 JavaScript + node:test](0003-plain-js-node-test.md)
- [0004 会话标题在浏览器匹配、会话内容由宿主读取](0004-session-and-conversation-search.md)
- [0005 本会话命中跳转到 Chat 消息](0005-jump-to-chat-message.md)
- [0006 从搜索面板插入 @ 文件引用](0006-file-reference-from-search.md)

新增决定时同时更新本索引；不要把决定只写在提交信息或聊天里。
