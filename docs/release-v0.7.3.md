# v0.7.3 — skill 文档与实现对齐（含 Open Design 产物取回）

> 详见 [CHANGELOG](../CHANGELOG.md#073---2026-09-28) 与 [skill 正文](../skills/tianshu-mcp/SKILL.md)。

## 背景

`skills/tianshu-mcp/` 的文档（`SKILL.md` 321 行 + `usage-examples.md` 627 行）曾与实际实现脱节：
正文里没有 `v0.7.1` 新增的产物取回能力，`usage-examples.md` 还出现了**两个 `### 2.9`** 的编号冲突。
本版把文档拉回与代码一致，并借重写补齐了几处易误导的表述。

## 修复

- **`usage-examples.md` 编号冲突**：`### 2.9 通用约定` → `### 2.10 通用约定`
  （与它上面的 `### 2.9 codex-cli` 撞号）。
- **`SKILL.md` §9 错误码表补上「这是子集而非闭集」的显式声明**：`endReason` 在类型层面只是一个
  可选 `string`（`src/agents/adapter.ts:93`），没有枚举约束，适配器新增分支时无需改类型即可引入新取值。
  读者遇到表外取值时，应去读对应适配器的 `run.ts`，而不是按名字猜语义。
- **补入未在表中、但真机高频出现的三个 `endReason`**：`input_mismatch`（输入框残留导致任务被插进残文）、
  `send_unknown`（无法确认消息落地，适配器**绝不重发**）、`reply_stable`（正常完成，非错误）。

## 新增（文档侧）

- **Open Design 产物取回**（`v0.7.1` 的能力，此前未进文档）：设计稿存在产品的产物存储
  `<dataRoot>/projects/<projectId>/<entry>` 而**不在任务目录**，终态后由适配器复制到 `projectPath`，
  视觉验收随后可推导静态入口。取回是**增值步骤**：失败只写进 `progressSummary`，**不改变终态**。
- **daemon 就绪前置**：产品打开文件夹选择器前要与 daemon 完成鉴权握手（实测启动后约 30s 才驻留），
  未就绪时产品**根本不弹对话框**，故适配器会先等 daemon。
- **`zip` 导出为已知限制**：产品主进程接管下载，CDP 的下载接管被覆盖；`html` 路径完全可用。

## 说明

本版**不含运行时代码变更**（仅 `skills/` 文档与版本号），因此从 `0.7.2` 升级无功能差异；
发布它的目的是让文档与实现同步，并让 `tag` / `Release` / npm 在同一 commit 上收敛。
