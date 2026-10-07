/**
 * context：从工具参数构造命令上下文 + 项目登记。
 * buildCtx：meta → agent 任务上下文（taskDir / 工作目录 / 超时 / 轮次）。
 */
import type { TaskContext, AgentAdapter } from "../agents/adapter.js";
import type { AgentAdapterRegistry } from "../agents/registry.js";
import type { TaskMeta } from "../tasks/task.js";
import type { TaskStore } from "../tasks/task-store.js";
import type { DataHome } from "../config/store.js";

export interface AppServices {
  store: TaskStore;
  dataHome: DataHome;
  registry: AgentAdapterRegistry;
}

/**
 * dryRun 的只读预演约束（issue #21）。
 *
 * 注入点刻意选在这里而不是各个适配器的 prompt builder：全部 5 个适配器的提示词构造
 * 都会拼 `ctx.context`（codex `input.ts`、traework `ui/composer.ts`、cli `cli.ts`、
 * zcode/kimicode `run.ts`），因此**一次改动即覆盖全部适配器**；且 dryRun 是 round 0 的
 * 首次派发，zcode/kimicode 仅在 `initialDispatch` 时附加 context 的守卫不会把它吞掉。
 */
export const DRY_RUN_CONSTRAINT = [
  "【本任务是 dryRun 只读预演 —— 必须严格遵守】",
  "",
  "1. **不得创建、修改或删除任何源文件**；不要运行会改动工作区的命令（如格式化、自动修复、构建产物写入）。",
  "   允许且**必须**写入的唯一文件是下面第 2 条要求的计划文件。",
  "2. 必须把修改方案写成机器可读的计划文件：`.tianshu-mcp/dry-run-plan.json`（相对项目根），格式：",
  "   ```json",
  '   { "summary": "一句话方案", "files": [ { "path": "src/foo.ts", "action": "modify",',
  '     "reason": "为什么要改", "edits": [ { "line": 42, "symbol": "functionName", "action": "怎么改" } ] } ] }',
  "   ```",
  '   `path` 必须是**项目相对路径**（不得写绝对路径、不得包含 `..`、不得指向 `.git` 或 `node_modules`）；',
  '   `action` 取值为 `create` / `modify` / `delete`；`edits` 可选，但写了就要与文件真实内容对得上',
  "   （行号必须在文件范围内、`symbol` 必须在文件中真实存在）—— 验收引擎会逐条静态核对。",
  "3. 验收引擎只做静态分析（文件是否存在、拟改位置是否存在、是否有明显逻辑冲突），",
  "   **不跑 typecheck / test / build**。因此请不要在回复里声称测试已通过。",
  "4. 在回复里用自然语言说明方案要点即可；**不要**开始实施改动。",
].join("\n");

export function makeBuildCtx(services: AppServices) {
  return (
    meta: TaskMeta,
    round: number,
    feedback?: string,
    adapter?: AgentAdapter,
  ): TaskContext => ({
    taskId: meta.taskId,
    workspaceMode: meta.workspaceMode,
    projectPath: meta.projectPath,
    displayPath: meta.displayPath,
    agentId: meta.agentId,
    task: meta.task,
    // dryRun：把只读预演约束并入 context（既有的用户 context 保留在前）
    context: meta.dryRun
      ? [meta.context, DRY_RUN_CONSTRAINT].filter((s) => s && s.trim() !== "").join("\n\n")
      : meta.context,
    model: meta.model,
    reasoningLevel: meta.reasoningLevel,
    modelSource: meta.modelSource,
    planDoc: meta.planDoc,
    designSystem: meta.designSystem,
    designDirection: meta.designDirection,
    contextWindow: meta.contextWindow,
    mode: meta.mode,
    allowCreateProject: meta.allowCreateProject,
    round,
    feedback,
    taskDir: services.store.dir(meta.taskId),
    workDir: meta.projectPath,
    taskTimeoutMs: meta.taskTimeoutMs,
    resume: buildResume(meta, round, adapter),
  });
}

/**
 * GUI agent 的会话恢复块。
 * - zcode：需要显式回选原会话（sessionId/sessionTitle），轮次 > 0 或 continue_task 时启用。
 * - codex：实例与当前对话常驻，只需「复用同一会话」意图，无需回选 id。
 * - kimicode：与 zcode 同构（主窗口 URL + 侧栏都能定位会话），锚点用 kimicodeSession*；
 *   user_confirmation 恢复透传 reobserve（重连观察，不发送任何消息）。
 * - opendesign：没有可回选的会话 id，恢复语义是「对当前会话续说」，适配器侧确认会话页锚点。
 */
function buildResume(
  meta: TaskMeta,
  round: number,
  adapter?: AgentAdapter,
): TaskContext["resume"] {
  // 各 agent 的 resume 载荷由自己声明（AgentAdapter.buildResumePayload），
  // 这里只做分发。不实现该方法的 adapter 返回 undefined（无恢复上下文）。
  return adapter?.buildResumePayload?.(meta, round);
}
