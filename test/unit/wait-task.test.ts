/**
 * 等待原语核心单测（issue #28 / 计划 §2.4 C1）。
 * 只测 `src/tasks/wait.ts` 的纯逻辑：依赖注入 getMeta，不触碰文件系统 / TaskManager。
 * RED 形态：`src/tasks/wait.ts` 不存在 → 模块导入失败。
 */
import { describe, it, expect } from "vitest";
import { waitForStops } from "../../src/tasks/wait.js";
import { isWaitSettled, type TaskMeta, type TaskStatus } from "../../src/tasks/task.js";
import {
  clampWaitTimeout,
  WAIT_TASK_TIMEOUT_DEFAULT_MS,
  WAIT_TASK_TIMEOUT_MAX_MS,
} from "../../src/config/schema.js";

/** 最小可用 TaskMeta（仅填必填字段）——等待核心只读 `status`。 */
function makeMeta(status: TaskStatus, taskId = "tsk_test"): TaskMeta {
  const now = new Date().toISOString();
  return {
    taskId,
    status,
    projectPath: "D:/proj",
    displayPath: "D:/proj",
    agentId: "stub",
    task: "测试任务",
    autoVerify: false,
    autoFixRounds: 0,
    taskTimeoutMs: 60_000,
    round: 0,
    roundsUsed: 0,
    createdAt: now,
    updatedAt: now,
  };
}

describe("waitForStops 停点判定", () => {
  it("U1 已终态（succeeded）立即返回，不等待", async () => {
    let calls = 0;
    const res = await waitForStops(
      ["tsk_test"],
      async () => {
        calls++;
        return makeMeta("succeeded");
      },
      { timeoutMs: 5_000, pollIntervalMs: 10 },
    );
    expect(calls).toBe(1); // 首次轮询即命中，不再 sleep
    expect(res.timedOut).toBe(false);
    expect(res.aborted).toBe(false);
    expect(res.missing).toEqual([]);
    expect(res.stopped).toHaveLength(1);
    expect(res.stopped[0]!.index).toBe(0);
    expect(res.stopped[0]!.meta.status).toBe("succeeded");
  });

  it("U2 needs_user 是停点（非终态也必须唤醒调用方）", async () => {
    expect(isWaitSettled("needs_user")).toBe(true);
    expect(isWaitSettled("running")).toBe(false);
    expect(isWaitSettled("queued")).toBe(false);
    const res = await waitForStops(["tsk_test"], async () => makeMeta("needs_user"), {
      timeoutMs: 5_000,
      pollIntervalMs: 10,
    });
    expect(res.stopped).toHaveLength(1);
    expect(res.stopped[0]!.meta.status).toBe("needs_user");
  });

  it("U3 running → succeeded：等到真实状态跃迁后返回", async () => {
    let calls = 0;
    const getMeta = async () => makeMeta(calls++ < 2 ? "running" : "succeeded");
    const res = await waitForStops(["tsk_test"], getMeta, {
      timeoutMs: 5_000,
      pollIntervalMs: 10,
    });
    expect(res.timedOut).toBe(false);
    expect(res.stopped[0]!.meta.status).toBe("succeeded");
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("U4 始终 running → 超时返回 timedOut=true + waitedMs", async () => {
    const res = await waitForStops(["tsk_test"], async () => makeMeta("running"), {
      timeoutMs: 80,
      pollIntervalMs: 10,
    });
    expect(res.timedOut).toBe(true);
    expect(res.stopped).toEqual([]);
    expect(res.aborted).toBe(false);
    expect(res.waitedMs).toBeGreaterThanOrEqual(60);
  });

  it("U5 signal abort：立即退出、不抛异常、不等满超时", async () => {
    const ac = new AbortController();
    const started = Date.now();
    const p = waitForStops(["tsk_test"], async () => makeMeta("running"), {
      timeoutMs: 10_000,
      pollIntervalMs: 10,
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 30);
    const res = await p;
    expect(res.aborted).toBe(true);
    expect(res.stopped).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("U6 缺失任务上报 missing（防御；正常由入口预检拦截）", async () => {
    const res = await waitForStops(["tsk_none"], async () => null, {
      timeoutMs: 5_000,
      pollIntervalMs: 10,
    });
    expect(res.missing).toEqual(["tsk_none"]);
    expect(res.stopped).toEqual([]);
    expect(res.timedOut).toBe(false);
  });

  it("U7 多任务：按数组下标报告已停任务，未停的不进结果", async () => {
    const statuses: Record<string, TaskStatus> = {
      tsk_a: "running",
      tsk_b: "failed",
      tsk_c: "needs_user",
    };
    const res = await waitForStops(
      ["tsk_a", "tsk_b", "tsk_c"],
      async (id) => makeMeta(statuses[id]!, id),
      { timeoutMs: 5_000, pollIntervalMs: 10 },
    );
    expect(res.stopped.map((s) => s.index)).toEqual([1, 2]);
    expect(res.stopped.map((s) => s.meta.taskId)).toEqual(["tsk_b", "tsk_c"]);
  });
});

describe("clampWaitTimeout 上限钳制（如实披露）", () => {
  it("U7 缺省 / 正常 / 界内 / 超上限", () => {
    expect(clampWaitTimeout(undefined)).toEqual({
      timeoutMs: WAIT_TASK_TIMEOUT_DEFAULT_MS,
      clamped: false,
    });
    expect(clampWaitTimeout(1_000)).toEqual({ timeoutMs: 1_000, clamped: false });
    expect(clampWaitTimeout(WAIT_TASK_TIMEOUT_MAX_MS)).toEqual({
      timeoutMs: WAIT_TASK_TIMEOUT_MAX_MS,
      clamped: false,
    });
    expect(clampWaitTimeout(WAIT_TASK_TIMEOUT_MAX_MS + 1)).toEqual({
      timeoutMs: WAIT_TASK_TIMEOUT_MAX_MS,
      clamped: true,
    });
  });
});
