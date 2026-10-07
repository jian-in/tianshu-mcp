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

export class QoderGuiAdapter implements AgentAdapter {
  constructor(readonly id: string) {}

  buildInvocation(): SpawnInvocation {
    throw new Error("qoder-gui 不通过 spawn 执行");
  }

  parseExit(res: SpawnResult): AgentRunResult {
    return { ...res, hardFailure: Boolean(res.error && res.exitCode === null) };
  }

  /** Qoder 恢复语义：提问需原会话锚点，缺锚点直接拒绝（绝不退化打开最近会话）。 */
  planResume(meta: TaskMeta, message: string): ResumePlanResult {
    if (meta.needsUserKind === "agent_question" && !meta.qoderSessionId) {
      return { ok: false, reason: "原 Qoder 会话锚点丢失，拒绝打开最近会话" };
    }
    const continueSendMessage = meta.needsUserKind === "agent_question";
    return {
      ok: true,
      plan: {
        continueMessage: message.trim(),
        continueSendMessage,
        continueReobserve: !!meta.qoderSessionId && !continueSendMessage,
      },
    };
  }

  buildResumePayload(meta: TaskMeta, round: number): TaskContext["resume"] {
    const continuing = meta.continueMessage !== undefined;
    if (!continuing && round <= 0) return undefined;
    return {
      kind: continuing ? "continue" : "rework",
      message: meta.continueMessage,
      sendMessage: meta.continueSendMessage ?? round > 0,
      reobserve: meta.continueReobserve,
      sessionId: meta.qoderSessionId,
      boundProjectPath: meta.boundProjectPath,
      model: meta.actualModel ?? meta.model,
      permissionMode: meta.permissionMode,
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
      const { runQoderTask } = await import("./run.js");
      return await runQoderTask({
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
