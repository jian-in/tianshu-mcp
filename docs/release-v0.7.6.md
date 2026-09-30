# v0.7.6 — ZCode 项目绑定死锁、CDP 断连恢复入口与思考档位

> 详见 [CHANGELOG](../CHANGELOG.md#076---2026-09-30)。

## 背景

issue #27 报了三类会让 ZCode 任务卡死的缺陷：**项目发现渠道分裂导致绑定死锁**、
**CDP 断连被当成硬失败且无恢复入口**、**`reasoningLevel` 未实现 + 两级模型菜单点击不稳**。

本轮在真机 ZCode `3.14.3.7762`（Windows 10）上把三条全部复现、定位并修复，
并在真机上跑通了完整派发链路（项目绑定 → 模型切换 → 权限确认 → 发送 → 轮询终态 → 产物落盘）。

## 改动

### 1. 项目采集渠道分裂（绑定死锁的真根因）

`3.14.3` 上 `[data-testid^="workspace-item-"]` **并没有从 DOM 消失**——真机实测 **42 个节点中 40 个不可见**
（`getBoundingClientRect().top` 从 720 起，而视口高度只有 640，即被滚出视口）。

旧实现在采集 `projectItem` 时不做任何可见性过滤：

1. 幽灵项入列 → `out.length > 0` → `if (!out.length)` 短路恒为假 → **唯一可信的菜单渠道永不执行**；
2. `matchZcodeProject` 按 testid 派生的路径命中幽灵项 → 可用的**自动导入分支被跳过**；
3. 点击幽灵项不生效 → 有限重试全败 → `project_mismatch` → 任务书从未送达。

修复：`projects()` 对旧契约项做**可见性过滤**、两条渠道**始终合并**，同名的菜单项覆盖侧边栏项
（只有菜单项的 `aria-checked` 是 ZCode 自己渲染的绑定证据）。

### 2. 点击落空时回落导入

`clickProject` 现在返回可区分的原因（`trigger-unavailable` / `not-found` / `not-visible`）。
目标项在候选列表里、却**一次都没真正点中**时，回落 `selectZcodeFolder` 导入路径，
而不是直接判 `project_mismatch`；`allowCreateProject=false` 时仍在下一道闸门 fail-closed。

### 3. 运行期 CDP 断连的恢复入口

issue 的物理现场是「MCP 判定失败之后，agent 仍在写产物」——单次 `Runtime.evaluate` 超时或端点抖动
不等于 CDP 已死。发送阶段与运行期现在共用一条护栏：

- 首次断连**重连观察一次**（对齐 `codex` / `qoder` 的既有范式，**绝不重发任务**）；
- 重连失败或再次断连落 `needs_user(setup_recovery)`（可恢复出口，而非 `needs_attention` 死终点），
  并附上两侧事实：**进程是否仍在**（区分「已退出」与「端点无响应」）、**窗口是否仍有运行信号**。

### 4. `reasoningLevel` 与两级模型菜单

- **档位集合随模型变化**，因此在**模型确认之后**读取界面实际渲染的选项再校验：
  越权档位与「集合读不到」都在**发送前**报错（`reasoning_level_invalid`），绝不静默沿用；
  未指定档位时完全不触碰界面。真机契约：`chat-thought-level-select-trigger`（combobox）+
  `chat-thought-level-select-item-{enabled,disabled}`（二值 开启/关闭，选项仅在菜单展开时挂载）。
- **「两级模型菜单点击不稳」的根因**：模型项在 provider 分组的**二级子菜单**里，**必须 hover 分组**
  才渲染，click 会选中分组本身或收起菜单；provider 分组 testid 也已漂移为
  `chat-model-select-group-registry-provider:`。现在分组展开改用 hover，且两轮候选皆空时把菜单重开一次
  再试一轮，不凭一轮空列表判 `model_unavailable`。

### 5. 权限菜单契约漂移（真机测试暴露的同类缺陷）

`3.14.3` 的权限项 role 是 `menuitemradio` / `menuitemcheckbox`（**不是** `option`），
且可见名写在项内的**直接文本节点**里、后面跟一句说明（如「完全访问减少确认次数。」）。
旧实现两处都会 0 命中，导致派发卡在 `permission_unknown`。候选选择器补无 role 限制的兜底，
`clickExact` 的标签解析优先取直接文本节点。

## 真机验证

| 项目 | 命令 | 结果 |
|---|---|---|
| 项目采集契约 | `npm run probe:zcode -- dom-contracts` | `workspaceItems=42`（可见 2 / 不可见 40）、`dataProjectPath=0`；菜单展开后 `projects()` 返回菜单项且勾选态正确 |
| 模型/权限菜单 | `npm run probe:zcode -- models` / `permission` | provider 分组 testid `chat-model-select-group-registry-provider:new-provider`；权限项 role/文本结构如上述 |
| 思考档位 | 一次性探针 | `current=on`、`tiers=Off/On` |
| 端到端派发 | `npm run smoke:zcode` | `succeeded` / `reply_stable` / `permissionMode=完全访问`，耗时约 40 秒；**产物 `done.txt` 内容为 `issue27-ok`** |

## 升级建议

- 通过 MCP 派发 ZCode 任务时，若 `reasoningLevel` 指定的档位不在**该模型**的界面档位集合内，
  现在会在发送前直接报错（此前会静默沿用当前档位）。
- `continue_task` 对运行期 CDP 断连的处置从「任务已失败」变为「等待处理后继续观察原任务」——
  失败判定不再意味着 agent 已停，请以窗口内现场为准。
