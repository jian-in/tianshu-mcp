/**
 * 阻塞等待原语核心（issue #28 / 开发计划 §2.4 C1）。
 *
 * `waitForStops` 轮询一组任务，直到其中任一到达**停点**（终态 ∪ `needs_user`）或超时。
 * 设计要点：
 * - **纯逻辑、依赖注入 `getMeta`**：不依赖文件系统 / TaskManager 构造，可独立单测；
 * - **只读**：不写任何任务状态、不动任务本体——被客户端截断 / 连接中断 / 超时都无副作用；
 * - **`signal` 感知**：连接关闭或请求取消时用 SDK 给的 `extra.signal` 立即退出循环，
 *   不泄漏后台等待（SDK `_onclose` 会 abort 全部 in-flight handler）。
 */
import { isWaitSettled, type TaskMeta } from "./task.js";

/** 一次轮询读到的任务 meta；返回 null 表示任务不存在（缺失）。 */
export type GetMeta = (taskId: string) => Promise<TaskMeta | null>;

export interface WaitForStopsOptions {
  /** 本次等待上限（ms）。调用方已钳制（见 `clampWaitTimeout`）。 */
  timeoutMs: number;
  /** 轮询间隔（ms），缺省 500——任务状态变化是秒~分钟级，500ms 延迟无感。 */
  pollIntervalMs?: number;
  /** 请求取消 / 连接关闭信号；触发后立即返回 `aborted=true`。 */
  signal?: AbortSignal;
}

/** 一个已到达停点的任务（`index` 为其在输入 `taskIds` 中的下标）。 */
export interface StopHit {
  index: number;
  meta: TaskMeta;
}

export interface WaitForStopsResult {
  /** 已到达停点的任务，按输入数组下标升序（`wait_any` 取 `stopped[0]` 即「数组顺序首个已停」）。 */
  stopped: StopHit[];
  /** 是否因超时结束（此时 `stopped` 为空）。 */
  timedOut: boolean;
  /** 实际等待时长（ms）。 */
  waitedMs: number;
  /** 不存在的任务 id（防御；正常路径由入口预检拦截）。非空时 `stopped` 为空。 */
  missing: string[];
  /** 是否被 `signal` 中止（调用方中断 / 连接关闭）。 */
  aborted: boolean;
}

/** 可被 `signal` 提前唤醒的 sleep：abort 时立即 resolve（不做悬挂等待）。 */
function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 轮询 `taskIds` 直到有任务到达停点、或超时、或被 signal 中止。
 *
 * 单次轮询内**先读全部任务**再判定：`missing` 优先于 `stopped`（缺一即视为异常，交调用方处理）；
 * 否则只要有任一任务 `isWaitSettled` 即返回；再判超时；否则 sleep 到下一轮。
 */
export async function waitForStops(
  taskIds: string[],
  getMeta: GetMeta,
  opts: WaitForStopsOptions,
): Promise<WaitForStopsResult> {
  const pollIntervalMs = opts.pollIntervalMs ?? 500;
  const { signal } = opts;
  const start = Date.now();
  const deadline = start + opts.timeoutMs;
  const elapsed = (): number => Date.now() - start;

  for (;;) {
    if (signal?.aborted) {
      return { stopped: [], timedOut: false, waitedMs: elapsed(), missing: [], aborted: true };
    }

    const metas = await Promise.all(taskIds.map((id) => getMeta(id)));
    const missing: string[] = [];
    const stopped: StopHit[] = [];
    metas.forEach((meta, index) => {
      if (!meta) {
        missing.push(taskIds[index]!);
        return;
      }
      if (isWaitSettled(meta.status)) stopped.push({ index, meta });
    });

    if (missing.length > 0) {
      return { stopped: [], timedOut: false, waitedMs: elapsed(), missing, aborted: false };
    }
    if (stopped.length > 0) {
      return { stopped, timedOut: false, waitedMs: elapsed(), missing: [], aborted: false };
    }

    const now = Date.now();
    if (now >= deadline) {
      return { stopped: [], timedOut: true, waitedMs: elapsed(), missing: [], aborted: false };
    }
    await sleepWithSignal(Math.min(pollIntervalMs, deadline - now), signal);
  }
}
