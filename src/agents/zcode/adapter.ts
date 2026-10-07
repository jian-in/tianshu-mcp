import path from "node:path";
import type {
  AgentAdapter,
  AgentRunOptions,
  AgentRunResult,
  ResolvedAgent,
  ResumePlanResult,
  SpawnInvocation,
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

export class ZcodeGuiAdapter implements AgentAdapter {
  constructor(readonly id: string) {}

  buildInvocation(): SpawnInvocation {
    throw new Error("zcode-gui 不通过 spawn 执行");
  }

  parseExit(res: SpawnResult): AgentRunResult {
    return { ...res, hardFailure: Boolean(res.error && res.exitCode === null) };
  }

  /** ZCode 恢复语义：提问必须回答到原会话，缺会话锚点直接拒绝（绝不退化打开最近会话）。 */
  planResume(meta: TaskMeta, message: string): ResumePlanResult {
    if (
      meta.needsUserKind === "agent_question" &&
      !meta.zcodeSessionId &&
      !meta.zcodeSessionTitle
    ) {
      return { ok: false, reason: "原 ZCode 会话定位信息丢失，拒绝打开最近会话" };
    }
    return {
      ok: true,
      plan: {
        continueMessage: message.trim(),
        continueSendMessage: meta.needsUserKind === "agent_question",
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
      sessionId: meta.zcodeSessionId,
      sessionTitle: meta.zcodeSessionTitle,
      boundProjectPath: meta.boundProjectPath,
      provider: meta.modelProvider,
      model: meta.model,
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
    // The chain retains the previous holder even if this waiter is cancelled, so later tasks cannot overlap it.
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
      const { runZcodeTask } = await import("./run.js");
      return await runZcodeTask({
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
