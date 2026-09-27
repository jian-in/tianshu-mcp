# issue #25 真机验收记录 —— Tianshu-mcp 日志台

- 关联 issue：[#25](https://github.com/lanlan0811/tianshu-mcp/issues/25)
- 目标版本：**GUI 独立版本 `0.1.0-beta.1`**（独立 tag `gui-v0.1.0-beta.1`）；**不涉及 MCP 主包版本迭代**（主包仍为 `0.7.0`，尚未发布）
- 验收载体：**CI 构建产物**（`GUI` workflow 的 artifact，或 `gui-v*-beta.*` 的 pre-release 安装包）
- 验收平台：Windows 10（macOS 仅保证 CI 构建通过）

> 按 issue #25 的硬约束，本机**不安装 Rust 工具链、不执行任何 Rust 侧构建**，
> 因此真机验收一律以 CI 产物为载体；本文件在产物到位后按下方清单逐项补齐结果。

---

## 一、前置状态

| 项 | 状态 | 说明 |
|---|---|---|
| 本机 Node / npm | 可用 | 前端预览、单测、门禁脚本均可本地执行 |
| 本机 Rust 工具链 | **不使用** | issue #25 明确要求 Rust 侧一律在 CI 完成 |
| `gh` CLI | 不可用 | 故 artifact 需经浏览器从 Actions 运行页下载 |
| CI 构建产物 | **已生成** | `GUI` workflow 已跑通并**三平台全部 success**：`windows-x86_64`（NSIS）、`darwin-x86_64`、`darwin-aarch64`（dmg + `.app.tar.gz`）均打包并上传产物 |
| CI 排障通道 | **注解 + 只读代理** | 公开仓 job 日志需 admin（403）→ 用 `check-runs/<job_id>/annotations` 读取诊断（详见 §三.2） |
| 签名密钥（Secrets） | **✅ 已配置并验证生效** | `UPDATER_PUBKEY` / `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（私钥带密码，三项成套）+ `GITEE_TOKEN`；配置后构建的注解中**不再出现**「未配置 `TAURI_SIGNING_PRIVATE_KEY`」，即已走签名路径 |

---

## 二、待执行验收清单（产物到位后逐项填写）

### 2.1 功能（issue DoD 2，Windows 10）

| # | 步骤 | 期望 | 结果 |
|---|---|---|---|
| F1 | 启动应用，顶栏显示自动探测到的数据目录 | 显示 `TIANSHU_MCP_HOME` 或 `~/.tianshu-mcp` | 待测 |
| F2 | 加载真实数据目录（含 `tsk_*` / `vfy_*`） | 任务列表按时间倒序列出，状态色标与轮次正确 | 待测 |
| F3 | 打开 `task.jsonl` | 时间线区分状态跃迁 / Agent 事件 / note；坏行计数如实提示 | 待测 |
| F4 | 打开 `agent-<轮次>.log` 与 `verify-<轮次>.log` | 轮次可切换；行号 / 换行 / 级别过滤 / 关键字高亮可用 | 待测 |
| F5 | 打开 `report-<轮次>.md` / `.json` / `.html` | Markdown 渲染、结构化卡片、视觉 HTML 在沙箱内渲染 | 待测 |
| F6 | 打开 `dry-run-report-*` | 与常规报告分开展示，不混轮次 | 待测 |
| F7 | 实时 tail | 日志被追加时自动增量刷新；上翻自动暂停；「跳到最新」可用 | 待测 |
| F8 | 大日志分块加载 | 显示「已加载 N / 共 M」，向前加载生效 | 待测 |
| F9 | 跨任务搜索 | 命中分组、点击跳转、进度显示、可取消 | 待测 |
| F10 | 单文件导出 | 导出原文成功且内容一致 | 待测 |
| F11 | 任务整包导出（含排除大日志） | zip 生成成功，排除数如实回报 | 待测 |
| F12 | 语言 / 主题切换 | 中英切换即时生效；深/浅/跟随系统三态生效 | 待测 |

### 2.2 双源发布与自动更新（issue DoD 8/9）

| # | 步骤 | 期望 | 结果 |
|---|---|---|---|
| U1 | 打 `gui-v0.1.0-beta.1` tag | GitHub 与 Gitee **均为 pre-release**，各附 Windows + macOS 包 | 待测 |
| U2 | 校验 `gui-v*` 未连带触发 `release.yml` | MCP 发版链路未被触发 | 待测 |
| U3 | `update/gui/latest.json` 与 `latest-gitee.json` | 两端清单可被 updater 正确读取 | 待测 |
| U4 | 模拟中国大陆网络检查更新 | 命中 **Gitee** | 待测 |
| U5 | 模拟境外 / VPN（含中国香港、中国台湾）网络检查更新 | 命中 **GitHub** | 待测 |
| U6 | 三态开关 | 自动 / 强制 Gitee / 强制 GitHub 均生效 | 待测 |
| U7 | 两端均不可达 | 按设计回退并给出明确提示（无历史时回退 GitHub） | 待测 |
| U8 | 篡改更新包后安装 | **必须拒绝安装**（minisign 验签失败） | 待测 |

### 2.3 打包与隔离（issue DoD 5/6）

| # | 步骤 | 期望 | 结果 |
|---|---|---|---|
| P1 | `npm pack --dry-run` | `mcp-gui/` **未被打入** npm 包 | ✅ 通过：tarball 共 266 文件，清单内**无任何 `mcp-gui/` 条目** |
| P2 | 仓库状态 | `mcp-gui/node_modules`、`dist`、`src-tauri/target`、`icons/*`、`Cargo.lock` 均未入库 | ✅ 通过：6 条规则全部命中（`node_modules/` / `dist/` / `src-tauri/target/` / `src-tauri/gen/` / `Cargo.lock` / `icons/*`），且 `src/lib.rs`、`icons/.gitkeep`、`package.json` 等应跟踪文件未被误伤 |
| P3 | 图标 | 仓库内只有 `assets/tianshu-mcp-icon.svg`；无 emoji、无二进制图标 | ✅ 通过：`assets/` 下仅 `tianshu-mcp-icon.svg`；`src-tauri/icons/` 仅提交 `.gitkeep`（其余由 CI 生成） |
| P4 | `tianshu-mcp-web/` | 未被改动 | ✅ 通过：最近 12 次提交均未触及该目录 |

---

## 三、CI 门禁结果

### 3.1 门禁现状（2026-09-27）

| 门禁 | 命令 / workflow | 结果 |
|---|---|---|
| 词表三方一致性 | `node mcp-gui/scripts/check-schema-parity.mjs` | ✅ 本地 + CI 均通过（TS 真源 / 前端镜像 / Rust 镜像 全部一致，含 23 项事件全集） |
| 前端 typecheck / lint / test | `mcp-gui` 的 `npm run typecheck` / `lint` / `test` | ✅ 本地 + CI 均通过（81 项用例） |
| Rust 质量门禁 | `GUI` workflow：`cargo fmt --check` / `cargo clippy -D warnings` / `cargo test` | ✅ **三平台全通过**（Windows / macOS aarch64 / macOS x86_64） |
| GUI 三平台构建 | `GUI` workflow（windows-latest / macos-15-intel / macos-15） | ✅ **三平台全部 success**：`windows-x86_64`（NSIS）、`darwin-x86_64`、`darwin-aarch64` 均完成 `tauri build` 打包并上传产物（清理临时诊断步骤后已复验一轮全绿） |
| 与 MCP 发版隔离 | `gui-v*` 不匹配 `release.yml` 的 `v*` | ✅ workflow 内显式断言通过（另见 `docs/gui-log-viewer.md` §7.2） |
| 更新包签名（minisign） | `GUI` workflow 的 `Detect signing capability` + 签名构建 | ✅ **已启用**：配置 Secrets 后构建注解中不再出现「未配置 `TAURI_SIGNING_PRIVATE_KEY`」；产物应含 `.sig`（可由 Artifacts 下载确认，见 §2.2 U8） |
| 手动触发语义 | `GUI` workflow 的 `workflow_dispatch` | ✅ **无条件构建**（运行时长正常、矩阵不再被跳过）；push / PR 仍按 `mcp-gui/**`、两个真源、`gui.yml` 做变更过滤 |

### 3.2 本轮修复过程（首次跑通前）

按「CI 是唯一 Rust 侧真源」的约束，本机不跑 cargo；因公开仓 job 日志下载需 admin 权限（403），
诊断信息一律经 **GitHub 注解**（`::error` / `::warning` → `check-runs/<job_id>/annotations`，公开可读）取得，依次修掉三类问题：

| 轮次 | 失败面 | 根因 | 修法 |
|---|---|---|---|
| 1 | `cargo fmt --check` | 14 个 `.rs` **缺少文件结尾换行**；另有多处签名折行、链式调用折行、`mod` 声明顺序 | 按 `rustfmt` 实际 diff 逐处改正（`cargo fmt` 输出即权威） |
| 2 | Rust 编译（`cargo clippy` / `cargo test` 均 101） | **Tauri 2 规则**：`async fn` 命令含借用输入（`State<'_, T>`）必须返回 `Result<_, _>`，否则 `E0277` + `E0597 __tauri_message__`；另有 `if let` 守卫临时值晚于 `State` 释放的 `E0597`；`RecommendedWatcher` 未用导入（`-D warnings` 下为错误） | 4 个命令改为返回 `Result`；`if let` 后补 `;`；删未用导入 |
| 3 | `cargo clippy` `dead_code` | 词表常量在私有模块内且仅由 CI 脚本比对；6 个请求结构体的 `data_home` 字段 Rust 侧不读取（契约字段） | 显式 `#[allow(dead_code)]` + 注释说明用途 |
| — | 附带 | 跨平台测试断言：`C:/Windows` 在类 Unix 下只是普通相对路径 | 该断言加 `#[cfg(windows)]` |
| 4 | 手动触发"跑了等于没跑" | `workflow_dispatch` 不带 `github.event.before`，变更检测退化为比较最近两次提交；若它们只改文档 → 三平台矩阵**全部 skipped**（显示 Success、时长 11s） | 手动触发改为**无条件构建**（tag 亦无条件；仅 push / PR 走 diff 过滤） |

> 排障关键细节（已同步至 `HANDOFF.md`）：**cargo / rustc 输出带 ANSI 颜色码**，解析前必须剥离，否则 `^error` 行匹配不到；
> Windows runner 上 `rustfmt` 的 diff 表头是 `Diff in <路径>:<行号>:`（非 Unix 的 `at line <行号>`）；注解有「单条 ~4K 字符 + 单步 10 条」上限，故按 2500 字符切块并分多步打印。

### 3.3 首次打 tag 暴露的问题：Windows 更新载体命名（2026-09-27）

打 `gui-v0.1.0-beta.1` tag 后 `GUI` workflow 首次走到 **`Build updater manifest fragment`** 步骤，
**Windows 失败、macOS 两个平台成功**（`Publish` 因 `needs: build` 失败被跳过）。

| 项 | 内容 |
|---|---|
| 失败面 | `Build (windows-x86_64)` → `Build updater manifest fragment`（`tauri build` 本身 success） |
| 根因 | 更新载体命名取决于 `bundle.createUpdaterArtifacts`：本项目用 **v2 原生 `true`**，Windows 侧**不产出 `.nsis.zip`**，而是**直接复用 NSIS 安装器** `*-setup.exe`（签名 `*-setup.exe.sig`）；只有 `"v1Compatible"` 才产出 `.nsis.zip`。macOS 两种模式都是 `.app.tar.gz`，故仅 Windows 命中 |
| 为何此前"全绿"没暴露 | 该步骤带 `if: startsWith(github.ref, 'refs/tags/gui-v')`，**仅在 tag 运行时执行**；此前都是 push/手动触发的非 tag 运行，步骤被跳过 |
| 修法 | `mcp-gui/scripts/build-updater-manifest.mjs` 改为**按优先级匹配多后缀**：`.nsis.zip` / `.msi.zip` / `.app.tar.gz` / `.exe` / `.msi`（专用更新包优先于复用安装器），两套命名同时存在也能选对 |
| 附带改进 | 找不到载体时**列出 bundle 目录全部文件**，便于按注解定位 |
| 验证 | 本机对 4 种场景做纯 Node 回归：v1 兼容（zip 与 exe 共存→选 zip）、v2 原生 Windows（→选 exe）、macOS（→选 `.app.tar.gz`）、空目录（→非 0 退出并列出文件） |

修复后**三平台构建全部 success**，但发布链路又暴露三个问题，已一并修掉（第 2 轮）：

| 轮次 | 失败面 | 根因 | 修法 |
|---|---|---|---|
| 2-a | macOS 载体**同名覆盖**（发布前即已发生，不在 CI 报错） | Tauri 产出的 macOS 更新载体名为 `{productName}.app.tar.gz`，**不含架构**；`darwin-aarch64` 与 `darwin-x86_64` 同名，发布脚本 `cp -n` 只留先到的一个 → 其中一个架构会拿到**错误架构**的包（实测 GitHub / Gitee 发行版均只剩 1 个 `.app.tar.gz`） | 清单脚本在 fragment 阶段**按平台重命名**为 `*_<platform>.app.tar.gz`（含 `.sig`，幂等）；已本地验证两架构名唯一、重跑不叠加后缀 |
| 2-b | `Publish Gitee pre-release with attachments + write Gitee manifest` | Gitee Contents API 与 GitHub 不同：**新建文件用 `POST`、更新才用 `PUT`**；脚本对首次发布的**不存在**文件发了 `PUT` → 被拒（发行版与附件其实都已建好，只差清单写入） | 按 `sha` 是否存在选择 `POST` / `PUT`，并把 `access_token` 同时放入 query；同时**清理上一轮残留旧附件**（仅限本管道管理的安装包/载体后缀，best-effort 不中断） |
| 2-c | 重跑时 `gh release create` 报「已存在」 | 发布步骤非幂等：tag 重跑（本计划明确支持的恢复路径）会直接失败 | 改为幂等：发行版已存在则 `gh release edit` 更新元信息 + `delete-asset` 清空旧资产 + `upload` 重传 |
| 2-d | （静默缺陷）产物名含空格 | `bundle.productName` 为 `Tianshu-mcp Logs`，Tauri 产物名因此含空格。**GitHub 会重命名含空格等非字母数字字符的发行资产名（空格→点），Gitee 却原样保留**（实测 GitHub 资产为 `Tianshu-mcp.Logs_*.exe`、Gitee 为 `Tianshu-mcp Logs_*.exe`）→ 两端命名不一致，更新清单里的下载地址会失效 | `productName` 改为无空格的 `Tianshu-mcp-Logs`（界面显示名不变）；CI 增加断言：载体名含非 `[A-Za-z0-9._-]` 字符即失败 |
| 2-e | Gitee 附件上传中断 | 本次 `Publish Gitee` 在**第 5 个附件**（首个 `.app.tar.gz`）上传时中断（前 4 个已成功落库，与文件名/大小无关，指向瞬时故障）；且公开仓 job 日志需 admin（403），拿不到原文 | 附件上传/清单写入增加**指数退避重试**（仅对 5xx / 429 / 网络错误重试，4xx 立即失败）；Gitee 步骤失败时把 `node` 输出转为 **`::error::` 注解**（公开可读）便于下次直接定位 |
| 2-f | （静默降级）Gitee 清单可能指向 GitHub | 某平台在 Gitee 找不到附件时仅 `warn` 并沿用 GitHub 地址 —— 中国大陆网络下 GitHub 通常不可达，等于自动更新不可用，却不报错 | 改为 **fail-closed**：任一平台缺 Gitee 附件即拒绝生成清单并报错 |

> 教训：**「构建全绿」不等于「发布链路可用」**——`Build updater manifest fragment` 与 `publish` 里的发布步骤都只在 **tag 运行**时才执行，
> 非 tag 的 push / 手动触发一律跳过；因此首次打 tag 才会把这些问题一次性暴露出来。

---

## 四、结论

**CI 侧已跑通**（2026-09-27）：`GUI` workflow 的 `schema-parity` 与三平台 `cargo fmt` / `clippy -D warnings` / `cargo test` 全绿，
且 **三个平台（windows-x86_64 / darwin-x86_64 / darwin-aarch64）全部 success**，均完成 `tauri build` 打包并上传产物。

**§2.3 打包与隔离（P1~P4）已在本机验证通过**（纯 Node 检查，不涉及 Rust 侧，见上表）。

**§2.1 功能（F1~F12）与 §2.2 更新（U1~U8）仍需维护者用 CI 产物在真机上逐项验收**——
本机按 issue #25 的硬约束不跑 Rust 侧，也不具备双系统的真机点击条件；产物到位后按清单填写即可。
其中 U1/U3 需先打 `gui-v0.1.0-beta.1` tag 才会走到发布链路。

已知限制（已在 `docs/gui-log-viewer.md` 如实披露）：

1. macOS 未做 Apple 代码签名 / 公证；
2. 未提供 MSI（Windows 仅 NSIS）；
3. 未构建 Linux 版本；
4. 无任务写操作、无本地全文索引；
5. macOS 侧仅保证 CI 构建通过。
6. 签名 Secret 未配置前，产物不含更新清单（自动更新不可用，安装包本身可正常使用）。