import path from "node:path";
import type {
  AgentAdapter,
  AgentRunOptions,
  AgentRunResult,
  ResolvedAgent,
  SpawnInvocation,
  ResumePlanResult,
  TaskContext,
} from "../adapter.js";
import type { TaskMeta } from "../../tasks/task.js";
import type { SpawnResult } from "../spawn.js";

/**
 * 同一台机器上 Open Design 只有一个受管实例：与 Kimi Code / Qoder 同构的**全局串行门**。
 * 并行派活会两条流程同时点同一个「工作目录」/「模型」菜单，必然互相踩踏。
 */
let serial: Promise<void> = Promise.resolve();

async function waitForPrevious(
  previous: Promise<void>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (!signal) {
    await previous;
    return true;
  }
  if (signal.aborted) return false;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<false>((resolve) => {
    onAbort = () => resolve(false);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([previous.then(() => true as const), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export class OpenDesignGuiAdapter implements AgentAdapter {
  constructor(readonly id: string) {}

  buildInvocation(): SpawnInvocation {
    throw new Error("opendesign-gui 不通过 spawn 执行");
  }

  parseExit(res: SpawnResult): AgentRunResult {
    return { ...res, hardFailure: Boolean(res.error && res.exitCode === null) };
  }

  /**
   * Open Design 恢复语义：没有可回选的会话 id（单页应用，当前视图即当前会话）。
   * agent_question 回答发进当前会话（适配器发送前确认会话页锚点，不在即 session_lost）；
   * user_confirmation 只重连观察；环境类复检后全新派发并补发完整任务书。
   */
  planResume(meta: TaskMeta, message: string): ResumePlanResult {
    const continueSendMessage = meta.needsUserKind === "agent_question";
    return {
      ok: true,
      plan: {
        continueMessage: message.trim(),
        continueSendMessage,
        continueReobserve:
          meta.needsUserKind === "user_confirmation" ? true : undefined,
      },
    };
  }

  buildResumePayload(meta: TaskMeta, round: number): TaskContext["resume"] {
    const continuing = meta.continueMessage !== undefined;
    if (!continuing && round <= 0) return undefined;
    // Open Design 没有可回选的会话 id：恢复语义是「对当前会话续说」——
    // 发送前由适配器确认当前确实在会话页（不在即 session_lost），绝不退化到首页重新派发。
    return {
      kind: continuing ? "continue" : "rework",
      message: meta.continueMessage,
      sendMessage: meta.continueSendMessage ?? round > 0,
      ...(meta.continueReobserve ? { reobserve: true } : {}),
      boundProjectPath: meta.boundProjectPath,
      model: meta.actualModel ?? meta.model,
    };
  }

  async run(
    ctx: TaskContext,
    resolved: ResolvedAgent,
    opts: AgentRunOptions,
  ): Promise<AgentRunResult> {
    const previous = serial;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // 串行链即使本次等待方被取消，也保留前一个持有者：后续任务不可能与它重叠执行。
    serial = previous.then(() => gate);
    try {
      if (!(await waitForPrevious(previous, opts.signal))) {
        return {
          ok: false,
          exitCode: null,
          timeout: false,
          killed: true,
          durationMs: 0,
          logFile: path.join(ctx.taskDir, `agent-${ctx.round}.log`),
          endReason: "aborted",
          keptInstance: true,
        };
      }
      const { runOpenDesignTask } = await import("./run.js");
      return await runOpenDesignTask({
        ctx,
        resolved,
        opts,
        logFile: path.join(ctx.taskDir, `agent-${ctx.round}.log`),
      });
    } finally {
      release();
    }
  }
}
