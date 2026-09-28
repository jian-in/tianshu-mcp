/**
 * 合成 GUI（日志台）发行版正文（GitHub / Gitee 共用）。
 *
 * **刻意不带 shebang**（`#!/usr/bin/env node`）：本文件要被 vitest 直接 import
 * （`test/unit/gui-release-body.test.ts`），而 vite 的 SSR transform 会把 shebang
 * 当作非法 token 抛 `SyntaxError: Invalid or unexpected token`。
 * 调用一律走 `node scripts/gui-release-body.mjs …`（gui.yml 亦如此），不依赖 shebang。
 *
 * 与 MCP 主包的 `scripts/release-body.mjs` **分开实现**，但复用它的
 * `absolutizeDocLinks()`——两处差别只有两点：
 *   1) 文档位置：`docs/release-gui-v<版本>.md` + `.en.md`（主包是 `release-v<版本>.md`）；
 *   2) 页脚：GUI **不发 npm**，因此不输出 npm registry 行，只给安装包页链接。
 *
 * 缺文档时**明确报错并退出**（不生成空壳正文，避免发行页只剩一句 Full Changelog）。
 *
 * 用法（CLI）：
 *   node scripts/gui-release-body.mjs <version> <github|gitee> [ownerRepo]
 *   例：node scripts/gui-release-body.mjs 0.1.0 github lanlan0811/tianshu-mcp
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { absolutizeDocLinks, repoRoot } from "./release-body.mjs";

/**
 * 读取某个语言的 GUI 发布说明；缺失返回 null。
 * @param {string} version
 * @param {"zh"|"en"} lang
 * @param {string} [root] 文档根目录（测试可注入）
 */
export function readGuiReleaseDoc(version, lang, root = repoRoot) {
  const suffix = lang === "en" ? ".en.md" : ".md";
  const p = path.join(root, "docs", `release-gui-v${version}${suffix}`);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : null;
}

/**
 * @typedef {Object} GuiComposeOptions
 * @property {string} version          版本号（`0.1.0` / `v0.1.0` / `gui-v0.1.0` 都接受）
 * @property {"github"|"gitee"} host
 * @property {string} ownerRepo        形如 lanlan0811/tianshu-mcp
 * @property {string} [root]           文档根目录（默认仓库根）
 */

/**
 * 合成中英双语发行版正文（中文在前、英文在后，中间用分节线隔开）。
 * @param {GuiComposeOptions} opts
 */
export function composeGuiReleaseBody(opts) {
  const version = String(opts.version).replace(/^gui-v/, "").replace(/^v/, "");
  const tag = `gui-v${version}`;
  const { host, ownerRepo, root = repoRoot } = opts;

  const zh = readGuiReleaseDoc(version, "zh", root);
  const en = readGuiReleaseDoc(version, "en", root);
  if (!zh && !en) {
    throw new Error(
      `未找到发布说明文档 docs/release-gui-v${version}.md / .en.md；请先写好发布说明再发布。`,
    );
  }

  /** @type {string[]} */
  const parts = [];
  if (zh) parts.push(absolutizeDocLinks(zh, { host, ownerRepo, tag }));
  if (en) {
    parts.push("---");
    parts.push(absolutizeDocLinks(en, { host, ownerRepo, tag }));
  }

  const domain = host === "gitee" ? "gitee.com" : "github.com";
  parts.push(
    ["---", "", `**安装包 / Installers**: https://${domain}/${ownerRepo}/releases/tag/${tag}`].join(
      "\n",
    ),
  );

  return parts.join("\n\n").trimEnd() + "\n";
}

// 供测试与排障使用
export const GUI_RELEASE_BODY_PATH = fileURLToPath(import.meta.url);

// CLI 入口（跨平台判断：比较解析后的文件路径）
const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  const [, , version, host, ownerRepo] = process.argv;
  if (!version || !host) {
    console.error("用法: node scripts/gui-release-body.mjs <version> <github|gitee> [ownerRepo]");
    process.exit(2);
  }
  if (host !== "github" && host !== "gitee") {
    console.error("host 必须是 github 或 gitee");
    process.exit(2);
  }
  const repo =
    ownerRepo || (host === "github" ? "lanlan0811/tianshu-mcp" : "Lan0811/tianshu-mcp");
  try {
    process.stdout.write(composeGuiReleaseBody({ version, host, ownerRepo: repo }));
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
}
