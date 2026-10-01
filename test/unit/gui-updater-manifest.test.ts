import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `build-updater-manifest.mjs merge` 的 `notes` 取数回归（GUI 更新窗口正文）。
 *
 * 背景（真机缺陷）：发布链原先只传 `--notes "Tianshu-mcp 日志台 $VER"`（纯标题），
 * 而 GUI 更新窗口渲染的正文来自更新清单的 `notes`（`updater.rs` 的 `update.body`），
 * 于是窗口里只显示一行标题——完整发行说明虽然已合成（Release 用的那份）却没进清单。
 */
const SCRIPT = path.resolve(
  fileURLToPath(new URL("../../mcp-gui/scripts/build-updater-manifest.mjs", import.meta.url)),
);

const tempRoots: string[] = [];

function makeTemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "updater-manifest-"));
  tempRoots.push(dir);
  return dir;
}

/** 造一个最小可合并的平台片段目录 */
function makeFragments(dir: string): string {
  const fragments = path.join(dir, "fragments");
  fs.mkdirSync(fragments, { recursive: true });
  fs.writeFileSync(
    path.join(fragments, "fragment-windows-x86_64.json"),
    JSON.stringify(
      {
        platform: "windows-x86_64",
        filename: "App_1.0.0_x64-setup.exe",
        signature: "sig",
        url: "https://example.test/App_1.0.0_x64-setup.exe",
      },
      null,
      2,
    ),
    "utf8",
  );
  return fragments;
}

/** 跑一次 merge，返回解析后的清单；非 0 退出时抛错（调用方用 expect(...).toThrow 捕获） */
function runMerge(args: string[], cwd: string) {
  const out = path.join(cwd, "latest.json");
  execFileSync(process.execPath, [SCRIPT, "merge", ...args, "--out", out], {
    cwd,
    stdio: "pipe",
  });
  return JSON.parse(fs.readFileSync(out, "utf8")) as { version: string; notes: string };
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("更新清单 notes（GUI 更新窗口正文）", () => {
  it("--notes-file 提供正文时，notes 取该文件全文（而不是标题）", () => {
    const dir = makeTemp();
    const fragments = makeFragments(dir);
    const body = "# 日志台 9.9.9 — 洞察\n\n## 本次新增\n\n- 效能看板\n- 失败归因\n";
    const bodyFile = path.join(dir, "gui-body.md");
    fs.writeFileSync(bodyFile, body, "utf8");

    const manifest = runMerge(
      [
        "--fragments",
        fragments,
        "--version",
        "9.9.9",
        "--notes",
        "Tianshu-mcp 日志台 9.9.9",
        "--notes-file",
        bodyFile,
      ],
      dir,
    );

    // 正文必须进清单，且保留多行结构（更新窗口按 Markdown 渲染）
    expect(manifest.notes).toContain("## 本次新增");
    expect(manifest.notes).toContain("- 效能看板");
    expect(manifest.notes.trim()).toBe(body.trim());
    expect(manifest.version).toBe("9.9.9");
  });

  it("不给 --notes-file 时回退 --notes（保持既有行为）", () => {
    const dir = makeTemp();
    const fragments = makeFragments(dir);
    const manifest = runMerge(
      ["--fragments", fragments, "--version", "9.9.9", "--notes", "只有标题"],
      dir,
    );
    expect(manifest.notes).toBe("只有标题");
  });

  it("两者都不给时 notes 为空串（不编造内容）", () => {
    const dir = makeTemp();
    const fragments = makeFragments(dir);
    const manifest = runMerge(["--fragments", fragments, "--version", "9.9.9"], dir);
    expect(manifest.notes).toBe("");
  });

  it("--notes-file 指向不存在的文件时 fail-closed（不静默退化成空正文）", () => {
    const dir = makeTemp();
    const fragments = makeFragments(dir);
    expect(() =>
      runMerge(
        [
          "--fragments",
          fragments,
          "--version",
          "9.9.9",
          "--notes-file",
          path.join(dir, "missing.md"),
        ],
        dir,
      ),
    ).toThrow();
  });

  it("--notes-file 为空文件时回退 --notes（并打 warning），不产出空正文", () => {
    const dir = makeTemp();
    const fragments = makeFragments(dir);
    const emptyFile = path.join(dir, "empty.md");
    fs.writeFileSync(emptyFile, "   \n", "utf8");

    const manifest = runMerge(
      [
        "--fragments",
        fragments,
        "--version",
        "9.9.9",
        "--notes",
        "回退标题",
        "--notes-file",
        emptyFile,
      ],
      dir,
    );
    expect(manifest.notes).toBe("回退标题");
  });
});
