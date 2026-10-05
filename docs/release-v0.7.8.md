# v0.7.8 — 第七个 GUI agent：MiniMax Code 适配器

> 详见 [CHANGELOG](../CHANGELOG.md#078---2026-10-06)。

## 背景

tianshu-mcp 的定位是「叫外部 AI-Agent 做开发 + 自动验收 + 失败返修」，每条 agent 接入线都是一个
GUI 适配器。本版接入**第七个**：MiniMax Code（`agentId=minimax`），与既有 traework / zcode / codex /
kimicode / qoder / opendesign 并列。

交付形态是 **计划 + 代码 + 本机真机闭环**，不只是「写完代码单元测试绿」——
GUI 适配器的正确性只能在真机上证明。

## 改动

### 1. 真机取证修正了三处结构假设（本版最有价值的部分）

实现前的假设来自产品前端产物与静态阅读；**真机 DOM 探测推翻了其中三处**，
每一处都会导致「看起来写对了、真机跑不通」：

| # | 原假设 | 真机实测 | 若不修正的后果 |
|---|---|---|---|
| 1 | 推理等级/上下文窗口是平铺的 `role="group"` | **只在悬停带 `aria-haspopup="menu"` 的模型项后才渲染**（出现第二个 `role="menu"`） | 档位集合永远读不到 → 报错说「界面不支持」，实际是自己没展开 |
| 2 | 各模型的档位/窗口集合一致 | **随模型变化**：M3.1 六档+窗口 / M3 仅窗口 / deepseek 三档 / M2.7* 无子菜单 | 对无子菜单模型静默沿用当前档，用户以为设了实际没设 |
| 3 | 点「新建项目」直接弹原生文件夹对话框 | **两步**：先弹应用内 HTML 模态框，模态框里点「选择文件夹」才弹原生 `Select Directory`，确认后还要点模态框的「创建项目」 | 原生对话框永不出现，被误判成选择器失效 |

还有一个隐蔽的坑：**二级子菜单容器是复用的**。不先移开鼠标就移入下一个模型项，不会触发
`mouseenter`，DOM 会**保留上一个模型的档位集合**——据此选档位会选到别的模型。
因此适配器读候选时按 `aria-label` 限定归属模型，并在悬停前先「移开再移入」。

### 2. fail-closed 边界（绝不静默降级）

- 对**无子菜单**的模型请求 `reasoningLevel` / `contextWindow` → **发送前报错**，不静默沿用界面当前值；
- 目标值不在界面候选内 → 报错并列出实际候选；
- 档位集合读不到（子菜单未展开 / 选择器漂移）→ **拒绝猜测**，不按内置名单兜底；
- 选完一律**回读**（推理等级从触发器第二行、上下文窗口读 `aria-checked`），不一致即失败。

### 3. 只读诊断探针

`npm run probe:minimax` 可复现上述全部结论：安装探测 / 进程与 CDP 拓扑 / 模型与**子菜单候选
（只悬停不点击，不改变任何状态）** / 项目分组 / 运行信号快照 / 原生对话框枚举。

## 真机闭环（本版核心判据）

沙箱 `D:\Trae项目\MiniMax-Test` 里**刻意保留一个失败用例**（`add(-2,-3)` 返回 `5` 而非 `-5`），
用它证明「验收真的会失败、返修真的会改、改完真的会过」，而不是空跑一遍。

- **派发**：`agentId=minimax` / `model=M3.1-Flash-Preview` / `reasoningLevel=low` / `contextWindow=512K`
- **结果**：`ok=true`、`endReason=reply_stable`，日志实录运行信号 `stop_button`
- **独立复核**（不经 adapter）：
  - `cd /d/Trae项目/MiniMax-Test && node --test` → `tests 4 / pass 4 / fail 0`
  - `git diff --stat` → `src/calc.mjs | 6 ------`（agent 真实改了源码）

链路各段均在该次运行中被观察到：探测（fixed-drive 命中）→ 接管（复用既有 CDP 实例）→
连接主窗口与 composer 就绪 → 建会话 → 绑项目（两步）→ 选模型/档位/窗口（二级子菜单）→
输入 → 发送 → 轮询（实测 `stop_button`）→ 终态 `reply_stable`。

## 测试

- 新增 `test/unit/minimax-*`（6 文件 **121 例**）。
- **新增一类「页面内表达式沙箱可执行性」测试**：用 `node:vm` 逐个执行全部页面内表达式，
  断言不出现 `is not defined`。表达式是「拼字符串注入页面」的，漏带 helper 时
  `tsc` 与常规单测**都发现不了**，只能到真机才炸——真机已因此踩到两次，这类测试是唯一能提前拦住的。
- 全量 **126 files passed / 3 skipped / 0 failed**；typecheck / lint / build / 严格 stdio 全绿。

## 已知限制

| 项 | 状态 |
|---|---|
| macOS | `research`（原生文件夹对话框 fail-closed，禁止派发） |
| `stop-button` 发送后态 | 来自产品产物常量提取，未在发送后态复采；缺失时三信号自动降级（影响收敛速度，不影响正确性） |
| 提问检测 | 无实测样本（额度受限造不出提问场景）；默认关闭、判据保守 |
| 权限模式自动切换 | 权限菜单候选项未取证，故只回读比对、不自动切换 |
| 版本门禁 | 不设（无版本文件，版本号只能在 CDP UA 读）；靠 `selector_drift` 兜底，失败可诊断 |

## 文档

- 新增 [MiniMax Code 适配器](minimax-cdp.md) 双语文档（结构、选择器、fail-closed 边界、恢复语义、已知限制）
- 新增 `docs/minimax-evidence/`（主窗口 testid 清单、弹层产物结构、真机闭环实录）
- 双 README 导航各增一行
