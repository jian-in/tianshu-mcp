# Open Design GUI（CDP）适配器：真机事实与设计依据

[English](opendesign-cdp.en.md)

本文记录 `opendesign-gui` 适配器的**真机取证结果**与由此得出的实现约束。适配器目标是让 Open Design 桌面端
（「让我们创建原型」那套面向设计稿生成的 AI 客户端）成为 tianshu-mcp 可派活、可观察、可验收的 GUI agent。

> 取证机器：Windows 10 Pro 19045；Open Design 0.24.1（Electron 41.3.0，官方安装包）；
> 安装目录 `D:\Open Design`；取证日期 2026-09-25 ~ 2026-09-26。

## 1. 安装与数据目录

| 事实 | 取值 / 依据 |
|---|---|
| 安装形态 | **普通安装**（非 MSIX 商店包），`<安装目录>\Open Design.exe` |
| 安装配置 | `<安装目录>\resources\open-design-config.json` → `appVersion` / `namespace` |
| 实测取值 | `appVersion=0.24.1`，`namespace=release-stable-win` |
| Electron userData | `%APPDATA%\Open Design\namespaces\<namespace>\user-data` |
| 应用数据 | `%APPDATA%\Open Design\namespaces\<namespace>\data\`（`app-config.json`、`app.sqlite`） |
| 日志 | `%APPDATA%\Open Design\namespaces\<namespace>\logs\{daemon,desktop,launcher,web}` |

**不硬编码**：安装路径由 `executableDiscovery`（`preferredDrives:["D:"]` + `relativePaths:["Open Design/Open Design.exe"]`
→ 注册表卸载信息 → 标准目录 → PATH）推导；版本与命名空间一律从安装配置读。
**命名空间取不到时不猜**（`openDesignNamespaceRoot` 返回 `null`），因为猜错命名空间会导致
「绑定了目录却读不到 `app-config.json`」这类静默误判，而不是响亮报错。

## 2. 实例接管：单实例锁与 `--user-data-dir` 的真相

这是本适配器与 ZCode / Kimi Code / Qoder 最关键的差异，直接决定实例策略。

### 2.1 ⚠️ `ELECTRON_RUN_AS_NODE`：启动失败的真正根因（真机实测）

`Open Design.exe` 是「**内嵌 Node 的 Electron**」外层启动器。若启动它的进程带着
`ELECTRON_RUN_AS_NODE=1`（本机 DSH harness 就会注入该变量），启动器会被强行置为 **Node 模式**：

```
D:\Open Design\Open Design.exe: bad option: --remote-debugging-port=9889   （退出码 9）
D:\Open Design\Open Design.exe: bad option: --headless                     （退出码 9）
```

表现为「无窗口、无新日志、无崩溃转储」——**极易误判成应用本身损坏**。清除该变量后同一命令立刻生效：

```
DevTools listening on ws://127.0.0.1:9889/devtools/browser/63dd8142-…
```

`NODE_OPTIONS` 同样必须清除：Node 明确禁止 `--remote-debugging-port` 出现在其中，
残留时会报 `--remote-debugging-port= is not allowed in NODE_OPTIONS`。

**因此受管启动一律净化环境**（`OPEN_DESIGN_ENV_DENYLIST` + `sanitizedSpawnEnv()`），
且**不改命令行**——命令行仍是 profile 的 `exeArgs`（`--remote-debugging-port=<port>`），
即官方启动器本来就支持的形态。

> ⚠️ **手工验证时必须自己清变量**：用 `Start-Process` / 资源管理器快捷方式在**带该变量的会话**里启动，
> 同样会失败——实测表现为**启动器 exit=0 且一个进程都不剩**（不是 `bad option`，因为参数没问题、
> 是启动器内部 Node 模式分支直接返回）。两种表现都是同一个根因，别被退出码差异带偏。

### 2.2 启动器是「分离子进程形态」

实测：启动器接受调试端口后会打印 `DevTools listening on …`，**然后自己以退出码 0 退出**，
真正的 Electron 主进程是它 spawn 的分离子进程。因此：

- **退出码 0 绝不等于失败**：必须从 stderr 解析宣告端口（`devtoolsPortsFromOutput()`）并继续轮询；
- 首版直接把退出码 0 判成「请用户关闭旧实例」，真机上表现为「明明起来了却说要关旧实例」——已修。
- 退出码 9 归类为「无法接管 → `needs_user`」，其他非零才是真实启动失败（带 stderr 尾部抛错）。

| 事实 | 依据（`resources/app/prebundled/packaged-main.mjs`） |
|---|---|
| 有**进程级单实例锁**；第二实例只把 deeplink 转交给首实例然后退出 | `claimPackagedSingleInstanceLock`（:34250-34259）、`createPackagedSecondInstanceHandoff`（:34260-34283） |
| 主进程**强制** `app.setPath("userData", <namespaceRoot>/user-data)` | `applyPackagedElectronPathOverrides`（:34245-34248） |
| 因此 `--user-data-dir` 开关**会被覆盖** | 同上；`resolvePackagedNamespacePaths`（:32578-32598） |
| 支持 `--headless`（无窗口，起 daemon/web sidecar，可 `--mcp-install codex`） | `parsePackagedHeadlessRequest`（:33471-33484）、`runPackagedHeadless`（:33510+） |

### 由此确定的策略（复用优先 → 自启 → 请用户关闭）

1. **复用优先**：已有实例且根进程 argv 带有效调试端口 → 直接接管（`probeOpenDesignPort` 做产品校验）。
2. **自启受管实例**：无实例时 `spawn(exe, ["--remote-debugging-port=<port>"])`。
3. **`needs_user(close_existing_instance)`**：有实例但没开调试端口 → 子进程被单实例锁转交后退出，
   此时**明确要求用户手动关闭**，绝不 kill 用户进程。

**不做「专属 userData 受管实例」**：主进程会覆盖该开关，写进 profile 是假承诺。因此
`opendesign` profile 的 `gui.userDataDir` 保持未设置，`exeArgs` 只注入调试端口。

### 根进程判定的坑（真机踩到并修复）

本产品把 daemon / web 两条 sidecar 也做成同一个可执行文件的子进程，实测命令行形如：

```
"D:\Open Design\Open Design.exe" "D:\Open Design\resources\app\prebundled\daemon\daemon-sidecar.mjs"
"D:\Open Design\Open Design.exe" "...\@open-design\sidecar\dist\supervisor.mjs" --od-stamp-app=web
```

它们**没有窗口、不参与单实例锁**，但会长期驻留。若把它们算作「已运行的实例」，
用户关掉界面后仍会被判 `needsClose`，导致受管实例**永远起不来**。故
`rootOpenDesignProcesses()` 在剔除 `--type=` / crashpad 之外，还剔除 argv 里出现 `.mjs` 脚本的进程。
实测该机器 11 个同名进程 → 只剩 1 个真·桌面主进程。

## 3. CDP 端点

| 项 | 取值 |
|---|---|
| 调试端口基准 | **9889**（区段 9889-9898） |
| 为何不用 9777 | 该端口已被 **Qoder CN** 占用（基准 9777，区段 9777-9796）——真机实测后改档 |
| 既有占用 | traework 9222 / zcode 9333 / codex 9333 / kimicode 9666 / qoder 9777 |
| 产品校验 | `/json/version` 的 `User-Agent` 含 `electron` **且**存在标题以 `Open Design` 开头（或 URL 含 `open-design`）的 page target |
| 版本判据 | **产品版本**取自 `resources/open-design-config.json`；CDP `/json/version` 的 `Browser` 是 **Electron 版本**（实测 `Electron/41.3.0`），**不可**用于产品版本比对 |

> 版本判据踩坑记录：首版误用 `/json/version` 的 `Browser` 做版本门禁，导致真机上必定
> `version_mismatch` 而阻断全部派发；已改读安装配置并加回归测试（`opendesign-discovery.test.ts`）。

## 3.1 ⚠️ 真机实测：`/json` 会挂起 → 传输层必须双路径

| 观察 | 取值 |
|---|---|
| 浏览器进程 `/json/version` | **正常响应**（含 `webSocketDebuggerUrl`） |
| 浏览器进程 `/json`、`/json/list` | **连接成功后长时间无响应**（0 字节、超时） |
| 同一个端口上另一个测试 | 端口在 LISTEN、`DevTools listening on ws://127.0.0.1:9889/…` 已打印 |

根因判断：`/json` 的 target 枚举走 **UI 线程**，而 Open Design 启动期主线程被自身的版本/遥测/计费请求占住，
于是「端点活着但目录不回应」。用只走 `/json` 的旧传输会让适配器在真机上**永远卡在 connect**。

因此 `src/agents/opendesign/transport.ts` 采用**两条路径**：

1. 快路径：HTTP `/json`（正常版本上最快，语义与既有 GUI 传输一致），并给它一个更短的上限（≤3s）；
2. 慢路径：`/json/version` 拿**浏览器级** WebSocket 地址 → `Target.getTargets` 枚举目标 →
   `Target.attachToTarget({flatten:true})` 拿 `sessionId` → 之后页面级命令带 `sessionId`，
   `Target.*` / `Browser.*` **不带**（带了会被拒）。

就绪探测 `probeOpenDesignPort` 与传输层**共用同一份目标枚举实现**（`resolvePageTargets`），
两处各写一套必然漂移。两条路径都失败时，错误信息必须写明「试过什么」，不允许只丢一句 `CDP_UNAVAILABLE`。

## 4. 界面结构与选择器取证

Open Design 是打包过的 React 应用（`resources/app/prebundled/*` 为压缩产物），
但它的 **Web 前端产物是可读的**：

```text
<安装目录>/resources/open-design-web-standalone/apps/web/.next/static/chunks/*.js
```

该产物**系统性使用 `data-testid`** 作为自动化钩子（共取到 600+ 个），且这些钩子带业务语义
（`chat-send` / `working-dir-trigger` / `composer-design-system-trigger` …）——这正是产品作者为自动化预留的接口。
因此本适配器的 `primary` **全部来自产物证据**，不是截图目测：目测出来的坐标/类名会在第一次 UI 升级时静默漂移。

复核入口（只读）：

```sh
npm run build
node scripts/probe-opendesign.mjs anchors --no-focus   # 只读盘点；连接不置前
node scripts/probe-opendesign.mjs all                  # install + process + cdp + appconfig + anchors
```

### 4.1 选择器取证表（`src/agents/opendesign/selectors.ts` 的 `primary`）

| 语义键 | primary（真实钩子） | 证据来源 |
|---|---|---|
| `title` | `[data-testid="home-hero"]` | 首页 hero 容器（产品自己的钩子） |
| `composer` | `[data-testid="chat-composer"]` | 会话页输入区容器；首页形态是 `home-hero-composer-card` |
| `inputBox` | `[data-testid="home-hero-input"]` | 首页编辑器显式带该 testId（Lexical 富文本）；会话页在 `chat-composer` 内的 `[contenteditable=true]` |
| `workingDirTrigger` | `[data-testid="working-dir-trigger"]` | `working-dir-picker` 内的按钮（带 `aria-expanded`） |
| `selectDirItem` | `[data-testid="working-dir-pick"]` | 展开后的「选择目录」项；composer「+」菜单内是 `composer-plus-working-dir-pick` |
| `workingDirValue` | `[data-testid="working-dir-trigger"]` | 回读该触发器的标签文本（绑定是否生效的唯一权威判据） |
| `modelTrigger` | `[data-testid="inline-model-switcher-chip"]` | 会话页内联模型切换器；新建项目弹窗内是 `model-picker-trigger` |
| `modelMenuItem` | `[role="option"]` | 触发器 `aria-haspopup="listbox"`，面板 `role="listbox"` |
| `designSystemTrigger` | `[data-testid="composer-design-system-trigger"]` | composer 图标形态；首页形态 `home-hero-design-system-trigger`，项目选择器 `project-ds-picker-trigger` |
| `designSystemSearch` | `[data-testid="design-system-search"]` | 设计系统面板的搜索框（`class="ds-picker-search"`） |
| `designSystemItem` | `[role="option"]` | 面板列表项（列表容器 `ds-picker-list-design-systems`） |
| `designDirectionTrigger` | `[data-testid="home-hero-template-trigger"]` | 界面上的「创建类型」选择器（`home-hero-template-picker` 内，`aria-haspopup="listbox"`） |
| `designDirectionItem` | `[role="option"]` | 同上 listbox 形态 |
| `sendButton` | `[data-testid="chat-send"]` | 会话页发送按钮（`aria-label=<chat.send>`）；首页形态 `home-hero-submit` |
| `stopButton` | `button.composer-send.stop` | **该控件没有 testid**；产品用 `class="composer-send stop"` + `aria-label=<chat.stop>` 标识，故以 class 为 primary（不随语言变化）、aria 作诊断兜底 |
| `conversationText` | `[data-testid="chat-log"]` | 产品自己的滚动/取证锚点，语义极稳定 |

> 三个菜单项键（模型 / 设计系统 / 设计方向）**共用 `[role="option"]`**——产品里同一时刻只开一个 listbox，
> 因此并集语义是安全的；适配器仍要求**唯一命中**，多命中直接拒绝点击（绝不猜一个点）。

### 4.2 布局守卫为什么只剩四个键

`OPEN_DESIGN_LAYOUT_GUARD_KEYS` = `title / composer / inputBox / sendButton`，只收**首页无条件存在**的锚点。

工作目录 / 模型 / 设计系统 / 设计方向触发器由**用户配置与页面形态**决定是否渲染：
- 模型触发器只在配置了对应执行方式时出现；
- 设计系统/设计方向触发器在 footer 选项为空时不渲染。

把这类键放进守卫会让适配器**大面积假阻塞**（报「页面结构漂移」，实际是「该能力在当前配置下不可用」）。
因此它们改为在**各自步骤**内单独校验，并给出精确原因（`no-trigger` / `no-menu` / `needs_user`），比一刀切更如实。

### 4.3 已实现的选择器/DOM 层与执行层

| 文件 | 内容 |
|---|---|
| `selectors.ts` | 16 个语义键的注册表（`primary` + 语义化 `fallbacks` + `texts`/`ariaLabels`/`ariaPatterns`）、`cssCandidates`、`specArgs`、`selectorSpec`、页面内 `resolveFnSource`、**布局守卫键集**与 `missingSelectorKeys()` |
| `dom.ts` | 页面内表达式：`exists` / `text` / `singlePoint` / `firstPoint` / `exactMatch` / `listLabels` / `count` / `inputValue` / `conversationText` / `triggerText` / `layoutProbe` / `dismiss` / `directionItemVisible`，标记前缀 `od:` |
| `transport.ts` | 页面级 CDP 传输（快/慢双路径、会话隔离、断线语义） |
| `cdp.ts` | 语义操作层 `OpenDesignCdpClient`：可信坐标点击、精确匹配点击、输入、Escape 收起、单次轮询快照、布局盘点 |
| `menu.ts` | 模型/设计系统/设计方向共用的「触发 → 展开 → 精确匹配 → 回读确认」 |
| `send.ts` | 输入任务书 + 只点一次发送 + 有界确认（三证据） |
| `recovery.ts` | 按步预算（`remaining(cap)` 取三步最小值，重试不重置） |
| `workspace.ts` | 工作目录绑定编排：已绑定则跳过 → 展开触发器 → 点「选择目录」→ 原生对话框 → **回读校验** |
| `dialog.ts` | 原生对话框：`toNativeDialogPath`、`listOwnedDialogs`、`closeStrayDialogs`、`selectOpenDesignFolder`（**双路线**：WM_SETTEXT 优先、失败退回键盘输入，两条都要求回读一致；确认后**等对话框真的关闭**才算成功） |
| `liveness.ts` | **三信号**判定：停止按钮可见性 + 对话文本哈希 + **产物文件 mtime/大小指纹**；纯函数 `judgeOpenDesignPoll` |
| `fixplan.ts` | 修复/优化计划落**项目根** `.opendesign/plans/opendesign-fix-r<N>.md`（每轮独立不覆盖）+ 返修指令拼装 |
| `visual.ts` | 视觉验收页面来源**推导建议**（只推导、不落盘，绝不静默改项目配置） |

**绑定成功的判据是「回读一致」，不是「对话框关掉了」**：原生对话框确认只代表系统接受了这个目录，
应用是否真的把它当成工作目录必须回读界面显示值。两者不一致时如实报 `readback` 失败，
绝不当成成功继续往下走（否则后续失败会被归因到完全无关的地方）。

**为什么产物信号是必需的**：Open Design 生成设计稿时会**长时间不刷对话**却持续写文件，
只看对话文本会把这类正常工作判成「空闲完成」。因此静止判据要求**文本与产物双稳定**。

**原生对话框的安全边界**（`dialog.ts`）：只操作「**本次新出现** + 属目标进程 + 类名 `#32770` +
可见 + **唯一**」的窗口；基线在点击「选择目录」之前采样，基线里已有的窗口一律不碰；
出现多个新对话框直接放弃（绝不猜一个去点）；路径只经环境变量进入脚本（CJK 不被命令行代码页破坏）。

`run.ts` 在接管制管实例后会先**清掉属于本实例 pid 的残留 `#32770`**——模态框会吞掉主窗口的合成点击，
不清掉会让下一轮把「点选择目录毫无反应」误判成选择器失效。

设计约束（与 `kimicode/dom.ts` 同构）：
- 点击类表达式**只返回坐标**，鼠标事件由 `cdp.ts` 统一经 `Input.dispatchMouseEvent` 发出（**可信点击**，
  React 的合成事件链对 `isTrusted` 敏感），表达式本身不产生副作用；
- 「点击成功」≠「状态已改变」：面板是否展开、菜单项是否出现、触发器回读值是否与目标全等，
  每一步都要回读确认；
- 回退候选**不得是宽泛容器型**（`button`/`div[class]`/`li`…）：多命中会让坐标点击失效，
  且错误信息只会说「选择器未挂载」，极难定位（已固化成断言）。
- 候选匹配**精确全等**，未命中报错并回显可见候选；**绝不退化成模糊匹配**。
- **`gui.selectors` 覆盖是权威的**：一旦为某个语义键给出覆盖值，就只用它，**不再混入内置 fallbacks**
  （fallbacks 含 `[aria-haspopup]` 这类宽泛候选，混入会让「唯一命中」必然失败——
  热修复选择器反而把功能彻底关掉）。UI 小改版时可据此**不发版**热修复。

### 4.4 待回填：探针全锚点实际命中清单

`scripts/probe-opendesign.mjs anchors` 会打印每个语义键的**实际命中数与首个文本**。
本机沙箱内 Open Design 主线程停在启动期（见 §3.1），无法完成真实 DOM 采集，因此下表待**在可联网终端**回填：

| 语义键 | 期望命中数 | 实测命中数 | 实测文本 |
|---|---|---|---|
| `title` | 1 | 待回填 | |
| `composer` | 1 | 待回填 | |
| `inputBox` | 1 | 待回填 | |
| `workingDirTrigger` / `workingDirValue` | 1 / 1 | 待回填 | |
| `selectDirItem`（展开后） | 1 | 待回填 | |
| `modelTrigger` | 1 | 待回填 | |
| `modelMenuItem`（展开后） | ≥1 | 待回填 | |
| `designSystemTrigger` | 1 | 待回填 | |
| `designSystemSearch` / `designSystemItem`（面板打开后） | 1 / ≥1 | 待回填 | |
| `designDirectionTrigger` | 1 | 待回填 | |
| `designDirectionItem`（展开后） | ≥1 | 待回填 | |
| `sendButton` | 1 | 待回填 | |
| `stopButton`（运行中） | 1 | 待回填 | |
| `conversationText` | 1 | 待回填 | |

## 5. 原生「选择文件夹」对话框

图 2 的对话框是 Windows 原生 `#32770`（由 Electron `dialog.showOpenDialog` 拉起），
带「文件夹:」编辑框与「选择文件夹」/「取消」按钮。适配器据此约定：

- **归属核对优先**：先取受管实例的进程 pid 集合，用 `EnumWindows` + `GetWindowThreadProcessId`
  递归父进程匹配（与 `kimicode/dialog.ts` 同源实现），只操作命中的窗口；
- 路径写入与确认走 UIA / 键盘（实现细节在 P2 落地并补证据）；
- 归属不明或对话框未出现 → 关闭自己拉起的对话框并转 `needs_user(system_permission)`，**绝不误伤用户窗口**。

## 6. `app-config.json` 旁证字段

`%APPDATA%\Open Design\namespaces\<namespace>\data\app-config.json` 实测内容（节选）：

```json
{
  "agentId": "amr",
  "designSystemId": "default",
  "agentModels": { "amr": { "model": "deepseek-v4.1-flash" } },
  "recentLinkedDirs": ["D:\\Trae项目\\tianshu-mcp"],
  "defaultProjectLocationId": "default"
}
```

用途：**只作旁证与诊断**（退出码为 `agentModels`/`recentLinkedDirs` 可佐证「上次选了哪个模型 / 绑了哪个目录」），
**界面回读才是权威判据**——直接改这个文件绕开点击不属于本适配器的行为边界。

探针 `appconfig` 子命令只读打印这些字段。

## 7. 设计系统与模型取值来源

| 项 | 来源 |
|---|---|
| 设计系统清单 | `<安装目录>\resources\open-design\design-systems\<slug>\manifest.json` 的 `name`（如 `claude` → `Claude (Anthropic)`），内置 151 个包 |
| 模型 ID | 打包产物中的模型注册表；实测存在 `deepseek-v4-flash` / `deepseek-v4-pro` / `claude-fable-5` |
| 设计方向 | UI 提供 6 项，**适配器只支持**「原型 / 文档 / 网站复刻」，其余显式拒绝 |

模型与设计系统一律**精确匹配 + 命中后回读**：未命中即报错并回显当前可见候选
（见 `model.ts` 的 `matchMenuCandidate`），不做模糊匹配——选错模型比报错更糟。

## 8. 失败码表

| 失败码（`endReason`） | 触发条件 | 编排侧动作 |
|---|---|---|
| `setup_failed` | 入口校验失败（设计方向非法 / 任务书为空 / 未找到可执行 / CDP 始终连不上） | 硬失败，不进验收 |
| `version_mismatch` | 产品版本不在 `opendesign.supportedVersions` | 硬失败并回显实测版本 |
| `selector_drift` | 关键选择器缺失，或布局守卫锚点未命中 | 硬失败，附缺失键与当前页面信息 |
| `model_unavailable` | 模型菜单里精确匹配不到目标名（没这个模型） | 硬失败并回显当前可见候选 |
| `model_mismatch` | 点中了候选但触发器回读与目标不一致 | 硬失败并回显回读值 |
| `design_system_mismatch` | 设计系统面板搜索后仍无法唯一点选或回读不一致 | 硬失败 |
| `input_mismatch` | 输入框回读不含本次任务标记（输入没落进受控编辑器） | 硬失败，**未点发送**（避免派一份空任务） |
| `send_unknown` | 发送后在有界窗口内确认不到任何证据 | 硬失败，**绝不重发**，提示到窗口确认 |
| `session_lost` | 返修/回答轮当前不在会话页（对话容器缺失） | 硬失败，绝不退化到首页重新派发 |
| `reply_stable` | 对话文本与产物指纹双稳定（成功完成） | 进入验收 |
| `idle_timeout` | 连续 `stableRounds` 轮无变化仍未达完成判据 | 保留现场，终态如实说明 |
| `task_timeout` | 任务总时限到点 | 保留现场（不关窗、不 kill） |
| `aborted` | 用户取消 | 尽力点停止按钮并在 `cancelWaitMs` 内有界等待；`guiStop.idle=false` 时**必须**说明「窗口中的任务可能仍在继续」 |

`needsUserKind`（配合 `needs_user` 终态使用）：

| 取值 | 触发条件 | `continue_task` 恢复语义 |
|---|---|---|
| `close_existing_instance` | 已有实例未开调试端口，无法接管 | 用户关闭旧实例后**重新派发**（补发完整任务书） |
| `login_required` | 页面可读但输入框在观察期内始终不出现（登录/引导页） | 完成登录后重新派发 |
| `system_permission` | 原生对话框归属不明/未出现，或系统权限被拒 | 授权后重新派发 |
| `setup_recovery` | 初始化阶段预算耗尽（实例/页面/工作目录绑定未就绪） | 复检环境后重新派发 |
| `user_confirmation` | 停止按钮持续可见且对话与产物全静止（可能在等人） | **只重连观察**，不发送任何消息 |

## 9. 复现要点

```sh
npm run build
# ⚠️ 先清掉会让启动器退化成 Node 的变量（见 §2.1）；受管启动已自动净化，手工排查时需自行清除
unset ELECTRON_RUN_AS_NODE; unset NODE_OPTIONS      # Windows PowerShell: Remove-Item Env:\ELECTRON_RUN_AS_NODE

node scripts/probe-opendesign.mjs install      # 安装/版本/命名空间/数据目录
node scripts/probe-opendesign.mjs process      # 进程与根进程判定
node scripts/probe-opendesign.mjs appconfig    # app-config.json 旁证
node scripts/probe-opendesign.mjs cdp          # 端口与 page target（需实例带调试端口）
node scripts/probe-opendesign.mjs anchors      # 界面锚点盘点（需实例带调试端口）
```

**采集选择器的完整步骤**（需要外网可达，否则主线程会卡在启动期请求）：

1. 关闭所有 Open Design 窗口（未开调试端口的实例无法接管）；
2. `node scripts/probe-opendesign.mjs anchors --launch`：启动受管实例 → 打印
   `/json/version`、page target 拓扑、每个语义键的候选命中数与文本、页面可见文本前 1200 字符；
3. 把收敛出的稳定 CSS 写回 `src/agents/opendesign/selectors.ts` 的 `primary`
   （或在 `agent-profiles.json` 的 `gui.selectors` 里按语义键覆盖，不必发版）；
4. 重新 `anchors`，确认「布局守卫」一节显示**全部命中**；
5. 把证据贴进本文 §4 的锚点表。

`--no-focus`：连接后不置前（纯 DOM 读取用）。点击类诊断**必须置前**——
后台页面会被 Chromium 节流，合成事件不可靠。
