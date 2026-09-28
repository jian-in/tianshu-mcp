# v0.7.4 — ZCode 3.14.x 项目绑定修复（issue #24）

> 详见 [CHANGELOG](../CHANGELOG.md#074---2026-09-28)。

## 背景

issue #24 报告：在 ZCode `3.14.x` 上，**所有带 `projectPath` 的派单**都必定失败于
`endReason: "project_mismatch"` —— 项目被真实导入成功，随后绑定复检仍然失败，任务书**从未送达 agent**。

失败发生在发送之前，所以 `autoFixRounds` 形同虚设（`roundsUsed` 恒为 0），用户只看到一句
「项目绑定回读与 projectPath 不一致」，无从自救。`projectPath` 是 `run_task` 的两大核心参数之一，
因此 3.14.x 上**整个有项目派单面不可用**。

## 根因

ZCode 3.14.x 删除了 tianshu-mcp 用于**绑定回读**的两处 DOM 契约：

| 契约 | 3.11.x | 3.14.x（issue 实测） | 谁依赖它 |
|---|---|---|---|
| `data-project-path` | 有 | **0 命中** | `pathOf()`（`src/agents/zcode/dom.ts:27`） |
| `data-testid^="workspace-item-"` | 有 | **0 命中** | 同上 + `cdp.projects()`（`src/agents/zcode/cdp.ts:279`） |

于是 `workspaceBinding().projectPath` 恒为空、`projects()` 恒为 `[]`：绑定判据（路径判等）永不成立，
`ensureProjectBound()` 的循环里 `if (!item) continue` 一路空转到预算耗尽，最终 `project_mismatch`。

附加的阻断点：即便把项目列表的数据源换成菜单，旧 `matchZcodeProject()` 也**只按 `item.path` 精确匹配**
（name 分支只产歧义、不产 item），所以数据源修好了也不会被消费。

## 修复

分四处，同源于一个根因：

- **`selectors.ts`**：新增 `projectMenuItem`（`[role="menuitemcheckbox"]`）；`projectItem` / `projectPath`
  显式标注为 3.11.x 契约（3.14.x 已失效）。
- **`dom.ts`**：`workspaceBindingExpression()` 增补 `projectName`（当前绑定显示名）与 `menuChecked`
  （菜单中 `aria-checked="true"` 的显示名），多勾选判歧义。**不伪造路径**——3.14.x 下 `projectPath`
  仍为空串，判定层据此区分证据等级。
- **`cdp.ts`**：`projects()` 改为「旧契约完全落空时才从展开菜单采集」，含勾选态、排除
  「不在项目中工作」。3.11.x 的采集结果逐字不变。
- **`project.ts`**：`matchZcodeProject()` 增加**显示名精确匹配**分支并返回 `matchedBy`；
  新增 `boundProjectVerdict()` 实现分层判据 —— **路径可得时严格判等（原语义不变），
  无路径渠道时按显示名**，并要求项目列表无同名歧义。无法唯一确认时继续 fail-closed。

同时修掉一条被掩盖的脆弱时序：`ensureProjectBound()` 原先接受外部传入的 item，使「菜单是否恰好还开着」
成为隐式前提；现改为幂等自检（每轮先读判定，已绑定即通过）。绑定失败的错误信息也补齐了
「触发器文本 / 菜单勾选态 / 路径回读」三项诊断。

## 行为边界（重要）

- **3.11.x 不受影响**：路径可得时仍走原有严格判等，既有用例逐条保持通过。
- **3.14.x 无法取得项目绝对路径**，因此判据是「显示名 + 全局同名消歧」。同名项 > 1 直接判
  `project_ambiguous`（fail-closed），**不会猜测**。代价是「同名不同路径」的两个项目无法区分 ——
  此时明确失败，而不是静默错投。
- 消歧需要菜单已展开（那是项目列表的数据源）；菜单收起时只凭显示名证据，**不因列表缺失而否定绑定**。

## 验证

- **本地 RED → GREEN（决定性证据）**：先在 `linkedom` 夹具上构造 3.14.x 形态的 DOM
  （只有触发器 + 展开的 `menuitemcheckbox` 菜单，刻意不含两处旧契约），确认 3 处断言失败
  （`projectName`/`menuChecked` 缺失、`projects()` 为空、多勾选不判歧义），再修到全绿。
- **新增 14 用例**：DOM 层 4、判定层 6、编排层 4（含**反例**：缺少显示名证据时仍 fail-closed
  且错误信息带诊断）。
- **全量 1383 passed / 12 skipped**（1395 项，115 文件 + 3 个真实浏览器文件按设计 skip）；
  `typecheck` / `lint` exit 0。
- **真机边界**：本机没有 ZCode 3.14.x，**未在真机复验**。issue #24 的真机实测数据未被独立复现，
  修复按该契约设计。新增 `npm run probe:zcode -- dom-contracts` 供有 3.14.x 环境的维护者复核：
  它会输出两处旧契约的命中计数、触发器全属性、菜单项清单与修复后的回读结果。

## 升级说明

从 `0.7.3` 升级无破坏性变更。3.11.x 行为完全不变；3.14.x 从「必定失败」变为「可正常派单」，
并在无法唯一确认绑定时仍然明确失败（而不是猜测）。
