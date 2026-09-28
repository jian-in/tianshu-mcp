# 日志台 GUI 0.1.0 正式版发布记录

- 关联计划：`.rivet/plans/mcp-gui-0-1-0-正式版发布计划.md`（用户三轮澄清后定稿）
- 基线提交：`5e0d256`（工作区 clean；`mcp-gui/` 与 tag `gui-v0.1.0-beta.9` 无差异）
- 发布目标版本：**GUI 独立版本 `0.1.0`**（tag `gui-v0.1.0`）；**不涉及 MCP 主包版本迭代**（主包仍为 `0.7.4`）
- 记录日期：2026-09-29

> 范围（用户决策）：「0.1.0 = 转正 + 更新日志面板」。功能与界面在 beta.9 基础上**只加更新日志面板**，
> 其余只做发布链（tag 触发 / 预发布标记）、测试版文案、版本号与双语文档的转正。

---

## 一、Wave 0 — 基线取证

| 项 | 命令 | 结果 |
|---|---|---|
| 基线提交 | `git rev-parse --short HEAD` | `5e0d256`，`git status --porcelain` 为空 |
| 与 beta.9 的差集 | `git diff --stat gui-v0.1.0-beta.9..HEAD -- mcp-gui/` | **输出为空**（当前 `mcp-gui/` 即 beta.9 代码） |
| 前端五项门禁 | `typecheck` / `lint` / `test` / `check:schema` / `build` | 全部 exit 0；`vitest` **82 passed**（8 文件） |
| 版本号四处 | 读四个文件 | 均为 `0.1.0-beta.9` |
| 三 workflow 状态 | GitHub API 查 `5e0d256` 的最近一次运行 | `CI` / `GUI` / `Release v0.7.4` 均 `completed/success` |

---

## 二、Wave 1 — 更新日志面板（新功能）

**先写会红的测试**：`mcp-gui/test/version.test.ts` 首跑报
`Cannot find package '@/core/version'`（RED），随后实现 `mcp-gui/src/core/version.ts` 转 GREEN（**16 项**）。

改动落点：

| 层 | 文件 | 内容 |
|---|---|---|
| 纯逻辑 | `mcp-gui/src/core/version.ts` | `parseVersion` / `compareVersion` / `shouldPrompt`（semver 子集，正式版高于同号预发布版） |
| 偏好 | `mcp-gui/src-tauri/src/models.rs` | `Preferences.ignored_update_version`（**带 `#[serde(default)]`**，避免旧偏好文件整份回退默认值） |
| 契约 | `mcp-gui/src/api/types.ts` · `mcp-gui/src/stores/preferences.ts` | 前端字段与默认值 |
| 预览 | `mcp-gui/src/api/mock.ts` | 预览下如实返回「有可用更新」（当前版本 patch + 1，含 Markdown 正文），安装仍明确报错 |
| 状态 | `mcp-gui/src/stores/app.ts` | `dialogOpen` + `checkUpdateOnStartup()`（静默、不 await）+ `ignoreUpdateVersion()` |
| 界面 | `mcp-gui/src/components/UpdateDialog.vue`（新增）· `App.vue` · `SettingsDrawer.vue` · `styles.css` | 大尺寸居中弹窗（`min(1070px,92vw)` × `min(750px,88vh)`）、四个动作、正文 Markdown 渲染 |
| 文案 | `mcp-gui/src/i18n/zh-CN.ts` · `en-US.ts` | 新增 5 键（弹窗标题 / 正文为空 / 忽略 / 稍后 / 已忽略提示），中英同步 |

**无头 Edge 探针（`.rivet/scratch/gui-update-probe.mjs`，跑完即弃）15/15 通过**：

| 断言 | 实测 |
|---|---|
| 启动静默检查后自动弹出面板 | ✅ |
| 弹窗宽度 ≈1070 / 高度 ≈750（1440×900 视口） | ✅ 实测 1070 × 750 |
| 底部有「下载并安装 / 忽略此版本 / 稍后」 | ✅ |
| release 正文渲染为 DOM（标题 + 列表） | ✅ 192 字符 |
| 点击「忽略此版本」后偏好持久化 | ✅ `ignoredUpdateVersion=0.1.1` |
| 重载后**不再**自动弹窗 | ✅ |
| 手动点「检查更新」**仍能看到**该版本 | ✅ |
| 全程无 `pageerror` | ✅ |

提交：`c1cd478` — `feat(gui): 新增更新日志面板（启动静默检查 / 忽略此版本 / release 正文渲染）`（14 文件）

---

## 三、Wave 2 — 发布链改造

| 项 | 锚点 | 改动 |
|---|---|---|
| tag 触发 | `.github/workflows/gui.yml`（`on.push.tags`） | `gui-v*-beta.*` → **`gui-v*`**（正式版与预发布共用一条流水线） |
| 预发布分流 | 同文件新增 `Decide pre-release and compose release body` 步骤 | tag 含 `-beta.` / `-rc.` → `prerelease=true`，否则 `false` |
| 发行版正文 | 新增 `scripts/gui-release-body.mjs` | 读 `docs/release-gui-v<版本>.md` + `.en.md` 合成双语正文；复用 `release-body.mjs` 的链接绝对化；**缺文档即非 0 退出** |
| GitHub 发布 | 同文件 `gh release create` | `--prerelease` 改为按变量；`--notes` → **`--notes-file`**（正文来自上述脚本） |
| Gitee 发布 | `scripts/gitee-gui-release.mjs` | 新增 `--prerelease` / `--body-file`；正文与 GitHub 侧**同源**；去硬编码「测试版」 |
| 版本号 | `mcp-gui/package.json` · `package-lock.json`（2 处）· `src-tauri/tauri.conf.json` · `src-tauri/Cargo.toml` | 四处统一 bump 到 **`0.1.0`** |
| 界面文案 | `mcp-gui/src/i18n/{zh-CN,en-US}.ts` | `betaChannel` 值改为「正式版通道」/「Stable channel」（**保留键名**，绕开 i18n 键集合校验） |

**验证结果**：

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端五项门禁 | `npm run typecheck/lint/test/check:schema/build` | 全 exit 0；`check:schema` 输出 **「GUI 版本号一致（0.1.0）」** |
| 新增单测 | `npx vitest run test/unit/gui-release-body.test.ts` | **7 passed** |
| 排障记录 | — | **vitest 无法 import 带 shebang 的 `.mjs`**（vite SSR transform 抛 `SyntaxError: Invalid or unexpected token`），故 `gui-release-body.mjs` 刻意不带 shebang并在文件头注明 |
| 版本号四处 | node 断言 | `package.json=0.1.0` `tauri.conf=0.1.0` `lock=0.1.0`×2 `Cargo=0.1.0` |
| gui.yml 语法 | `js-yaml` 解析 | OK（jobs=schema-parity, build, publish） |
| 根工程 typecheck / lint | `tsc --noEmit` / `eslint --max-warnings 0` | 均 exit 0 |
| MCP 零触碰 | `git diff --name-only` 断言 | OK：`src/**`、`ci.yml`、`release.yml`、`scripts/release-body.mjs` 均不在 diff |
| 「测试版」残留 | `grep -rn` 覆盖 `mcp-gui/src`、`gui.yml`、两个发布脚本、`src-tauri` | **无残留** |

提交：`117688c` — `ci(gui): 发布链支持正式版（tag 触发 / 预发布分流 / 双语发行版正文）并 bump 0.1.0`（10 文件）

---

## 四、Wave 3 — 发行说明与文档

| 项 | 文件 | 状态 |
|---|---|---|
| 双语发行说明（全景式） | `docs/release-gui-v0.1.0.md` · `docs/release-gui-v0.1.0.en.md`（新增） | 已建；覆盖 0.1.0 线全部能力 + 更新日志面板 + 已知限制 |
| 发布记录 | `docs/gui-0.1.0-release-record.md`（新增） | 本文件 |
| 功能文档 | `docs/gui-log-viewer.md` · `.en.md` | 下载语义、通道描述、更新日志面板小节、已知限制 |
| 变更记录 | `CHANGELOG.md` · `CHANGELOG.en.md` | `## [未发布] — mcp-gui 独立版本线` → `## [0.1.0]` |
| 项目文档 | `README.md` · `.en.md` · `ARCHITECTURE.md` · `.en.md` · `HANDOFF.md` | GUI 版本标注与发布链描述同步 |

**正文合成实测**：`node scripts/gui-release-body.mjs 0.1.0 github lanlan0811/tianshu-mcp` →
272 行；相对链接已绝对化到 `blob/gui-v0.1.0/docs/`；**不含 npm registry 行**（GUI 不发 npm）。

---

## 五、Wave 4 — 预演验证（先 dispatch，不推 tag）

**推送**：本地 3 个提交（`c1cd478` / `117688c` / `5ec8831`）推送到**双仓**，两仓均由
`5e0d256` 快进到 `5ec8831`（推送前 `rev-list --left-right --count` 确认**无分叉**：behind=0）。

**GitHub 侧构建（push 触发，非 tag）**：GUI run
36471063339 —— 结论 **success**：

| job | 结论 |
|---|---|
| `Schema parity (TS ↔ frontend ↔ Rust)` | success |
| `Build (windows-x86_64)` | **success** |
| `Build (darwin-x86_64)` | **success** |
| `Build (darwin-aarch64)` | **success** |
| `Publish release (GitHub + Gitee)` | skipped（非 tag，符合预期——发布只认 tag） |

同提交的 `CI` run 36471063249 亦为 `completed/success`（MCP 主包门禁未被本次改动破坏）。

**产物已上传（GitHub API 实测）**：

| artifact | 大小 | 保留到期 |
|---|---|---|
| `gui-windows-x86_64` | 2.8 MB | 2026-10-12 |
| `gui-darwin-aarch64` | 7.2 MB | 2026-10-12 |
| `gui-darwin-x86_64` | 7.6 MB | 2026-10-12 |

> 说明：三平台构建**真实执行**（非 skipped）；`Rust format / clippy / tests` 三步随 `Build` job 一并通过，
> 即本次新增的 Rust 代码（`Preferences.ignored_update_version`）已通过 CI 的 `cargo fmt --check` /
> `cargo clippy -D warnings` / `cargo test` ——这是本机无法执行的 Rust 侧门禁，按 issue #25 的约束一律由 CI 承担。
