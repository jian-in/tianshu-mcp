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
 * 同一台机器上 MiniMax Code 只有一个受管实例：与 Kimi Code / Qoder / Open Design 同构的
 * **全局串行门**。并行派活会两条流程同时点同一个「模型」/「项目」菜单，必然互相踩踏；
 * 而模型弹层是**独立窗口**，两条流程的 hover 二级子菜单会互相覆盖。
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

export class MinimaxGuiAdapter implements AgentAdapter {
  constructor(readonly id: string) {}

  buildInvocation(): SpawnInvocation {
    throw new Error("minimax-gui 不通过 spawn 执行");
  }

  parseExit(res: SpawnResult): AgentRunResult {
    return { ...res, hardFailure: Boolean(res.error && res.exitCode === null) };
  }

  /**
   * MiniMax 恢复语义（与 kimicode 同构）：agent_question 回答回原会话；
   * user_confirmation 重连观察；环境类复检后全新派发并补发完整任务书
   *（用户确认文本绝不发给模型）。
   */
  planResume(meta: TaskMeta, message: string): ResumePlanResult {
    if (meta.needsUserKind === "agent_question") {
      if (!meta.minimaxSessionId && !meta.minimaxSessionTitle) {
        return { ok: false, reason: "原 MiniMax Code 会话定位信息丢失，拒绝打开最近会话" };
      }
      return {
        ok: true,
        plan: { continueMessage: message.trim(), continueSendMessage: true },
      };
    }
    if (meta.needsUserKind === "user_confirmation") {
      return {
        ok: true,
        plan: {
          continueMessage: message.trim(),
          continueSendMessage: false,
          continueReobserve: true,
        },
      };
    }
    return {
      ok: true,
      plan: { continueMessage: message.trim(), continueSendMessage: false },
    };
  }

  buildResumePayload(meta: TaskMeta, round: number): TaskContext["resume"] {
    const continuing = meta.continueMessage !== undefined;
    if (!continuing && round <= 0) return undefined;
    /**
     * 恢复语义（与 kimicode 同构）：
     * - continue + sendMessage（agent_question）：定位原会话 → 回答写进输入框发送（不重发任务书）；
     * - continue + reobserve（user_confirmation）：重连观察至终态，不发送任何消息；
     * - rework：定位原会话 → 发送返修消息。
     * 定位不到原会话一律 session_lost，绝不退化打开「最近会话」。
     */
    return {
      kind: continuing ? "continue" : "rework",
      message: meta.continueMessage,
      sendMessage: meta.continueSendMessage ?? round > 0,
      ...(meta.continueReobserve ? { reobserve: true } : {}),
      sessionId: meta.minimaxSessionId,
      sessionTitle: meta.minimaxSessionTitle,
      boundProjectPath: meta.boundProjectPath,
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
      const { runMinimaxTask } = await import("./run.js");
      return await runMinimaxTask({
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
