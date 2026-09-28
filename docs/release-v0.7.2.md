# v0.7.2 — 修复 CI 跨平台耦合（tag / Release / npm 收敛）

> 详见 [CHANGELOG](../CHANGELOG.md#072---2026-09-28)。

## 背景

`v0.7.1` 的 **npm 包已发布且 `dist` 内容正确**，但其 tag 指向的 commit 上 CI 是红的，
导致 `Release` workflow 的「Require successful CI for this commit」门禁拒绝发布 ——
于是出现「npm 有了、GitHub 没有发行版」的不一致。本版修掉根因并补发，让三者收敛。

## 修复

- **CI 在 ubuntu / macOS 全腿失败**（`test/unit/opendesign-discovery.test.ts`）：
  `DevToolsActivePort` 候选路径用例只注入了 `APPDATA`，而生产里 `devToolsActivePortPaths`
  **按宿主平台取基址**（win32 用 `APPDATA`，其他平台用 `HOME/Library/Application Support`）——
  ubuntu/macOS 腿上基址走了 `HOME` 分支，断言必然不匹配。

  这是**同一族缺陷的第三次出现**（前两次在 `discoverOpenDesign` 的候选路径与版本回读上），
  共性是「断言与宿主平台耦合，只在某一类机器上通过」。修法：用例按宿主平台注入对应 env
  并算出对应期望值，与生产同源。

## 影响

| 项 | `v0.7.1` | `v0.7.2` |
|---|---|---|
| npm 包 | 已发布，`dist` 正确 | 已发布 |
| tag | 指向 CI 失败的 commit | 指向 CI 通过的 commit |
| GitHub Release | 未能创建 | 由 workflow 创建 |

## 说明

`v0.7.1` 与 `v0.7.2` 的**运行时代码完全相同**，差异仅在测试文件。
若你此前已安装 `0.7.1`，无需为此升级；本版的意义是让 tag / Release / npm 在同一 commit 上对齐。
