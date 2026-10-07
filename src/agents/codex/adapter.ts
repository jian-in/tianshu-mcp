/**
 * CodexGuiAdapter：GUI 执行面接入点（对齐 ZcodeGuiAdapter 的串行门语义）。
 * driver="gui" + adapter="codex-gui" 的 profile 由 registry 选择本实现。
 *
 * 串行门：GUI 自动化对同一桌面会话是排他资源，前一个任务未释放前不并发第二个，
 * 但被取消的等待者不会让后续任务越过前一个持有者。
 */
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

export class CodexGuiAdapter implements AgentAdapter {
  constructor(readonly id: string) {}

  buildInvocation(): SpawnInvocation {
    throw new Error("codex-gui 不通过 spawn 执行");
  }

  parseExit(res: SpawnResult): AgentRunResult {
    return { ...res, hardFailure: Boolean(res.error && res.exitCode === null) };
  }

  /** Codex 恢复语义：仅支持 login_required / user_confirmation；恢复后不发送消息，仅重连观察或全新派发。 */
  planResume(meta: TaskMeta, message: string): ResumePlanResult {
    if (meta.needsUserKind === "user_confirmation") {
      // GUI 内 turn 暂停等待用户；恢复后不发送消息，仅重连 CDP 观察至终态
      return {
        ok: true,
        plan: {
          continueMessage: message.trim(),
          continueSendMessage: false,
          continueReobserve: true,
        },
      };
    }
    if (meta.needsUserKind === "login_required") {
      // 登录前任务尚未发送、项目尚未绑定：恢复后走全新派发并重发任务书
      return {
        ok: true,
        plan: { continueMessage: message.trim(), continueSendMessage: false },
      };
    }
    return {
      ok: false,
      reason: `codex 任务等待类型为 ${meta.needsUserKind ?? "unknown"}，仅支持 login_required / user_confirmation`,
    };
  }

  buildResumePayload(meta: TaskMeta, round: number): TaskContext["resume"] {
    const continuing = meta.continueMessage !== undefined;
    if (!continuing && round <= 0) return undefined;
    return {
      kind: continuing ? "continue" : "rework",
      message: meta.continueMessage,
      sendMessage: meta.continueSendMessage ?? round > 0,
      // user_confirmation 恢复：重连 CDP 观察至终态，不发送任何消息
      ...(meta.continueReobserve ? { reobserve: true } : {}),
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
    // 链上保留前一个持有者：即使本等待者被取消，后续任务也无法越过它。
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
      const { runCodexTask } = await import("./run.js");
      return await runCodexTask({
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
