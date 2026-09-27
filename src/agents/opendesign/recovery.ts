/**
 * Open Design 的预算与错误分类（与 `kimicode/recovery.ts` 同构，仅换命名空间）。
 *
 * 初始化阶段（接管实例 → 绑定目录 → 选模型/系统/方向 → 输入发送）用 setup 预算，
 * 发送确认之后只剩任务总时限。
 *
 * 计划 §3.4 要求「预算按步切分」：每步在调用点给出 cap，`remaining(cap)` 取
 * `cap / 任务总时限 / setup 预算` 的最小值——**重试不重置预算**，避免某一步反复重试
 * 把整体时限吃光。
 */
import type { AgentRunOptions } from "../adapter.js";
import { ZCODE_SETUP_DEFAULTS, type GuiProfile } from "../../config/schema.js";

export class OpenDesignSetupPause extends Error {
  constructor(
    message: string,
    readonly needsPermission = false,
  ) {
    super(message);
  }
}

export class OpenDesignBudgetError extends Error {
  constructor(
    readonly reason: "setup_recovery" | "operation_timeout" | "task_timeout" | "aborted",
    readonly stage: string,
  ) {
    super(`Open Design ${stage}: ${reason}`);
  }
}

/** 初始化阶段一个截止时间；绑定/发送完成后只剩任务总时限。 */
export class OpenDesignBudget {
  stage = "接管 Open Design 实例";
  private bound = false;
  private readonly started = Date.now();
  private heartbeat?: ReturnType<typeof setInterval>;
  constructor(
    readonly taskDeadline: number,
    readonly setupDeadline: number,
    private readonly opts: AgentRunOptions,
    progressIntervalMs: number,
  ) {
    this.heartbeat = setInterval(() => this.report(), progressIntervalMs);
    this.heartbeat.unref();
    this.report();
  }

  setStage(stage: string): void {
    this.stage = stage;
    this.report();
  }

  private report(): void {
    const note = `Open Design ${this.stage}；已等待 ${Date.now() - this.started}ms`;
    this.opts.logger.info(note);
    void Promise.resolve(this.opts.onProgress?.(note)).catch(() => {});
  }

  finishSetup(): void {
    this.bound = true;
    this.close();
  }

  get settingUp(): boolean {
    return !this.bound;
  }

  close(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  check(): void {
    if (this.opts.signal?.aborted) throw new OpenDesignBudgetError("aborted", this.stage);
    if (Date.now() >= this.taskDeadline) throw new OpenDesignBudgetError("task_timeout", this.stage);
    if (!this.bound && Date.now() >= this.setupDeadline)
      throw new OpenDesignBudgetError("setup_recovery", this.stage);
  }

  remaining(cap = Infinity): number {
    this.check();
    return Math.max(
      1,
      Math.min(
        cap,
        this.taskDeadline - Date.now(),
        this.bound ? Infinity : this.setupDeadline - Date.now(),
      ),
    );
  }

  async run<T>(
    operation: (signal: AbortSignal, timeoutMs: number) => Promise<T>,
    cap = Infinity,
  ): Promise<T> {
    const timeoutMs = this.remaining(cap);
    const deadline = Math.min(
      Date.now() + timeoutMs,
      this.taskDeadline,
      this.bound ? Infinity : this.setupDeadline,
    );
    const controller = new AbortController();
    let reject!: (error: Error) => void;
    const aborted = new Promise<never>((_, fail) => {
      reject = fail;
    });
    let timer: ReturnType<typeof setTimeout>;
    const stop = () => {
      if (!this.opts.signal?.aborted && Date.now() < deadline) {
        timer = setTimeout(stop, Math.max(1, deadline - Date.now()));
        return;
      }
      const reason = this.opts.signal?.aborted
        ? "aborted"
        : Date.now() >= this.taskDeadline
          ? "task_timeout"
          : !this.bound && Date.now() >= this.setupDeadline
            ? "setup_recovery"
            : "operation_timeout";
      reject(new OpenDesignBudgetError(reason, this.stage));
      // 先把「谁触发的超时/取消」定下来，再让 abort 监听里的 CDP 调用同步 reject 自己的 promise。
      controller.abort();
    };
    timer = setTimeout(stop, timeoutMs);
    this.opts.signal?.addEventListener("abort", stop, { once: true });
    try {
      const result = await Promise.race([operation(controller.signal, timeoutMs), aborted]);
      this.check();
      return result;
    } catch (error) {
      this.check();
      throw error;
    } finally {
      clearTimeout(timer);
      this.opts.signal?.removeEventListener("abort", stop);
    }
  }
}

/** 从 GUI 配置构造预算：初始化预算取自 gui.setupRecoveryTimeoutMs */
export function openDesignBudgetFor(
  gui: GuiProfile,
  taskDeadline: number,
  opts: AgentRunOptions,
): OpenDesignBudget {
  return new OpenDesignBudget(
    taskDeadline,
    Date.now() + (gui.setupRecoveryTimeoutMs ?? ZCODE_SETUP_DEFAULTS.setupRecoveryTimeoutMs),
    opts,
    gui.progressIntervalMs,
  );
}

export function transientSetupError(error: unknown): boolean {
  if (error instanceof OpenDesignBudgetError)
    return error.reason === "setup_recovery" || error.reason === "operation_timeout";
  const e = error as { code?: string; killed?: boolean; message?: string };
  return (
    e?.killed === true ||
    ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ABORT_ERR"].includes(e?.code ?? "") ||
    /超时|timeout|timed out|renderer busy|CDP 未连接|WebSocket/i.test(e?.message ?? "")
  );
}

export function permissionError(error: unknown): boolean {
  return /ACCESSIBILITY_PERMISSION_REQUIRED|not authorized|辅助功能|not allowed assistive|(-1743)|(-1719)/i.test(
    error instanceof Error ? error.message : String(error),
  );
}