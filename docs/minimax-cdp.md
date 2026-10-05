# MiniMax Code GUI（CDP）适配器

[English](minimax-cdp.en.md)

tianshu-mcp 的第七个 GUI agent 适配器（`agentId=minimax`）：驱动 MiniMax Code 桌面端完成「定位安装 → 启动并开启 CDP → 绑定项目文件夹 → 选模型 / 推理等级 / 上下文窗口 → 发指令开发 → 运行检测 → 自动验收 → 失败返修 → 再验收」全流程。

- 实现：`src/agents/minimax/`（`adapter.ts`、`run.ts`、`model-select.ts`、`cdp.ts`、`dom.ts`、`selectors.ts`、`instance.ts`、`session.ts`、`workspace.ts`、`dialog.ts`、`model.ts`、`liveness.ts`、`recovery.ts`、`fixplan.ts`、`discovery.ts`）
- profile：`src/agents/builtin.ts` 的 `minimax`（`adapter: minimax-gui`）
- 状态：Windows 为 `ready`；macOS 为 `research`（原生文件夹对话框 fail-closed，禁止派发）
- 只读诊断探针：`scripts/probe-minimax.mjs`
- 真机取证：Windows 10.0.19045 / MiniMax Code 3.1.0 / Electron 42.8.0 / Chromium 148.0.7778.280（2026-10-05）

---

## 1. 安装与启动

| 项 | 值 | 来源 |
|---|---|---|
| 可执行 | `D:\MiniMax-Code\MiniMax Code\MiniMax Code.exe` | 磁盘实测（232MB） |
| 打包形态 | 普通 Electron 安装（非 MSIX） | `LICENSE.electron.txt` + `resources/app.asar` |
| 版本 | 3.1.0（文件版本 3.1.0.170） | CDP `/json/version` 的 UA：`MiniMax/3.1.0` |
| 启动方式 | `--remote-debugging-port=9999` **直启即生效** | 实跑验证：`/json/version` 返回 200 |
| 用户数据目录 | `%APPDATA%\MiniMax`（配置 `minimax-agent-cn-config.json`） | 磁盘实测 |

CDP 端口基准 **9999**（区段 9999–10008），与既有 9222（TraeWork）/ 9333（ZCode、Codex）/ 9666（Kimi Code）/ 9777（Qoder）/ 9889（Open Design）均不重叠。

探测顺序（代码不硬编码用户绝对路径）：
**显式 `gui.exePath` → 固定盘相对路径模板（`preferredDrives: ["D:"]` 优先）→ 卸载注册表 `InstallLocation` → 标准安装目录 → PATH**。

```bash
node scripts/probe-minimax.mjs install      # 打印可执行路径 / 来源 / 版本
```

---

## 2. 双渲染进程（关键结构）

MiniMax Code 是**双渲染进程**应用，一个 CDP 端口上同时存在三个 page target：

| 窗口 | title | url | 用途 |
|---|---|---|---|
| 主窗口 | `MiniMax Code` | `app://./archon` | 侧栏 / 项目分组 / 会话 / composer / 输入框 / 发送按钮 |
| **模型弹层** | `Model menu` | `.../resources/app.asar/dist/model-menu/index.html` | 模型列表 + **悬停后展开的二级子菜单**（推理等级 / 上下文窗口） |
| 辅助页 | `Rsbuild App` | `.../react-screenshots/dist/electron.html` | 无关，必须过滤掉 |

**反证方式**（可复现）：在主窗口点 `model-selector-trigger` 后，主窗口 `data-testid` 数**仍为 58**（新增 0）、`role="group"` 数 **0**、`role="menuitemradio"` 数 **0**、`innerText` 不含「推理等级」；同时 `/json/list` 出现 `Model menu` target。

因此适配器内部持有**两个** CDP 客户端：主窗口按 targetRank 收敛，弹层只在需要时惰性连接（rank 只认 `dist/model-menu/`）。

---

## 3. 推理等级与上下文窗口在**二级子菜单**里

> 这是本适配器最关键的实测修正：产品前端产物里的源码常量显示它们是平铺的 `role="group"`，**真机 DOM 只在悬停模型项后才渲染**。

**交互序列**（`src/agents/minimax/model-select.ts`）：

1. 打开模型菜单（主窗口点 `model-selector-trigger` → 弹层窗口出现候选）；
2. **悬停**带 `aria-haspopup="menu"` 的模型项 → `aria-expanded` 变 `"true"` → 出现第二个 `role="menu"`；
3. 该子菜单里才有 `role="group"[aria-label="推理等级"]` 与 `[data-testid="model-context-control"]`；
4. 先选推理等级、再选上下文窗口；
5. **最后**点模型项提交（点它会立即关闭菜单，所以必须放最后）。

**两个必须遵守的纪律**：

- **悬停前先移开鼠标**：子菜单容器是**复用**的，直接移入不会触发 `mouseenter`，DOM 会保留**上一个悬停模型**的档位/窗口组——据此选档位会选到别的模型的集合（真机踩到）。
- **读候选必须带归属约束**：子菜单根的 `aria-label` 恰为目标模型名（顶层是「选择模型」），适配器按它过滤（`cdp.effortOptions(model)` / `cdp.contextOptions(model)`）。只检查「有 group」会读到残留 DOM。

### 3.1 集合随模型变化（实测）

| 模型 | 二级子菜单 | 推理等级 | 上下文窗口 |
|---|---|---|---|
| `M3.1-Flash-Preview` | 有 | `default` / `low` / `medium` / `high` / `xhigh` / `max` | `512K` / `1M`（1M 标「用量较高」） |
| `M3` | 有 | **无此组** | `512K` / `1M` |
| `deepseek-v4.1-flash` | 有 | `low` / `high` / `max` | **无此组** |
| `M2.7-highspeed` / `M2.7` | **无** | — | — |

```bash
node scripts/probe-minimax.mjs submenu      # 逐个悬停并打印各模型的档位/窗口候选（只悬停，不点击）
```

### 3.2 fail-closed 边界

- 对**无子菜单**的模型请求 `reasoningLevel` / `contextWindow` → **发送前报错**，绝不静默沿用界面当前值；
- 目标值不在界面候选内 → 报错并列出实际候选；
- 读不到档位集合（子菜单未展开 / 选择器漂移）→ 报错（`拒绝猜测档位`），绝不按内置名单猜；
- 选完后**回读**：推理等级从触发器第二行读回（`aria-checked` 同源），上下文窗口读 `aria-checked`；不一致即 fail-closed。

---

## 4. 模型触发器的文本形态

实测两种：

- **单行** = 模型名（如 `M2.7-highspeed`）；
- **两行** = 模型名 + 档位（如 `"M3.1-Flash-Preview\ndefault"`）。

因此 `parseTriggerValue` **按换行切分**，不按空格或中点（Kimi Code 用中点 `·`，本产品不用）。模型名自身含连字符与点（`M3.1-Flash-Preview`），不能按空格切。

---

## 5. 主窗口选择器（实测要点）

58 个 `data-testid`（清单见 `docs/minimax-evidence/main-window-testids.txt`）。驱动链用到的关键键：

| 语义 | 选择器 | **踩坑点** |
|---|---|---|
| 新建任务 | `[data-testid="sidebar-shortcut-task.new"]` | testid 挂在 **`<kbd>`** 上（显示 Ctrl+N）；真正可点击的是祖先 `button[aria-label="新建任务"]`——必须 `closest('button')` |
| 输入框 | `[data-testid="message-textarea"]` | **tiptap ProseMirror**（`div.tiptap.ProseMirror[contenteditable=true]`）。`Input.insertText` 可用；**清空后 innerHTML 仍保留空的 `is-empty` 段落**（innerText 为空串）→ 空态判定走 `innerText.trim()` |
| 发送按钮 | `[data-testid="send-button"]` | 是 **DIV**（不是 `<button>`）。可用性读 **`aria-disabled`**（空输入 `"true"`，有内容 `null`）；**没有 `disabled` 属性**（读 `e.disabled` 恒 undefined） |
| 停止按钮 | `[data-testid="stop-button"]` | 权威运行信号。来源为产品产物 `app.asar` 常量提取（真机发送后态未复采） |
| 模型触发 | `[data-testid="model-selector-trigger"]` | 文本 = 当前模型（+ 档位）；点击后弹层在**独立窗口** |
| 权限触发 | `[data-testid="permission-mode-trigger"]` / `permission-mode-label` | 文本实测「始终授权」；菜单是主窗口内的 **ant-dropdown**（不是独立窗口） |
| 项目触发 | `[data-testid="project-selector-trigger"]` | 文本 = 当前项目名（实测 `.appdata`） |
| 项目分组 | `[data-testid="sidebar-session-group"]` | **`data-workspace-dir` = 完整绝对路径** → 项目绑定的**权威判据** |
| 新建项目 | `[data-testid="sidebar-create-project-trigger"]` | 触发原生 `Select Directory` 对话框 |

---

## 6. 项目绑定

**权威判据**是侧栏分组的 `data-workspace-dir`（实测 `D:\Trae项目\tianshu-mcp`），比较**归一化后的完整路径**（盘符大写 + 反斜杠统一 + 路径体小写折叠）；名称仅作回退。同名不同目录一律 `ambiguous` 并 fail-closed。

实测注意：**新建任务不会清空项目**（新建后仍停在上一次的项目）——所以每次派发都要显式核对/绑定。

项目不在侧栏时走「新建项目」→ 原生 **`Select Directory`** 对话框：

| 控件 | 判据 |
|---|---|
| 窗口 | 类名 `#32770`，标题 **`Select Directory`**（界面为中文时仍是英文） |
| 路径编辑框 | `AutomationId=1152` + `ClassName=Edit`（ControlType 是 **Pane**，无 ValuePattern）→ 只能走 `WM_SETTEXT` |
| 确认按钮 | `AutomationId=1` + `Name=Select`（不支持 UIA `InvokePattern`）→ 必须坐标点击 |
| 取消按钮 | `AutomationId=2` |

路径写 `WM_SETTEXT` 后**立即 `WM_GETTEXT` 回读**，不一致绝不点确认。路径只经环境变量进入脚本（不拼进脚本源码），避免 CJK 被命令行代码页破坏。

```bash
node scripts/probe-minimax.mjs projects     # 打印侧栏项目分组（完整路径）
node scripts/probe-minimax.mjs dialogs      # 枚举属主的 #32770 窗口
```

---

## 7. 运行检测（三信号）

| 信号 | 判据 | 说明 |
|---|---|---|
| 停止按钮 | `[data-testid="stop-button"]` 可见 | **权威信号**（产物提取，发送后态未复采 → 缺失时自动降级） |
| 失败态 | 对话正文匹配 `请求失败` / `网络异常` / `provider.*` / `HTTP 4xx` | 命中即 `failed`，**绝不判完成** |
| 文本稳定 | 连续 `stableRounds` 轮读到的文本哈希一致 | 完成判据；**「静止 N 秒」不能单独作为完成判据** |

**刻意不把发送按钮双态当运行信号**：MiniMax Code 的发送按钮只有 `aria-disabled` 双态，而「输入框空」与「已发送待回复」都会让它禁用——两者无法从按钮本身区分。把它算作运行信号会让「发完就永远 running」。停止按钮选择器全部失效时，稳定窗口仍能收敛本轮（只是多等 `stableRounds` 轮）——这是有意的**慢而不错**。

死锁破除：停止按钮恒可见 + 文本停滞超 `stallTimeoutMs` → 转 `needs_user`（可 `continue_task` 恢复）。

**等待用户**（提问检测）默认**关闭**，只在 profile 显式配置 `gui.selectors.userGate` 后才启用——判据保守（无运行信号 + 输入框空 + 文本已变化 + 问句结尾），宁可漏判退回 `idle_timeout`，也不误判（误判会在恢复时把用户确认文本当成回答发给模型）。

```bash
node scripts/probe-minimax.mjs liveness     # 打印一次运行信号快照
```

---

## 8. 恢复语义

`run_task` 的 `resume` 按类型分派（与 Kimi Code / ZCode 同构）：

| 类型 | 行为 |
|---|---|
| `continue` + `agent_question` | 定位原会话 → 把**回答**写进输入框发送（**不重发任务书**） |
| `continue` + `user_confirmation` | **重连观察**至终态（不发送任何消息） |
| 环境类（`login_required` / `close_existing_instance` / `setup_recovery` / `system_permission`） | 复检环境后**全新派发并补发完整任务书**（用户确认文本绝不发给模型） |
| `rework` | 定位原会话 → 回读项目/模型 → 发送返修消息 |

**定位不到原会话一律 `session_lost` 硬失败，绝不退化打开「最近会话」。**

会话锚点：MiniMax Code 的会话条目**没有显式 id 属性**，锚点记为「项目路径 + 会话标题」（`minimaxSessionId` / `minimaxSessionTitle` 分槽存放，不与 zcode/kimicode 混淆）。

---

## 9. 参数

| 参数 | 生效范围 | 说明 |
|---|---|---|
| `model` | minimax | **必填**（本产品无「默认模型」语义）。精确匹配（`M3` 与 `M3.1-Flash-Preview` 必须区分） |
| `reasoningLevel` | minimax | `default` / `低·low` / `中·medium` / `高·high` / `极高·xhigh` / `最大·max`（**`medium` 合法**——与 Kimi Code 的关键差异） |
| `contextWindow` | **仅 minimax** | 界面候选文本（如 `512K` / `1M`）。刻意用宽松 string：候选随模型变化，硬编码枚举会拒掉合法值 |
| `mode` / `designDirection` | 不适用 | 显式传入即报错 |

非 minimax 派发时传 `contextWindow` → 拒绝（`contextWindow 是 MiniMax Code 专用参数`），绝不静默忽略。

---

## 10. 返修与修复计划

验收不通过时，MCP 自动生成修复/优化计划到**项目根下** `.minimax/plans/minimax-fix-r<N>.md`（每轮独立、不覆盖），并把文件名写进返修指令（`buildMinimaxFixPrompt`）。落项目根是刻意的：agent 必须能读到它——写进任务数据目录会导致「我让你看计划，你说读不到」。

`defaultAutoFixRounds: 2`（可在 profile 覆盖）。

---

## 11. 已知限制

| 项 | 状态 |
|---|---|
| macOS | `research`：原生文件夹对话框 fail-closed，**禁止派发** |
| `stop-button` 真机发送后态 | 来自产品产物常量提取，本次未在发送后态复采；缺失时三信号自动降级（不影响正确性，只影响收敛速度） |
| 提问检测 | 无实测样本（账号额度受限造不出提问场景）；默认关闭，判据保守 |
| 失败重试按钮选择器 | **未内置**（未真机验证）；仅失败文案正则兜底 |
| 权限模式自动切换 | 权限菜单候选项**未取证**，故只回读比对、不自动切换（不一致时告警） |
| 版本门禁 | **不设**：无 `resources/*-config.json` 版本文件，版本号只能在 CDP UA 读（驱动失败时恰恰读不到）。靠 `selector_drift` 兜底——失败可诊断 |

---

## 12. 证据与复现

```bash
# 1) 启动并开 CDP
"D:\MiniMax-Code\MiniMax Code\MiniMax Code.exe" --remote-debugging-port=9999

# 2) 跑只读诊断探针（需先 npm run build）
npm run build
npm run probe:minimax             # 默认 all
npm run probe:minimax submenu     # 只看二级子菜单候选
```

| 文件 | 内容 |
|---|---|
| `docs/minimax-evidence/main-window-testids.txt` | 主窗口 58 个 `data-testid` 实测清单 |
| `docs/minimax-evidence/model-menu-structure.txt` | `Model menu` 产物结构（role/testid 提取） |
| `docs/minimax-evidence/model-menu-snippets.txt` | 弹层产物关键片段（含 i18n 真值） |
| `scripts/probe-minimax.mjs` | 只读诊断探针（复现本节全部结论） |
