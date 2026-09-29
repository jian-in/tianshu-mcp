# v0.7.5 — Qoder CN 0.4.2/0.4.3 适配与验收引擎 cwd 归一

> 详见 [CHANGELOG](../CHANGELOG.md#075---2026-09-29)。

## 背景

Qoder CN 的界面契约在 `0.4.2` / `0.4.3` 连续变动，使 `qoder` 适配器在两类场景上失败：

- **新会话**：稳定卡在「工作区绑定」阶段，报 `qoder_stage_timeout: workspace-menu`（下拉菜单打不开）。
- **恢复会话**（`continue_task` / 自动返修）：报 `qoder_workspace_mismatch: expected=..., actual=`（已绑定工作区读回为空）。

两处症状都落在派单链的前半段，任务书无法送达，`autoFixRounds` 无从发挥作用。

## 改动

### 1. 工作区入口的候选顺序（0.4.3）

`0.4.3` 的输入栏 picker 去掉了 `aria-label`「切换或清空当前工作区…」，主选择器 0 命中后落到宽泛回退
`button[aria-expanded][aria-label*="工作区"]` —— 而它命中的是**侧栏「工作区」区域头**（`aria-label` 恰为
「工作区」、`aria-expanded="true"`）。点击它不弹下拉，于是超时。

修复：把稳定标记 `[data-workspace-picker-trigger]` 提到宽泛启发式之前（`0.4.3` 实测该标记唯一命中，
点击可正常打开菜单）。

### 2. 「菜单已打开」判定收窄

旧判定是「搜索框**或**任一 `[role=menu][data-state=open]` 浮层」，泛化项会被页面无关浮层命中而**假通过**，
随后去找搜索框才发现菜单根本没开。现收窄为**只认搜索框** `workspaceSearch`；点击落空时短促复核并重试一次，
两次都不成立才判失败。

### 3. 已绑定工作区的读回（0.4.3）

`0.4.2` 及以前路径挂在 `[data-conversation-workspace][title]` 上；`0.4.3` 该容器**无 `title`**，路径落在
内层 `aria-label`。修复：容器侧并列全部候选并回退 `aria-label`/文本；**picker 侧仍只认 `title`** ——
它的 `aria-label` 是提示语而非路径，不能当路径读。

### 4. 模型选择器链（0.4.2）

`0.4.2` 的模型菜单移除了「默认/自定义」分组 tab，候选变成一张**平铺列表**，模型名也从 `aria-label`
移到触发器文本。适配后新增 `QoderCdpClient.resolveKey()` / `textKey()`，供需要把选择器拼进组合式查询的
调用方取**首个命中候选**（只用 `selector()` 取 primary 会让多候选形同虚设）。

### 5. 验收引擎的 cwd 盘符归一（Windows）

项目路径可能以小写盘符登记（例如 `projects.json` 里的 `e:/proj`），而 vite/vitest 按**路径字符串**建模块图
与缓存键：`e:\proj` 与 `E:\proj` 被当成两个位置，同一模块出现两份实例，表现为收集期崩溃。
`runVerifyCommand` 现在在 spawn 前用 `fs.realpathSync.native` 把 cwd 归一为磁盘真实形式；路径不可解析时
退回原值，归一失败不阻断验收。

## 致谢

感谢 **@jian-in**（Bofei Jian）在 [PR #26](https://github.com/lanlan0811/tianshu-mcp/pull/26) 中提供的
Qoder CN 0.4.2/0.4.3 适配 —— 真机探针数据、失败链定位与随附回归测试都来自该 PR。

## 验证

- **RED → GREEN（决定性证据）**：把本版新增的 Qoder 回归用例放到基线源码（`e59d10c`）上运行得到
  **4 failed / 18 passed**，回到修复后同一组全绿 —— 用例确实锁定缺陷，不是永真断言。
- **全量**：`421 suites / 1396 passed / 0 failed`（12 skipped）；`typecheck` / `lint` / `build` /
  `check:stdio`（8 场景）全部通过；构建后工作树无意外改动。
- **CI**：目标提交的 `CI` 工作流 22/22 全绿（含 ubuntu / macos / windows 三平台与 Node 20/22/24）。
- **未覆盖**：`0.4.2`/`0.4.3` 的选择器结论来自 PR #26 的真机记录，本机无 Qoder CN 环境，未做真机复验；
  纯单测只能锁定查询契约（测试替身不解析真实 DOM）。

## 升级说明

从 `0.7.4` 升级无破坏性变更。`0.3.4` 路径的既有行为保持不变；Qoder CN `0.4.2`/`0.4.3` 从「卡在工作区绑定」
变为可用。
