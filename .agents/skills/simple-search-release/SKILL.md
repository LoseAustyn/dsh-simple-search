---
name: simple-search-release
description: "Use when bumping the dsh-simple-search version, updating CHANGELOG, packing, tagging, publishing, or installing a release; keeps version, package contents, tag, and remote state consistent."
---

# Simple Search 发布流程

适用于升版、打包、打 Git tag 及发布 GitHub Release。所有对外发布动作都需先获得用户明确授权，本流程不替代授权。

## 1. 发布前检查

```sh
git status --short --branch
npm run check
git ls-remote --heads origin main
```

- 工作区必须干净，且 `npm run check` 全部通过。
- 先确认分发方式：当前包为 `private: true`，通过 profile 的 `link:` 本地安装；如需发布到 npm，需另行决策并调整 `private` 与 `publishConfig`，不要在常规发布中顺手改动。
- 如果远端 `main` 已有本地未同步的新提交，立即停止，避免覆盖远端历史。

## 2. 更新版本号与变更日志

只需修改 `package.json` 中的 `version` 字段，`index.js` 会自动读取该值，不要在代码里另写版本常量。

```sh
node -p "require('./package.json').version"
```

同步更新 `CHANGELOG.md`（中文）和 `CHANGELOG.en.md`（英文）：将 `Unreleased` 下的条目归入 `## [x.y.z] - YYYY-MM-DD`，聚焦用户可见的变化、兼容性与迁移说明；两版内容保持一致，不要直接粘贴 commit 列表。

## 3. 打包与安装核验

```sh
npm run check
npm pack --dry-run
```

逐项确认：

- 单测与鉴权检查全部通过。
- 打包清单包含 `index.js`、`search.js`、`conversation.js`、`client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`、`README.md`、`README.en.md`、`LICENSE`、`package.json`。
- 不包含 `tests/`、`scripts/`、`docs/`、`.github/` 或 `*.tgz`。

若当前环境可安装验证：

```sh
# 通过 plugin_manager 的 install_bundle 安装本目录绝对路径
# 期望返回 application=applied、warnings=[]
curl -s http://127.0.0.1:3080/dsh-simple-search/version
```

确认 `/version` 返回的版本号与 `package.json` 一致；若无安装条件，在报告中标为「待验证」。

## 4. 提交、打标签与推送

```sh
git add package.json CHANGELOG.md CHANGELOG.en.md
git commit -m "Release x.y.z"
git tag vx.y.z
git push origin main --tags
git ls-remote --heads origin main
git ls-remote --tags origin "vx.y.z"
```

- 推送前再次确认远端 `main` 仍指向预期 commit，若有变动则停止。
- 禁止使用 `--force`；确需改写历史时先询问用户。
- 推送完成后用 `git ls-remote` 实测远端状态，不要凭本地记录推断。

## 5. 发布报告

```text
版本号：   x.y.z
提交：     <sha>
标签：     vx.y.z
远端核对： main=<sha>, tag=<sha>
打包清单： dsh-simple-search-x.y.z.tgz (dry-run: N 个文件)
已验证：   npm run check, auth 6/6, /version
待验证：   npm publish / 真实用户安装（如未执行）
```

## 完成标准

- 版本号只维护在 `package.json`，且 `/version` 与其一致。
- `CHANGELOG.md` 与 `CHANGELOG.en.md` 均已更新且内容对齐。
- 打包清单干净，无测试或开发辅助文件混入。
- 远端 `main` 与 tag 的 SHA 已通过 `git ls-remote` 复核。
- 未执行的发布或安装步骤如实标注，不写成已完成。

## 何时停下

- 工作区有未提交改动，或 `npm run check` 未通过。
- 远端 `main` 已前移，或目标 tag 已存在且指向不同提交。
- 需要调整分发方式、执行 `npm publish` 或强制推送，但尚未获得用户明确授权。
