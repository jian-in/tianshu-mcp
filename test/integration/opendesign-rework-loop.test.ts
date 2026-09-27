/**
 * 集成测试：Open Design 的「验收失败 → 生成计划文档 → 同会话返修 → 再验收」闭环（计划 §6「返修集成」）。
 *
 * 与 zcode 对照写，但有两处**必须**体现 opendesign 的差异：
 * 1. 计划文档落**项目根** `.opendesign/plans/opendesign-fix-r<N>.md`（`planDir` 默认值），
 *    而不是任务数据目录——Open Design 只能读它「工作目录」白名单内的文件，
 *    写进数据目录会得到「我让你看计划，你说读不到」；
 * 2. 返修指令里只出现**相对项目根**的路径（计划 §2 决策 20），不出现绝对路径。
 *
 * 适配器被替换成内存桩（不碰真机、不联网），因此这里验证的是**编排闭环的接线**：
 * 轮次记账、计划落盘位置、同会话（rework）语义、轮次封顶与手动返修的 fail-closed。
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AgentProfileSchema } from "../../src/config/schema.js";
import { OpenDesignGuiAdapter } from "../../src/agents/opendesign/adapter.js";
import type {
  AgentRunOptions,
  AgentRunResult,
  ResolvedAgent,
  TaskContext,
} from "../../src/agents/adapter.js";
import { AgentAdapterRegistry } from "../../src/agents/registry.js";
import { DataHome } from "../../src/config/store.js";
import { TaskStore } from "../../src/tasks/task-store.js";
import { TaskManager } from "../../src/tasks/task-manager.js";
import { AcceptanceEngine } from "../../src/verify/acceptance.js";
import { makeBuildCtx } from "../../src/mcp/context.js";
import { Logger } from "../../src/util/log.js";
import { gitInitAndCommit, makeTmpRoot, rmrf } from "../test-utils.js";
import { normPath } from "../../src/util/path.js";

const logger = new Logger(null, "error");
const cleanup: string[] = [];
afterAll(async () => {
  for (const dir of cleanup) await rmrf(dir);
});

/**
 * 造一个「名字合法」的启动器桩。
 *
 * 为什么不能像 zcode 那样直接把 `command` 指到 `process.execPath`：Open Design 的
 * `resolveProfile` 分支会**校验可执行名**（win32 需 `Open Design.exe`，其他平台需 `Open Design`），
 * 用 node 的路径会被判为「未找到可执行文件」而 `agent_unresolved`。
 */
async function launcherStub(): Promise<string> {
  const dir = await makeTmpRoot("od-launcher");
  cleanup.push(dir);
  const name = process.platform === "win32" ? "Open Design.exe" : "Open Design";
  const p = path.join(dir, name);
  fs.writeFileSync(p, "stub", "utf8");
  return p;
}

function profileFor(launcher: string) {
  return AgentProfileSchema.parse({
    displayName: "Open Design test",
    driver: "gui",
    adapter: "opendesign-gui",
    status: "ready",
    command: launcher,
    gui: { exePath: launcher, defaultAutoFixRounds: 2 },
    opendesign: { planDir: ".opendesign/plans" },
  });
}

/** 造一个「本轮必须产出 done.txt=PASS 才算通过」的项目 */
async function project(): Promise<string> {
  const dir = await makeTmpRoot("od-rework-project");
  cleanup.push(dir);
  fs.mkdirSync(path.join(dir, ".tianshu-mcp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "check.mjs"),
    "import fs from 'node:fs'; if(!fs.existsSync('done.txt')||fs.readFileSync('done.txt','utf8').trim()!=='PASS')process.exit(1);",
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, ".tianshu-mcp", "acceptance.json"),
    JSON.stringify({ checks: [{ name: "done", cmd: ["node", "check.mjs"] }] }),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "README.md"), "baseline", "utf8");
  await gitInitAndCommit(dir);
  return dir;
}

/** 记录每轮 ctx 的适配器桩；`passOnRepair` 为真时第二轮写出 done.txt */
class RepairAdapter extends OpenDesignGuiAdapter {
  calls: TaskContext[] = [];
  constructor(
    private readonly projectPath: string,
    private readonly passOnRepair: boolean,
  ) {
    super("opendesign");
  }
  override async run(
    ctx: TaskContext,
    _resolved: ResolvedAgent,
    _opts: AgentRunOptions,
  ): Promise<AgentRunResult> {
    this.calls.push(structuredClone(ctx));
    if (ctx.round > 0 && this.passOnRepair)
      fs.writeFileSync(path.join(this.projectPath, "done.txt"), "PASS", "utf8");
    return {
      ok: true,
      exitCode: 0,
      timeout: false,
      killed: false,
      durationMs: 1,
      logFile: path.join(ctx.taskDir, `agent-${ctx.round}.log`),
      keptInstance: true,
      endReason: "reply_stable",
      actualModel: "deepseek-v4.1-flash",
    };
  }
}

async function harness(projectPath: string, passOnRepair: boolean) {
  const home = await makeTmpRoot("od-rework-home");
  cleanup.push(home);
  const data = new DataHome(home, logger, { opendesign: profileFor(await launcherStub()) });
  await data.init();
  const store = new TaskStore(home, logger);
  const registry = new AgentAdapterRegistry(() => data.loadProfiles(), logger);
  const adapter = new RepairAdapter(projectPath, passOnRepair);
  registry.register("opendesign", adapter);
  const manager = new TaskManager(
    store,
    data,
    registry,
    new AcceptanceEngine(store, logger),
    logger,
    makeBuildCtx({ store, dataHome: data }),
  );
  await manager.initialize(1);
  return { manager, store, adapter };
}

/** 等到终态：用**墙钟上限**而不是固定轮数——每轮都含 git 基线/快照/验收，轮数一多就超过了固定轮数预算 */
async function waitTerminal(manager: TaskManager, taskId: string, timeoutMs = 90_000) {
  const start = Date.now();
  for (;;) {
    const meta = await manager.getMeta(taskId);
    if (
      meta &&
      ["succeeded", "failed", "needs_attention"].includes(meta.status) &&
      manager.activeCount === 0
    )
      return meta;
    if (Date.now() - start > timeoutMs)
      throw new Error(`等待终态超时（${timeoutMs}ms，最近状态=${meta?.status ?? "无"}）`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("Open Design 自动验收返修", () => {
  it("失败后在**项目根**生成计划，并在同一会话返修通过", async () => {
    const dir = await project();
    const h = await harness(dir, true);
    const task = await h.manager.submit({
      projectPath: normPath(dir),
      displayPath: dir,
      agentId: "opendesign",
      task: "生成 done.txt",
      designDirection: "原型",
      autoVerify: true,
      autoFixRounds: 2,
      taskTimeoutMs: 30_000,
    });
    const final = await waitTerminal(h.manager, task.taskId);

    expect(final.status).toBe("succeeded");
    expect(h.adapter.calls).toHaveLength(2);

    // 闭环语义：第二轮是「同会话续说」（rework），而不是新派发
    expect(h.adapter.calls[1]?.resume).toMatchObject({ kind: "rework" });

    // 计划落**项目根**，且返修指令里只有**相对路径**（Open Design 只能读工作目录白名单内文件）
    const planAbs = path.join(dir, ".opendesign", "plans", "opendesign-fix-r0.md");
    expect(fs.existsSync(planAbs)).toBe(true);
    const feedback = h.adapter.calls[1]?.feedback ?? "";
    expect(feedback).toContain(".opendesign/plans/opendesign-fix-r0.md");
    expect(feedback).not.toContain(dir);
    expect(feedback).toContain("未通过");

    // 反向：绝不能落在任务数据目录（那里 Open Design 读不到）
    expect(fs.existsSync(path.join(h.store.dir(task.taskId), "opendesign-fix-r0.md"))).toBe(false);
  });

  it("计划文档带视觉差异表与「只做定向修复」的要求（返修指令可操作）", async () => {
    const dir = await project();
    const h = await harness(dir, false);
    const task = await h.manager.submit({
      projectPath: normPath(dir),
      displayPath: dir,
      agentId: "opendesign",
      task: "生成 done.txt",
      designDirection: "原型",
      autoVerify: true,
      autoFixRounds: 1,
      taskTimeoutMs: 30_000,
    });
    await waitTerminal(h.manager, task.taskId);

    const planText = fs.readFileSync(
      path.join(dir, ".opendesign", "plans", "opendesign-fix-r0.md"),
      "utf8",
    );
    expect(planText).toContain("Open Design 修复/优化计划");
    expect(planText).toContain("视觉验收差异");
    expect(planText).toContain("只针对第 2、3 节的未通过项做定向修复或优化");
    // 计划里必须写清「未通过项」而不是只给结论
    expect(planText).toContain("未通过项");
  });

  it("自动返修轮次封顶后进入 needs_attention（每轮独立计划，不覆盖历史）", async () => {
    const dir = await project();
    const h = await harness(dir, false);
    const task = await h.manager.submit({
      projectPath: normPath(dir),
      displayPath: dir,
      agentId: "opendesign",
      task: "生成 done.txt",
      designDirection: "原型",
      autoVerify: true,
      autoFixRounds: 2,
      taskTimeoutMs: 30_000,
    });
    const final = await waitTerminal(h.manager, task.taskId);

    expect(final.status).toBe("needs_attention");
    expect(h.adapter.calls).toHaveLength(3); // 首轮 + 2 轮返修
    expect(final.roundsUsed).toBe(3);
    // 每轮独立文件（r0 与 r1 同时存在，历史不被覆盖）
    expect(fs.existsSync(path.join(dir, ".opendesign", "plans", "opendesign-fix-r0.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".opendesign", "plans", "opendesign-fix-r1.md"))).toBe(true);
  });

  it("手动返修在没有验收报告时 fail-closed（拒绝发送无处可查的口头返修）", async () => {
    const dir = await project();
    const h = await harness(dir, false);
    // autoVerify=false → 不产生 reportJson/Md
    const task = await h.manager.submit({
      projectPath: normPath(dir),
      displayPath: dir,
      agentId: "opendesign",
      task: "生成 done.txt",
      designDirection: "原型",
      autoVerify: false,
      autoFixRounds: 0,
      taskTimeoutMs: 30_000,
    });
    await waitTerminal(h.manager, task.taskId);

    const rework = await h.manager.rework(task.taskId, "再改一版");
    expect(rework.found).toBe(false);
    expect(rework.reason ?? "").toContain("验收报告");
  });

  it("手动返修在有报告时生成计划并把用户追加要求并入返修指令", async () => {
    const dir = await project();
    const h = await harness(dir, true);
    const task = await h.manager.submit({
      projectPath: normPath(dir),
      displayPath: dir,
      agentId: "opendesign",
      task: "生成 done.txt",
      designDirection: "原型",
      autoVerify: true,
      autoFixRounds: 1,
      taskTimeoutMs: 30_000,
    });
    await waitTerminal(h.manager, task.taskId);

    const rework = await h.manager.rework(task.taskId, "另外把标题字号调大");
    expect(rework.found).toBe(true);
    const final = await waitTerminal(h.manager, task.taskId);
    expect(final.status).toBe("succeeded");

    // 手动返修走的是「项目根计划 + 用户追加要求」的组合指令
    const manual = h.adapter.calls.at(-1)?.feedback ?? "";
    expect(manual).toContain(".opendesign/plans/opendesign-fix-r");
    expect(manual).toContain("用户追加返修要求");
    expect(manual).toContain("标题字号调大");
  });
});