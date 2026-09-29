/**
 * exec.ts / runner.ts 预存缺陷修复的回归测试：
 * - execFileAsync 超时检测（当前 Node err.killed 语义，ETIMEDOUT 已不可达）
 * - runVerifyCommand 日志文件创建失败时降级运行（不再 unhandled rejection + 永不 resolve）
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileAsync } from "../../src/verify/exec.js";
import { runVerifyCommand } from "../../src/verify/runner.js";
import { makeTmpRoot, rmrf } from "../test-utils.js";

describe("execFileAsync 超时检测（当前 Node err.killed 语义）", () => {
  it("超时被杀 → timedOut:true（不再漏判为普通失败）", async () => {
    const res = await execFileAsync(
      process.execPath,
      ["-e", "setTimeout(() => {}, 10_000)"],
      { timeoutMs: 300 },
    );
    expect(res.timedOut).toBe(true);
    expect(res.status).toBeNull();
    expect(res.error).toBe("timeout");
  }, 10_000);

  it("正常退出 → timedOut:false 且 status 为退出码", async () => {
    const ok = await execFileAsync(process.execPath, ["-e", "process.exit(0)"], { timeoutMs: 5_000 });
    expect(ok.timedOut).toBe(false);
    expect(ok.status).toBe(0);
    const fail = await execFileAsync(process.execPath, ["-e", "process.exit(3)"], { timeoutMs: 5_000 });
    expect(fail.timedOut).toBe(false);
    expect(fail.status).toBe(3);
  });
});

describe("runVerifyCommand 日志文件不可用降级", () => {
  it("mkdirp 失败（ENOTDIR）→ 不挂死、不 unhandled rejection，check 照常判定", async () => {
    const root = await makeTmpRoot("runner-log-fail");
    // 用一个已存在的文件当父路径：mkdirp 必然 ENOTDIR，确定性跨平台
    const blocker = path.join(root, "blocker");
    fs.writeFileSync(blocker, "x");
    const logFile = path.join(blocker, "sub", "check.log");

    const errors: unknown[] = [];
    const onUnhandled = (e: unknown) => errors.push(e);
    process.once("unhandledRejection", onUnhandled);
    try {
      const res = await runVerifyCommand(
        "noop",
        [process.execPath, "-e", "process.exit(0)"],
        { cwd: root, logFile, timeoutMs: 5_000 },
      );
      expect(res.passed).toBe(true); // 命令本身成功——日志缺失不拖垮判定
      expect(res.reason).toBeUndefined();
    } finally {
      // 给潜在 unhandled rejection 一个宏任务窗口浮现
      await new Promise((r) => setTimeout(r, 50));
      process.removeListener("unhandledRejection", onUnhandled);
    }
    expect(errors).toEqual([]);
    await rmrf(root);
  }, 15_000);

  it("日志目录可创建时：日志含 header 与 [exit] 尾行", async () => {
    const root = await makeTmpRoot("runner-log-ok");
    const logFile = path.join(root, "logs", "check.log");
    const res = await runVerifyCommand(
      "noop",
      [process.execPath, "-e", "process.exit(0)"],
      { cwd: root, logFile, timeoutMs: 5_000 },
    );
    expect(res.passed).toBe(true);
    const content = fs.readFileSync(logFile, "utf8");
    expect(content).toContain("=== check: noop");
    expect(content).toContain("[exit] code=0");
    await rmrf(root);
  }, 15_000);
});

describe("runVerifyCommand 的 cwd 归一（Windows 盘符大小写）", () => {
  it("以小写盘符路径作 cwd：子进程拿到磁盘真实大小写，不原样透传", async () => {
    if (process.platform !== "win32") return; // 只有 Windows 有盘符大小写语义
    const root = await makeTmpRoot("runner-cwd-case");
    const head = root.charAt(0);
    const lower = head.toLowerCase() + root.slice(1);
    // 前置条件：临时目录盘符本为大写，该用例才有区分度（否则退回小写等于没变）
    expect(head).toBe(head.toUpperCase());
    expect(lower).not.toBe(root);
    try {
      const logFile = path.join(root, "c.log");
      const res = await runVerifyCommand(
        "pwd",
        [process.execPath, "-e", "process.stdout.write(process.cwd())"],
        { cwd: lower, logFile, timeoutMs: 5_000 },
      );
      expect(res.passed).toBe(true);
      const printed = fs.readFileSync(logFile, "utf8");
      // 探针实测：父进程给 "c:\\..."，子进程 process.cwd() 会原样返回小写——
      // 所以修复后必须看到磁盘真实大小写，而不是 lower。
      expect(printed).toContain(root);
      expect(printed).not.toContain(lower);
    } finally {
      await rmrf(root);
    }
  }, 15_000);
});
