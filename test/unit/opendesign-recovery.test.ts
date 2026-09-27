/**
 * 按步预算（`recovery.ts`）测试——对应计划 §6 单测清单里的「recovery：预算按步切分、耗尽转 needs_user」。
 *
 * 这些断言固化三条纪律：
 * 1. `remaining(cap)` 取「本步 cap / 任务总时限 / setup 预算」的**最小值**（重试不重置预算）；
 * 2. setup 阶段耗尽 → `setup_recovery`；绑定完成后只剩任务总时限（setup 预算不再生效）；
 * 3. 取消（abort）与任务超时各有独立分类，绝不混为一种。
 */
import { describe, expect, it } from "vitest";
import {
  OpenDesignBudget,
  OpenDesignBudgetError,
  OpenDesignSetupPause,
  openDesignBudgetFor,
  permissionError,
  transientSetupError,
} from "../../src/agents/opendesign/recovery.js";
import type { AgentRunLogger, AgentRunOptions } from "../../src/agents/adapter.js";
import type { GuiProfile } from "../../src/config/schema.js";

const silentLogger: AgentRunLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function opts(over: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return { logger: silentLogger, ...over };
}

/** 造一个只含本测试关心字段的 GuiProfile */
function guiOf(setupRecoveryTimeoutMs: number, progressIntervalMs = 10_000): GuiProfile {
  return { setupRecoveryTimeoutMs, progressIntervalMs } as unknown as GuiProfile;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("OpenDesignBudget：预算按步切分", () => {
  it("remaining 取「cap / 任务总时限 / setup 预算」的最小值", () => {
    const now = Date.now();
    const budget = new OpenDesignBudget(now + 10_000, now + 1_000, opts(), 10_000);
    // cap 最小 → 用 cap
    expect(budget.remaining(200)).toBeLessThanOrEqual(200);
    // cap 很大 → 受 setup 预算夹住
    expect(budget.remaining(60_000)).toBeLessThanOrEqual(1_000);
    budget.close();
  });

  it("绑定完成后 setup 预算不再生效，只剩任务总时限", () => {
    const now = Date.now();
    const budget = new OpenDesignBudget(now + 10_000, now + 50, opts(), 10_000);
    budget.finishSetup();
    expect(budget.settingUp).toBe(false);
    // setup 预算已过，但绑定完成后不应再抛 setup_recovery
    expect(() => budget.check()).not.toThrow();
    expect(budget.remaining(60_000)).toBeGreaterThan(1_000);
    budget.close();
  });

  it("setup 预算耗尽 → setup_recovery（不是 operation_timeout）", () => {
    const now = Date.now();
    const budget = new OpenDesignBudget(now + 10_000, now - 1, opts(), 10_000);
    expect(() => budget.check()).toThrow(OpenDesignBudgetError);
    try {
      budget.check();
    } catch (e) {
      expect((e as OpenDesignBudgetError).reason).toBe("setup_recovery");
      expect((e as OpenDesignBudgetError).stage).toBeTruthy();
    }
    budget.close();
  });

  it("任务总时限到点 → task_timeout（优先于 setup_recovery）", () => {
    const now = Date.now();
    const budget = new OpenDesignBudget(now - 1, now - 1, opts(), 10_000);
    try {
      budget.check();
      throw new Error("应当抛错");
    } catch (e) {
      expect((e as OpenDesignBudgetError).reason).toBe("task_timeout");
    }
    budget.close();
  });

  it("已 abort → aborted（取消与超时分类不混）", () => {
    const controller = new AbortController();
    controller.abort();
    const now = Date.now();
    const budget = new OpenDesignBudget(now + 10_000, now + 10_000, opts({ signal: controller.signal }), 10_000);
    try {
      budget.check();
      throw new Error("应当抛错");
    } catch (e) {
      expect((e as OpenDesignBudgetError).reason).toBe("aborted");
    }
    budget.close();
  });

  it("run() 在 cap 内完成时正常返回，超时则抛 operation_timeout", async () => {
    const now = Date.now();
    const budget = new OpenDesignBudget(now + 10_000, now + 10_000, opts(), 10_000);
    const fast = await budget.run(async () => "ok", 200);
    expect(fast).toBe("ok");
    await expect(budget.run(() => sleep(500).then(() => "late"), 50)).rejects.toMatchObject({
      reason: "operation_timeout",
    });
    budget.close();
  });

  it("run() 里 abort 立即中断（不等到 cap 到点）", async () => {
    const controller = new AbortController();
    const now = Date.now();
    const budget = new OpenDesignBudget(
      now + 10_000,
      now + 10_000,
      opts({ signal: controller.signal }),
      10_000,
    );
    const pending = budget.run(() => sleep(5_000).then(() => "late"), 5_000);
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ reason: "aborted" });
    budget.close();
  });

  it("setStage 会把阶段写进错误对象（终态文案可定位在哪一步耗尽）", () => {
    const now = Date.now();
    const budget = new OpenDesignBudget(now - 1, now + 10_000, opts(), 10_000);
    budget.setStage("绑定工作目录");
    try {
      budget.check();
      throw new Error("应当抛错");
    } catch (e) {
      expect((e as OpenDesignBudgetError).stage).toBe("绑定工作目录");
    }
    budget.close();
  });

  it("openDesignBudgetFor 从 gui.setupRecoveryTimeoutMs 取 setup 预算", () => {
    const budget = openDesignBudgetFor(guiOf(120), Date.now() + 10_000, opts());
    expect(budget.settingUp).toBe(true);
    expect(budget.remaining(60_000)).toBeLessThanOrEqual(120);
    budget.close();
  });

  it("close() 后仍可 check（心跳已停，判定语义不变）", () => {
    const now = Date.now();
    const budget = new OpenDesignBudget(now + 10_000, now + 10_000, opts(), 20);
    budget.close();
    expect(() => budget.check()).not.toThrow();
  });
});

describe("错误分类：临时 setup 错误 / 权限错误", () => {
  it("预算类的 setup_recovery 与 operation_timeout 视为「可重试的临时错误」", () => {
    expect(transientSetupError(new OpenDesignBudgetError("setup_recovery", "接管实例"))).toBe(true);
    expect(transientSetupError(new OpenDesignBudgetError("operation_timeout", "连接主窗口"))).toBe(true);
    // 任务超时/取消不是「重试就能好」的
    expect(transientSetupError(new OpenDesignBudgetError("task_timeout", "等待完成"))).toBe(false);
    expect(transientSetupError(new OpenDesignBudgetError("aborted", "等待完成"))).toBe(false);
  });

  it("进程被杀 / 连接类错误码 / 超时文案都按临时错误处理", () => {
    expect(transientSetupError({ killed: true })).toBe(true);
    expect(transientSetupError({ code: "ECONNRESET" })).toBe(true);
    expect(transientSetupError(new Error("CDP 未连接或已关闭"))).toBe(true);
    expect(transientSetupError(new Error("WebSocket 已关闭"))).toBe(true);
    expect(transientSetupError(new Error("选择器漂移"))).toBe(false);
  });

  it("SetupPause 携带 needsPermission 供上层分型", () => {
    expect(new OpenDesignSetupPause("需要授权", true).needsPermission).toBe(true);
    expect(new OpenDesignSetupPause("普通暂停").needsPermission).toBe(false);
  });

  it("permissionError 只认权限类文案/错误码", () => {
    expect(permissionError(new Error("ACCESSIBILITY_PERMISSION_REQUIRED"))).toBe(true);
    expect(permissionError(new Error("(-1743)"))).toBe(true);
    expect(permissionError(new Error("原生对话框未出现"))).toBe(false);
    expect(permissionError(undefined)).toBe(false);
  });
});