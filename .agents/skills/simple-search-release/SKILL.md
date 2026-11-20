---
name: simple-search-release
description: "Use when bumping the dsh-simple-search version, updating CHANGELOG, packing, tagging, publishing, or installing a release; keeps version, package contents, tag, and remote state consistent."
---

# Simple Search release

用于升版、打包、打 tag、发 GitHub Release。发布动作需要用户明确授权；本 skill 不替代授权。

## 1. 前置

```sh
git status --short --branch
npm run check
git ls-remote --heads origin main
```

- 工作区必须干净；`check` 必须绿。
- 先确认分发方式：当前 `private: true`，通过 profile `link:` 安装；如果要发 npm，先单独决策并改 `private`/`publishConfig`，不要在本流程里顺手改。
- 远端已有新提交时先停止，不要覆盖。

## 2. 版本

只改 `package.json` 的 `version`。`index.js` 已从 `package.json` 读取版本，不要再加常量。

```sh
node -p "require('./package.json').version"
```

同步 `CHANGELOG.md`：把 `Unreleased` 条目移到 `## [x.y.z] - YYYY-MM-DD`，写用户可见行为、兼容性、迁移说明；不复制 commit 列表。

## 3. 验证

```sh
npm run check
npm pack --dry-run
```

检查：

- 单测与认证全绿。
- 包内容包含 `index.js`、`search.js`、`conversation.js`、`client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`、`README*.md`、`LICENSE`、`package.json`。
- 不包含 `tests/`、`scripts/`、`docs/`、`.github/`、`*.tgz`。

安装验证：

```sh
# 用 plugin_manager install_bundle，target 为本目录绝对路径
# 期望 application=applied、warnings=[]
curl -s http://127.0.0.1:3080/dsh-simple-search/version
```

`/version` 返回的 `version` 必须等于 `package.json`。没有安装条件时，把安装验证标为“待验证”。

## 4. 提交与打 tag

```sh
git add package.json CHANGELOG.md
git commit -m "Release x.y.z"
git tag vx.y.z
git push origin main --tags
git ls-remote --heads origin main
git ls-remote --tags origin "vx.y.z"
```

- 推送前确认远端 main 仍是预期 SHA；被移动则停止。
- 不使用 `--force`；需要改写历史时先问用户。
- 推送后用 `git ls-remote` 复核，不沿用本地推断。

## 5. 报告

```text
Version:   x.y.z
Commit:    <sha>
Tag:       vx.y.z
Remote:    main=<sha>, tag=<sha>
Package:   dsh-simple-search-x.y.z.tgz (dry-run: N files)
Verified:  npm run check, auth 6/6, /version
Unverified: npm publish / 真实用户安装（如未做）
```

## 成功判据

- 版本只在 `package.json`；`/version` 与之一致。
- `CHANGELOG.md` 有对应条目。
- 包内容符合预期，无测试/开发文件。
- 远端 main 与 tag 的 SHA 已用 `git ls-remote` 复核。
- 未执行的发布/安装动作明确标注，不写成已完成。

## 停止条件

- 工作区不干净或 `check` 红。
- 远端 main 已移动、tag 已存在且不是本次目标。
- 需要改分发方式、执行 `npm publish` 或强推，但用户未明确授权。
