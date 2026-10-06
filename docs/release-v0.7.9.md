# v0.7.9 — 文档面补齐与 npm 打包白名单修复

> 详见 [CHANGELOG](../CHANGELOG.md#079---2026-10-06)。

## 背景

v0.7.8 发布了 MiniMax Code 适配器（`src/agents/minimax/` 全套 + `docs/minimax-cdp.md`），
但**只更新了那一份新文档**——仓库里其它所有「描述 agent 的地方」都还停在 opendesign，
包括双语 README 的正文、`docs/agent-profiles.md` 的 agent 清单，以及 **`skills/tianshu-mcp/`
下的编排技能**（`SKILL.md` / `usage-examples.md`）。

同时发现一个**更早就存在的打包缺陷**：README 有 3 处（含顶部导航）指向 `docs/agent-profiles.md`，
但该文件不在 `package.json` 的 `files` 白名单里——**从 npm 安装的用户点进去是 404**。

本版**无代码逻辑变更**，只补齐文档面与打包白名单。

## 改动

### 1. 修复 npm 包内 `docs/agent-profiles.md` 死链

补入 `docs/agent-profiles.md` 与 `docs/agent-profiles.en.md`。
（该缺陷在 0.7.8 之前就存在，不是 0.7.8 引入的。）

### 2. 补齐 4 个文档面的 MiniMax Code 说明（共 23 处）

| 文件 | 处数 | 补的是什么 |
|---|---|---|
| `README.md` / `README.en.md` | 各 5 | Agent 横幅、`continue_task` 恢复语义列表、**agent 能力表新增 `minimax` 行**、`reasoningLevel` 校验规则脚注、版本线历史表 |
| `docs/agent-profiles.md` / `.en.md` | 各 4 | `adapter` 枚举注释、`driver=gui` 表格的 agent 列表（**此前连 qoder / opendesign 也漏了**）、文档互链、**新增完整 `minimax` profile 示例段** |
| `skills/tianshu-mcp/SKILL.md` | 35 | 头部 `description` 与 `triggers`（**没有它们，技能的关键词触发就命中不了 minimax**）、工具面 `continue_task` 支持列表、§3.1 参数兼容矩阵新增第 8 列与 `contextWindow` 行、§3.2 新增 minimax 小节、§3.3 平台状态、§5 恢复矩阵六类 `needsUserKind` 与锚点字段、§9 六条错误码 |
| `skills/tianshu-mcp/usage-examples.md` | 9 | **新增 §2.9 minimax 完整示例**（含四种模型形态的候选对照表）、`codex-cli` 小节顺延（**修掉原文重复的两个 `### 2.10`**）、参数拒绝表补 `contextWindow`、`autoFixRounds` 缺省、会话锚点字段表 |

### 3. 文档里的断言都回源码核验，不凭记忆

具体值逐条对照实现，并对行为差异跑了实测探针：

| 文档断言 | 源码出处 |
|---|---|
| `defaultAutoFixRounds = 2` | `src/agents/minimax/profile.ts:86` |
| CDP 基准端口 `9999` | `src/agents/minimax/profile.ts:62` |
| 权限模式 `始终授权` | `src/agents/minimax/profile.ts:83` |
| Windows `ready` / darwin `research` | `src/agents/minimax/profile.ts:25` |
| `contextWindow` **仅 minimax** 可用 | `src/mcp/handlers.ts:476` |
| 接受 `中`/`medium`、`极高`、`最大`；**拒绝** `关闭思考` | `src/agents/minimax/model.ts:43-57`（实测确认） |

其中「**minimax 是唯一接受 `中`/`medium` 的适配器**」这条最容易被写错（其它 6 个都不接受），
它是 MiniMax Code 界面确实渲染该档位的结果，已在文档里显式标注。

## 验证

- `npm run typecheck` / `npm run lint` / `npm run build` 全绿；**全量测试无失败**（本版未改代码逻辑）。
- `npm pack --dry-run` 确认 `docs/agent-profiles.md`、`.en.md` 与 `skills/tianshu-mcp/` 均在包内。
- 中英对称核验：README 各 6 处、agent-profiles 各 17 处、SKILL.md 35 处、usage-examples 9 处提及 minimax。

## 已知限制

- `skills/` 的内容由 server 启动时同步到 `~/.rivet/skills/tianshu-mcp/`（内容 hash 变化才覆盖），
  **新会话生效**——升级后需重启 MCP 才会拿到本版技能文档。
