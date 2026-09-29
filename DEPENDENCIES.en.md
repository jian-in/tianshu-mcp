# DEPENDENCIES.md — Dependency Manifest

> Applies to: the main package `tianshu-mcp@0.7.4`; the desktop log viewer `tianshu-mcp-logs@0.1.0` (`mcp-gui/`, a separate version line).
> This file lists **direct dependencies** and their licenses, plus the **indirect dependency** scale, license distribution and reproducible commands.
> Chinese version: [DEPENDENCIES.md](DEPENDENCIES.md).
> Installation and usage: [README.en.md](README.en.md); security boundaries: [SECURITY.en.md](SECURITY.en.md); architecture: [ARCHITECTURE.en.md](ARCHITECTURE.en.md).

---

## 1. Scope and data sources

- **Direct dependencies** are those explicitly declared in the various `package.json` / `Cargo.toml` files; the "declared range" column is the constraint written in the manifest, and "current lock" is the version resolved from `package-lock.json` / `Cargo.lock` at the time of this inventory.
- **Indirect dependencies** are not listed individually — only their scale and license distribution are given, and the commands in section 10 reproduce a full SBOM.
- **License provenance**: on the Node side, the `license` field of each entry in `package-lock.json` (which matches what is actually installed under `node_modules`); on the Rust side, the version resolved from `Cargo.lock` and then the `license` field of that crate's `Cargo.toml` in the locally unpacked sources.
- This project has **no private dependencies** — everything comes from the public npm registry / crates.io.
- Direct dependency versions move with each release; **the versions at the top of this file are authoritative for this revision**, and the lock files remain the single source of truth for versions.

## 2. Main package runtime dependencies (shipped in the npm artifact)

| Package | Declared range | Current lock | License | Purpose |
|---|---|---|---|---|
| [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/sdk) | `^1.15.0` | 1.30.0 | MIT | MCP protocol implementation (stdio server and tool registration) |
| [`@puppeteer/browsers`](https://github.com/puppeteer/puppeteer) | `2.13.2` | 2.13.2 | Apache-2.0 | Installing and version-pinning managed Chrome / Edge |
| [`cross-spawn`](https://github.com/moxystudio/node-cross-spawn) | `^7.0.6` | 7.0.6 | MIT | Cross-platform child processes (acceptance commands and CLI agents) |
| [`pixelmatch`](https://github.com/mapbox/pixelmatch) | `7.2.0` | 7.2.0 | ISC | Page screenshot pixel comparison |
| [`puppeteer-core`](https://github.com/puppeteer/puppeteer) | `24.43.1` | 24.43.1 | Apache-2.0 | Headless browser driving for visual acceptance |
| [`zod`](https://github.com/colinhacks/zod) | `^3.24.1` | 3.25.76 | MIT | External input and config validation |

> These six are `dependencies` and are installed into the consumer's environment by `npm pack`.

## 3. Main package optional dependencies (`optionalDependencies`)

| Package | Declared range | Current lock | License | Purpose |
|---|---|---|---|---|
| [`sharp`](https://github.com/lovell/sharp) | `0.34.5` | 0.34.5 | Apache-2.0 | Image decoding and spec validation; **when absent the visual module blocks explicitly rather than degrading silently** |

> **License note**: `sharp` itself is Apache-2.0, but the per-platform prebuilt binary packages it installs
> (`@img/sharp-libvips-*`, `@img/sharp-win32-*`, `@img/sharp-wasm32`) are declared as
> **LGPL-3.0-or-later** (some as `Apache-2.0 AND LGPL-3.0-or-later`).
> Those packages are present **only when `sharp` is installed**, and are used as **unmodified prebuilt shared libraries**.
> Without `sharp` (or without using visual acceptance) the dependency tree contains no LGPL component at all.

## 4. Main package development dependencies (not shipped)

| Package | Declared range | Current lock | License | Purpose |
|---|---|---|---|---|
| [`@types/cross-spawn`](https://www.npmjs.com/package/@types/cross-spawn) | `^6.0.6` | 6.0.6 | MIT | Type declarations for `cross-spawn` |
| [`@types/node`](https://www.npmjs.com/package/@types/node) | `^22.10.2` | 22.20.1 | MIT | Node type declarations |
| [`@typescript-eslint/eslint-plugin`](https://typescript-eslint.io/) | `^8.18.1` | 8.69.0 | MIT | TypeScript ESLint rules |
| [`@typescript-eslint/parser`](https://typescript-eslint.io/) | `^8.18.1` | 8.69.0 | MIT | TypeScript parser |
| [`eslint`](https://eslint.org/) | `^8.57.1` | 8.57.1 | MIT | Static analysis |
| [`eslint-config-prettier`](https://github.com/prettier/eslint-config-prettier) | `^9.1.0` | 9.1.2 | MIT | Disables rules that conflict with Prettier |
| [`linkedom`](https://github.com/WebReflection/linkedom) | `^0.18.13` | 0.18.13 | ISC | Lightweight DOM for tests (GUI adapter fixtures) |
| [`prettier`](https://prettier.io/) | `^3.4.2` | 3.9.6 | MIT | Code formatting |
| [`tsx`](https://github.com/privatenumber/tsx) | `^4.19.2` | 4.23.13 | MIT | Running TypeScript directly during development |
| [`typescript`](https://www.typescriptlang.org/) | `^5.7.2` | 5.9.3 | Apache-2.0 | Compilation and type checking |
| [`vite`](https://vite.dev/) | `^6.4.3` | 6.4.3 | MIT | Test and build toolchain |
| [`vitest`](https://vitest.dev/) | `^4.1.11` | 4.1.11 | MIT | Unit / integration / protocol tests |

## 5. Main package indirect dependencies: scale and license distribution

`package-lock.json` (`lockfileVersion: 3`) holds **450** locked entries (excluding the root package), all of which carry a `license` field:

| License | Entries |
|---|---|
| MIT | 341 |
| ISC | 31 |
| Apache-2.0 | 31 |
| BSD-2-Clause | 22 |
| LGPL-3.0-or-later | 10 |
| BSD-3-Clause | 7 |
| Apache-2.0 AND LGPL-3.0-or-later | 3 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| BSD-2-Clause / BlueOak-1.0.0 / 0BSD / Python-2.0 / (MIT OR CC0-1.0) | 1 each |

> All 10 `LGPL-3.0-or-later` entries come from the **optional** `sharp` platform binaries in section 3;
> without `sharp`, the indirect tree contains only permissive licenses (MIT / ISC / Apache-2.0 / BSD / 0BSD / CC0 / BlueOak).
> `Python-2.0` (`argparse`) and `BlueOak-1.0.0` (`minimatch`) appear only inside the **development** subtree.

## 6. Desktop log viewer (`mcp-gui/`) runtime dependencies

| Package | Declared range | Current lock | License | Purpose |
|---|---|---|---|---|
| [`@tauri-apps/api`](https://github.com/tauri-apps/tauri) | `^2.1.1` | 2.12.0 | Apache-2.0 OR MIT | Frontend access to Tauri commands and events |
| [`@tauri-apps/plugin-opener`](https://github.com/tauri-apps/plugins-workspace) | `^2.2.0` | 2.6.0 | MIT OR Apache-2.0 | Opening external URLs (**allowlisted by domain**) |
| [`markdown-it`](https://github.com/markdown-it/markdown-it) | `^14.1.0` | 14.3.2 | MIT | Markdown rendering for acceptance reports and release notes |
| [`vue`](https://github.com/vuejs/core) | `^3.5.13` | 3.5.43 | MIT | UI framework |

## 7. Desktop log viewer development dependencies

| Package | Declared range | Current lock | License | Purpose |
|---|---|---|---|---|
| [`@tauri-apps/cli`](https://github.com/tauri-apps/tauri) | `^2.1.0` | 2.12.0 | Apache-2.0 OR MIT | `tauri` build / dev commands |
| [`@vitejs/plugin-vue`](https://github.com/vitejs/vite-plugin-vue) | `^5.2.1` | 5.2.4 | MIT | Vue single-file component support |
| [`@types/markdown-it`](https://www.npmjs.com/package/@types/markdown-it) | `^14.1.2` | 14.2.0 | MIT | Type declarations for `markdown-it` |
| [`eslint`](https://eslint.org/) | `^9.17.0` | 9.39.5 | MIT | Static analysis (flat config) |
| [`eslint-plugin-vue`](https://github.com/vuejs/eslint-plugin-vue) | `^9.32.0` | 9.33.0 | MIT | Vue rules |
| [`typescript`](https://www.typescriptlang.org/) | `~5.7.2` | 5.7.3 | Apache-2.0 | Type checking |
| [`typescript-eslint`](https://typescript-eslint.io/) | `^8.18.1` | 8.70.1 | MIT | TypeScript ESLint (flat config) |
| [`vite`](https://vite.dev/) | `^6.0.7` | 6.4.3 | MIT | Frontend build and dev server |
| [`vitest`](https://vitest.dev/) | `^4.0.0` | 4.1.11 | MIT | Frontend unit tests |
| [`vue-eslint-parser`](https://github.com/vuejs/vue-eslint-parser) | `^9.4.3` | 9.4.3 | MIT | Vue template parsing |
| [`vue-tsc`](https://github.com/vuejs/language-tools) | `^2.2.0` | 2.2.12 | MIT | `.vue` type checking |

> The desktop side has **266** indirect locked entries, distributed (all with a `license` field) as:
> MIT 209 · Apache-2.0 17 · `Apache-2.0 OR MIT` 13 · BSD-2-Clause 11 · ISC 10 · BSD-3-Clause 2 ·
> `MIT OR Apache-2.0` / `BlueOak-1.0.0` / `Python-2.0` / `(MIT OR CC0-1.0)` 1 each.

## 8. Desktop log viewer Rust (Tauri) direct dependencies

| Crate | Declared range | Current lock | License | Purpose |
|---|---|---|---|---|
| [`tauri`](https://github.com/tauri-apps/tauri) | `2` | 2.12.0 | Apache-2.0 OR MIT | Desktop framework (with the `tray-icon` feature) |
| [`tauri-build`](https://github.com/tauri-apps/tauri) | `2` | 2.7.0 | Apache-2.0 OR MIT | Build script (`build-dependencies`) |
| [`tauri-plugin-dialog`](https://github.com/tauri-apps/plugins-workspace) | `2` | 2.8.0 | Apache-2.0 OR MIT | Native dialogs |
| [`tauri-plugin-opener`](https://github.com/tauri-apps/plugins-workspace) | `2` | 2.6.0 | Apache-2.0 OR MIT | Opening external URLs (pairs with the frontend plugin) |
| [`tauri-plugin-updater`](https://github.com/tauri-apps/plugins-workspace) | `2` | 2.13.0 | Apache-2.0 OR MIT | Auto-update (**minisign-verified**) |
| [`serde`](https://github.com/serde-rs/serde) | `1` | 1.0.229 | MIT OR Apache-2.0 | Serialization |
| [`serde_json`](https://github.com/serde-rs/json) | `1` | 1.0.151 | MIT OR Apache-2.0 | JSON read/write |
| [`notify`](https://github.com/notify-rs/notify) | `7` | 7.0.0 | CC0-1.0 | Log file watching (incremental tail refresh) |
| [`zip`](https://github.com/zip-rs/zip2) | `2` | 2.4.2 | MIT | Whole-task export |
| [`ureq`](https://github.com/algesten/ureq) | `2` | 2.12.1 | MIT OR Apache-2.0 | Probing update manifests (no async runtime) |
| [`url`](https://github.com/servo/rust-url) | `2` | 2.5.8 | MIT OR Apache-2.0 | URL parsing |
| [`dirs`](https://github.com/dirs-dev/dirs-rs) | `6` | 6.0.0 | MIT OR Apache-2.0 | System directory resolution |

## 9. Desktop log viewer Rust indirect dependencies

`mcp-gui/src-tauri/Cargo.lock` contains **534** crates (including the direct dependencies in section 8).
Counting from each crate's locally unpacked sources, the **324** crates whose licenses are resolvable on this machine are distributed as follows
(the other 210 are **platform-specific crates that were never downloaded**, such as Linux `atk` / `cairo-rs`
or the macOS `objc2` family, and must be recomputed on a machine with the Rust toolchain and network access):

| License | Crates |
|---|---|
| MIT OR Apache-2.0 | 163 |
| MIT | 63 |
| Apache-2.0 OR MIT | 31 |
| Unicode-3.0 | 18 |
| Unlicense OR MIT | 8 |
| MPL-2.0 | 5 |
| BSD-3-Clause | 4 |
| Apache-2.0 | 3 |
| Zlib / Apache-2.0 OR ISC OR MIT / MIT OR Zlib OR Apache-2.0 / ISC / Unlicense/MIT / CDLA-Permissive-2.0 | 2 each |
| Remaining combined and near-equivalent forms (`0BSD OR MIT OR Apache-2.0`, `CC0-1.0`, `Apache-2.0 AND MIT`, …) | 1 each |

> Two things to keep in mind:
> 1. `MPL-2.0` (5 crates) is a **file-level weak copyleft** — it affects only those crates' own files and does not change the license of this project's source;
> 2. `Unicode-3.0` (18 crates) is permissive and common among Unicode data crates.
> For a complete Rust-side license audit, run `cargo deny check licenses` on a machine with the toolchain (see the next section).

## 10. Reproducing a full SBOM

```bash
# Main package: dependency tree and licenses
npm ls --all
npm sbom --sbom-format spdx      # produces an SPDX document (including indirect dependencies)

# Desktop log viewer: frontend dependency tree
cd mcp-gui && npm ls --all

# Desktop log viewer: Rust dependency graph (requires the Rust toolchain; this project never builds Rust locally)
cargo metadata --manifest-path mcp-gui/src-tauri/Cargo.toml --format-version 1
cargo deny check licenses --manifest-path mcp-gui/src-tauri/Cargo.toml
```

> When verifying this file, work in the direction "lock file → this file": run the commands above first, then check for anything missing here.
> The authoritative direct-dependency lists are `package.json`, `mcp-gui/package.json` and `mcp-gui/src-tauri/Cargo.toml`.

## 11. Licensing and compliance notes

- This project itself is released under the **Apache License 2.0**; the full text is in [LICENSE](LICENSE).
- The overwhelming majority of the dependencies above are **permissive** (0BSD / CC0-1.0 / ISC / MIT / BSD / Apache-2.0 / Unlicense / Zlib / BlueOak) and compatible with Apache-2.0.
- Two kinds of **weak copyleft** components are present, both used **unmodified**, and neither changes the license of this project's source:
  - the **optional** `sharp` platform binaries (LGPL-3.0-or-later, section 3) — absent unless `sharp` is installed;
  - **MPL-2.0** crates among the Rust indirect dependencies (section 9).
- When **redistributing** (including bundling this MCP into your own distribution), keep this project's `LICENSE` and preserve each dependency's own license and copyright notices;
  if you need to ship full third-party license texts, export them with the commands in section 10 and distribute them alongside.
- This file is an **engineering dependency inventory**, not legal advice; for compliance decisions, defer to the original license texts of each dependency.

---

> Chinese version: [DEPENDENCIES.md](DEPENDENCIES.md). For version changes see [CHANGELOG.en.md](CHANGELOG.en.md).