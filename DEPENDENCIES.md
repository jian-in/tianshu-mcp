# DEPENDENCIES.md — 依赖清单

> 适用版本：主包 `tianshu-mcp@0.7.4`；桌面端日志台 `tianshu-mcp-logs@0.1.0`（`mcp-gui/`，独立版本线）。
> 本文列出**直接依赖**及其许可证，并给出**间接依赖**规模、许可证分布与可复现命令。
> 英文版：[DEPENDENCIES.en.md](DEPENDENCIES.en.md)。
> 安装与用法见 [README.md](README.md)；安全边界见 [SECURITY.md](SECURITY.md)；架构说明见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 1. 口径与数据来源

- **直接依赖** = 各 `package.json` / `Cargo.toml` 中显式声明的依赖；表中「声明范围」为清单里写的约束，「当前锁定」为本次统计时 `package-lock.json` / `Cargo.lock` 解析到的版本。
- **间接依赖**不逐条罗列，只给规模与许可证分布，可用第 10 节的命令复现全量 SBOM。
- **许可证取值来源**：Node 侧取 `package-lock.json` 中各条目的 `license` 字段（与 `node_modules` 内实测一致）；Rust 侧取 `Cargo.lock` 解析后的版本、再去对应 crate 落盘源码的 `Cargo.toml` 读 `license` 字段。
- 本项目**没有任何私有依赖**，全部来自公开 npm registry / crates.io。
- 直接依赖的版本随发布演进，**以本文件顶部的适用版本为准**；锁文件是唯一权威版本来源。

## 2. 主包运行时依赖（随 npm 包分发）

| 包 | 声明范围 | 当前锁定 | 许可证 | 用途 |
|---|---|---|---|---|
| [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/sdk) | `^1.15.0` | 1.30.0 | MIT | MCP 协议实现（stdio server 与工具注册） |
| [`@puppeteer/browsers`](https://github.com/puppeteer/puppeteer) | `2.13.2` | 2.13.2 | Apache-2.0 | 托管 Chrome / Edge 的安装与版本锁定 |
| [`cross-spawn`](https://github.com/moxystudio/node-cross-spawn) | `^7.0.6` | 7.0.6 | MIT | 跨平台子进程（验收命令与 CLI agent） |
| [`pixelmatch`](https://github.com/mapbox/pixelmatch) | `7.2.0` | 7.2.0 | ISC | 页面截图像素比对 |
| [`puppeteer-core`](https://github.com/puppeteer/puppeteer) | `24.43.1` | 24.43.1 | Apache-2.0 | 视觉验收驱动无头浏览器 |
| [`zod`](https://github.com/colinhacks/zod) | `^3.24.1` | 3.25.76 | MIT | 外部输入与配置校验 |

> 这六个包是 `dependencies`，会随 `npm pack` 产物安装到使用方环境。

## 3. 主包可选依赖（`optionalDependencies`）

| 包 | 声明范围 | 当前锁定 | 许可证 | 用途 |
|---|---|---|---|---|
| [`sharp`](https://github.com/lovell/sharp) | `0.34.5` | 0.34.5 | Apache-2.0 | 图片解码与规格校验；**缺失时视觉模块明确阻塞，不静默降级** |

> **注意（许可证）**：`sharp` 本体为 Apache-2.0，但它按平台安装的预编译二进制包
> （`@img/sharp-libvips-*`、`@img/sharp-win32-*`、`@img/sharp-wasm32`）声明为
> **LGPL-3.0-or-later**（其中部分为 `Apache-2.0 AND LGPL-3.0-or-later`）。
> 这些包**只在安装 `sharp` 时出现**，且以**未修改的预编译动态库**形式使用。
> 不安装 `sharp`（或不使用视觉验收）时，依赖树中不含任何 LGPL 组件。

## 4. 主包开发依赖（不随 npm 包分发）

| 包 | 声明范围 | 当前锁定 | 许可证 | 用途 |
|---|---|---|---|---|
| [`@types/cross-spawn`](https://www.npmjs.com/package/@types/cross-spawn) | `^6.0.6` | 6.0.6 | MIT | `cross-spawn` 类型声明 |
| [`@types/node`](https://www.npmjs.com/package/@types/node) | `^22.10.2` | 22.20.1 | MIT | Node 类型声明 |
| [`@typescript-eslint/eslint-plugin`](https://typescript-eslint.io/) | `^8.18.1` | 8.69.0 | MIT | TypeScript ESLint 规则 |
| [`@typescript-eslint/parser`](https://typescript-eslint.io/) | `^8.18.1` | 8.69.0 | MIT | TypeScript 解析器 |
| [`eslint`](https://eslint.org/) | `^8.57.1` | 8.57.1 | MIT | 静态检查 |
| [`eslint-config-prettier`](https://github.com/prettier/eslint-config-prettier) | `^9.1.0` | 9.1.2 | MIT | 关闭与 Prettier 冲突的规则 |
| [`linkedom`](https://github.com/WebReflection/linkedom) | `^0.18.13` | 0.18.13 | ISC | 测试用轻量 DOM（GUI 适配器夹具） |
| [`prettier`](https://prettier.io/) | `^3.4.2` | 3.9.6 | MIT | 代码格式化 |
| [`tsx`](https://github.com/privatenumber/tsx) | `^4.19.2` | 4.23.13 | MIT | 开发期直接运行 TypeScript |
| [`typescript`](https://www.typescriptlang.org/) | `^5.7.2` | 5.9.3 | Apache-2.0 | 编译与类型检查 |
| [`vite`](https://vite.dev/) | `^6.4.3` | 6.4.3 | MIT | 测试与构建工具链 |
| [`vitest`](https://vitest.dev/) | `^4.1.11` | 4.1.11 | MIT | 单元 / 集成 / 协议测试 |

## 5. 主包间接依赖规模与许可证分布

`package-lock.json`（`lockfileVersion: 3`）共 **450** 个锁定条目（不含根包），全部带有 `license` 字段：

| 许可证 | 条目数 |
|---|---|
| MIT | 341 |
| ISC | 31 |
| Apache-2.0 | 31 |
| BSD-2-Clause | 22 |
| LGPL-3.0-or-later | 10 |
| BSD-3-Clause | 7 |
| Apache-2.0 AND LGPL-3.0-or-later | 3 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| BSD-2-Clause / BlueOak-1.0.0 / 0BSD / Python-2.0 / (MIT OR CC0-1.0) | 各 1 |

> 全部 10 个 `LGPL-3.0-or-later` 条目都来自第 3 节的**可选** `sharp` 平台二进制；
> 未安装 `sharp` 时，间接依赖树中只剩宽松许可（MIT / ISC / Apache-2.0 / BSD / 0BSD / CC0 / BlueOak）。
> `Python-2.0`（`argparse`）与 `BlueOak-1.0.0`（`minimatch`）均只出现在**开发**依赖子树中。

## 6. 桌面端日志台（`mcp-gui/`）运行时依赖

| 包 | 声明范围 | 当前锁定 | 许可证 | 用途 |
|---|---|---|---|---|
| [`@tauri-apps/api`](https://github.com/tauri-apps/tauri) | `^2.1.1` | 2.12.0 | Apache-2.0 OR MIT | 前端调用 Tauri 命令与事件 |
| [`@tauri-apps/plugin-opener`](https://github.com/tauri-apps/plugins-workspace) | `^2.2.0` | 2.6.0 | MIT OR Apache-2.0 | 外部打开（**权限带域名白名单**） |
| [`markdown-it`](https://github.com/markdown-it/markdown-it) | `^14.1.0` | 14.3.2 | MIT | 验收报告与发行说明的 Markdown 渲染 |
| [`vue`](https://github.com/vuejs/core) | `^3.5.13` | 3.5.43 | MIT | 界面框架 |

## 7. 桌面端日志台开发依赖

| 包 | 声明范围 | 当前锁定 | 许可证 | 用途 |
|---|---|---|---|---|
| [`@tauri-apps/cli`](https://github.com/tauri-apps/tauri) | `^2.1.0` | 2.12.0 | Apache-2.0 OR MIT | `tauri` 构建 / 开发命令 |
| [`@vitejs/plugin-vue`](https://github.com/vitejs/vite-plugin-vue) | `^5.2.1` | 5.2.4 | MIT | Vue 单文件组件支持 |
| [`@types/markdown-it`](https://www.npmjs.com/package/@types/markdown-it) | `^14.1.2` | 14.2.0 | MIT | `markdown-it` 类型声明 |
| [`eslint`](https://eslint.org/) | `^9.17.0` | 9.39.5 | MIT | 静态检查（flat config） |
| [`eslint-plugin-vue`](https://github.com/vuejs/eslint-plugin-vue) | `^9.32.0` | 9.33.0 | MIT | Vue 规则 |
| [`typescript`](https://www.typescriptlang.org/) | `~5.7.2` | 5.7.3 | Apache-2.0 | 类型检查 |
| [`typescript-eslint`](https://typescript-eslint.io/) | `^8.18.1` | 8.70.1 | MIT | TypeScript ESLint（flat config） |
| [`vite`](https://vite.dev/) | `^6.0.7` | 6.4.3 | MIT | 前端构建与开发服务器 |
| [`vitest`](https://vitest.dev/) | `^4.0.0` | 4.1.11 | MIT | 前端单元测试 |
| [`vue-eslint-parser`](https://github.com/vuejs/vue-eslint-parser) | `^9.4.3` | 9.4.3 | MIT | Vue 模板解析 |
| [`vue-tsc`](https://github.com/vuejs/language-tools) | `^2.2.0` | 2.2.12 | MIT | `.vue` 类型检查 |

> 桌面端间接依赖共 **266** 个锁定条目，许可证分布（全部带 `license` 字段）：
> MIT 209 · Apache-2.0 17 · `Apache-2.0 OR MIT` 13 · BSD-2-Clause 11 · ISC 10 · BSD-3-Clause 2 ·
> `MIT OR Apache-2.0` / `BlueOak-1.0.0` / `Python-2.0` / `(MIT OR CC0-1.0)` 各 1。

## 8. 桌面端日志台 Rust（Tauri）直接依赖

| crate | 声明范围 | 当前锁定 | 许可证 | 用途 |
|---|---|---|---|---|
| [`tauri`](https://github.com/tauri-apps/tauri) | `2` | 2.12.0 | Apache-2.0 OR MIT | 桌面框架（启用 `tray-icon`） |
| [`tauri-build`](https://github.com/tauri-apps/tauri) | `2` | 2.7.0 | Apache-2.0 OR MIT | 构建脚本（`build-dependencies`） |
| [`tauri-plugin-dialog`](https://github.com/tauri-apps/plugins-workspace) | `2` | 2.8.0 | Apache-2.0 OR MIT | 原生对话框 |
| [`tauri-plugin-opener`](https://github.com/tauri-apps/plugins-workspace) | `2` | 2.6.0 | Apache-2.0 OR MIT | 外部打开（与前端插件配套） |
| [`tauri-plugin-updater`](https://github.com/tauri-apps/plugins-workspace) | `2` | 2.13.0 | Apache-2.0 OR MIT | 自动更新（**minisign 验签**） |
| [`serde`](https://github.com/serde-rs/serde) | `1` | 1.0.229 | MIT OR Apache-2.0 | 序列化 |
| [`serde_json`](https://github.com/serde-rs/json) | `1` | 1.0.151 | MIT OR Apache-2.0 | JSON 读写 |
| [`notify`](https://github.com/notify-rs/notify) | `7` | 7.0.0 | CC0-1.0 | 日志文件监听（tail 增量刷新） |
| [`zip`](https://github.com/zip-rs/zip2) | `2` | 2.4.2 | MIT | 任务整包导出 |
| [`ureq`](https://github.com/algesten/ureq) | `2` | 2.12.1 | MIT OR Apache-2.0 | 更新清单探测（无 async 运行时） |
| [`url`](https://github.com/servo/rust-url) | `2` | 2.5.8 | MIT OR Apache-2.0 | URL 解析 |
| [`dirs`](https://github.com/dirs-dev/dirs-rs) | `6` | 6.0.0 | MIT OR Apache-2.0 | 系统目录解析 |

## 9. 桌面端日志台 Rust 间接依赖

`mcp-gui/src-tauri/Cargo.lock` 共 **534** 个 crate（含第 8 节的直接依赖）。按 crate 落盘源码统计，
本机已可解析许可证的 **324** 个分布如下（其余 210 个是**未下载的平台相关 crate**，
如 Linux 的 `atk` / `cairo-rs`、macOS 的 `objc2` 系，需在具备 Rust 工具链与网络的机器上复算）：

| 许可证 | crate 数 |
|---|---|
| MIT OR Apache-2.0 | 163 |
| MIT | 63 |
| Apache-2.0 OR MIT | 31 |
| Unicode-3.0 | 18 |
| Unlicense OR MIT | 8 |
| MPL-2.0 | 5 |
| BSD-3-Clause | 4 |
| Apache-2.0 | 3 |
| Zlib / Apache-2.0 OR ISC OR MIT / MIT OR Zlib OR Apache-2.0 / ISC / Unlicense/MIT / CDLA-Permissive-2.0 | 各 2 |
| 其余组合式与近似写法（`0BSD OR MIT OR Apache-2.0`、`CC0-1.0`、`Apache-2.0 AND MIT` 等） | 各 1 |

> 需要注意的两点：
> ① `MPL-2.0`（5 个）是**文件级弱 copyleft**，仅影响这些 crate 自身文件，不改变本项目源码的许可；
> ② `Unicode-3.0`（18 个）为宽松许可，常见于 Unicode 数据 crate。
> Rust 侧的完整许可证审计建议在具备工具链的机器上跑 `cargo deny check licenses`（见下节）。

## 10. 复现与全量 SBOM

```bash
# 主包：依赖树与许可证
npm ls --all
npm sbom --sbom-format spdx      # 生成 SPDX 文档（含间接依赖）

# 桌面端日志台：前端依赖树
cd mcp-gui && npm ls --all

# 桌面端日志台：Rust 依赖图（需 Rust 工具链，本项目开发机不执行 Rust 侧构建）
cargo metadata --manifest-path mcp-gui/src-tauri/Cargo.toml --format-version 1
cargo deny check licenses --manifest-path mcp-gui/src-tauri/Cargo.toml
```

> 校对本文件时，请以「锁文件 → 本文件」的方向核对：先跑上面的命令，再看表里是否有遗漏。
> 直接依赖清单以 `package.json`、`mcp-gui/package.json`、`mcp-gui/src-tauri/Cargo.toml` 为准。

## 11. 许可与合规说明

- 本项目自身以 **Apache License 2.0** 发布，完整文本见 [LICENSE](LICENSE)。
- 上表中绝大多数依赖为**宽松许可**（0BSD / CC0-1.0 / ISC / MIT / BSD / Apache-2.0 / Unlicense / Zlib / BlueOak），与 Apache-2.0 兼容。
- 存在两类**弱 copyleft** 组件，均以**未修改**方式使用，不影响本项目源码的许可：
  - `sharp` 的**可选**平台二进制（LGPL-3.0-or-later，见第 3 节）——不安装即不存在；
  - Rust 间接依赖中的 **MPL-2.0**（见第 9 节）。
- **重新分发**（含把本 MCP 打包进你自己的发行版）时，请保留本项目的 `LICENSE`，并保留上述依赖各自的许可证与版权声明；
  需要随附第三方许可证全文时，请按第 10 节的命令导出后一并分发。
- 本文件是**工程口径的依赖清单**，不构成法律意见；合规判定请以各依赖许可证原文为准。

---

> 英文版：[DEPENDENCIES.en.md](DEPENDENCIES.en.md)。版本变更见 [CHANGELOG.md](CHANGELOG.md)。