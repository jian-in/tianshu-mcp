/**
 * 集成测试：Open Design GUI 驱动的完整单轮流程（假 CDP，不依赖真机、不联网）。
 *
 * 覆盖（对应计划 §3.4 的 12 步与 §5 的失败模式）：
 *   接管实例 → 连接主窗口 → 版本门禁 → 布局守卫 → 绑定工作目录（含原生对话框回读）
 *   → 选模型 → 选设计系统 → 选设计方向 → 输入发送（只点一次）→ 三信号轮询到完成；
 * 以及 fail-closed 路径：入口拒绝非法方向、模型未命中、版本不匹配、布局漂移、
 *   既有实例无法接管、发送结果无法确认（绝不重发）、取消（如实回报 GUI 停止结果）、返修续说。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import path from "node:path";
import { makeTmpRoot, rmrf } from "../test-utils.js";
import {
  FakeOpenDesignPage,
  makeOpenDesignFakeState,
  type FakeOpenDesignState,
} from "../fake-cdp.js";
import { runOpenDesignTask, type OpenDesignRunDeps } from "../../src/agents/opendesign/run.js";
import { BUILTIN_PROFILES } from "../../src/agents/builtin.js";
import type { AgentRunLogger, ResolvedAgent, TaskContext } from "../../src/agents/adapter.js";

const silentLogger: AgentRunLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const OD_PROFILE = BUILTIN_PROFILES.opendesign!;

/** 临时安装目录（版本门禁读它下面的 resources/open-design-config.json） */
async function makeInstallDir(version: string): Promise<string> {
  const dir = await makeTmpRoot("od-install");
  const resources = path.join(dir, "resources");
  await fsp.mkdir(resources, { recursive: true });
  await fsp.writeFile(
    path.join(resources, "open-design-config.json"),
    JSON.stringify({ appVersion: version, namespace: "release-stable-win" }),
    "utf8",
  );
  return dir;
}

let installDir = "";
let oldInstallDir = "";
let projectDir = "";

beforeAll(async () => {
  installDir = await makeInstallDir("0.24.1");
  oldInstallDir = await makeInstallDir("0.25.0");
  projectDir = await makeTmpRoot("od-project");
  await fsp.writeFile(path.join(projectDir, "index.html"), "<html><body>demo</body></html>", "utf8");
});

afterAll(async () => {
  await Promise.all([installDir, oldInstallDir, projectDir].map((d) => rmrf(d)));
});

/**
 * 构造解析后的 agent（GUI 参数按测试加速收敛，不改变语义）。
 *
 * `supported` 用于覆盖版本门禁表：门禁判据是按**宿主平台**取 `supportedVersions[platform]` 的
 * （生产语义：Open Design 跑在什么系统上就按那个系统取证），内置 profile 只填了 `win32`，
 * 因此 CI 的 ubuntu/macos 腿上门禁天然处于「未配置即放行」状态。要验证门禁本身，
 * 必须把**当前宿主平台**写进去，否则这条用例只能在 Windows 上通过。
 */
function makeResolved(
  command = path.join(installDir, "Open Design.exe"),
  supported?: Record<string, string[]>,
): ResolvedAgent {
  return {
    id: "opendesign",
    displayName: "Open Design",
    command,
    argsTemplate: [],
    ok: true,
    message: "",
    profile: {
      ...OD_PROFILE,
      gui: {
        ...OD_PROFILE.gui!,
        pollIntervalMs: 5,
        stableRounds: 2,
        idleTimeoutMs: 60,
        stallTimeoutMs: 120,
        launchTimeoutMs: 300,
        cdpSendTimeoutMs: 1_000,
        cancelWaitMs: 100,
        progressIntervalMs: 10_000,
        setupRecoveryTimeoutMs: 3_000,
        projectTriggerTimeoutMs: 200,
        dialogProbeTimeoutMs: 200,
        dialogOperationTimeoutMs: 200,
      },
      opendesign: {
        ...OD_PROFILE.opendesign!,
        supportedVersions: supported ?? OD_PROFILE.opendesign!.supportedVersions,
        modelMenuTimeoutMs: 200,
        designSystemTimeoutMs: 200,
        designDirectionTimeoutMs: 200,
        workingDirPanelTimeoutMs: 200,
        nativeDialogTimeoutMs: 200,
        sendReadyTimeoutMs: 400,
      },
    },
  } as unknown as ResolvedAgent;
}

function makeCtx(over: Partial<TaskContext> = {}): TaskContext {
  return {
    taskId: "tsk_od",
    projectPath: projectDir,
    displayPath: projectDir,
    agentId: "opendesign",
    task: "做一个订单跟踪原型",
    round: 0,
    taskDir: path.join(projectDir, ".task"),
    workDir: projectDir,
    taskTimeoutMs: 8_000,
    designDirection: "原型",
    model: "deepseek-v4-pro",
    designSystem: "Claude (Anthropic)",
    ...over,
  };
}

/** 注入依赖：复用已就绪实例；页面用内存桩；原生对话框直接回写目录（不碰系统） */
function makeDeps(
  state: FakeOpenDesignState,
  over: Partial<OpenDesignRunDeps> = {},
): Partial<OpenDesignRunDeps> {
  return {
    ensureInstance: async () => ({ ready: { port: 9889, title: "Open Design", pid: 4242 } }),
    listProcesses: async () => [],
    probePort: async () => ({ ready: true, version: "Electron/41.3.0" }),
    createPage: () => new FakeOpenDesignPage(state) as never,
    // makeClient 不覆盖：走真实 OpenDesignCdpClient（表达式 + 坐标点击全链路）
    listDialogs: async () => [],
    selectFolder: async (target) => {
      if (state.nativeDialogFails)
        return { ok: false, reason: "submit", message: "原生对话框确认失败（测试桩）" };
      state.workingDir = target;
      state.workDirPanelOpen = false;
      return { ok: true, mode: "keyboard", readback: target, message: "ok" };
    },
    closeDialogs: async () => 0,
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 2))),
    ...over,
  };
}

interface RunOptions {
  ctx?: Partial<TaskContext>;
  deps?: Partial<OpenDesignRunDeps>;
  command?: string;
  /** 覆盖版本门禁表（默认用内置 profile 的 win32 条目） */
  supportedVersions?: Record<string, string[]>;
  onEvent?: (kind: string) => void;
  signal?: AbortSignal;
}

async function run(
  state: FakeOpenDesignState,
  options: RunOptions = {},
): Promise<{ res: Awaited<ReturnType<typeof runOpenDesignTask>>; events: string[] }> {
  const events: string[] = [];
  const res = await runOpenDesignTask({
    ctx: makeCtx(options.ctx),
    resolved: makeResolved(options.command, options.supportedVersions),
    opts: {
      logger: silentLogger,
      signal: options.signal,
      onProgress: () => {},
      onEvent: (event) => {
        events.push(event.kind);
        options.onEvent?.(event.kind);
      },
    },
    logFile: path.join(projectDir, ".task", "agent-0.log"),
    deps: makeDeps(state, options.deps),
  });
  return { res, events };
}

describe("Open Design GUI 驱动（假 CDP）", () => {
  it("完整派发：绑目录 → 选模型 → 选设计系统 → 选方向 → 发送 → 轮询完成", async () => {
    // 运行状态脚本：派发后先「运行中」两拍，再静止（复刻真机「跑一会儿后停止按钮消失」）。
    // 用脚本而非定时器：轮询间隔被压到 5ms，异步定时器会与判定抢跑。
    const state = makeOpenDesignFakeState({
      designSystem: null,
      direction: null,
      pollScript: [
        { stopVisible: true, sendStarting: true },
        { stopVisible: true, sendStarting: true },
        { stopVisible: false, sendStarting: false },
      ],
    });
    const { res, events } = await run(state);

    expect(res.hardFailure).toBeFalsy();
    expect(res.ok).toBe(true);
    expect(res.endReason).toBe("reply_stable");
    expect(res.keptInstance).toBe(true);
    expect(res.actualModel).toBe("deepseek-v4-pro");

    // 每一步都真的落到了界面上（不是「点了就算」）
    expect(state.workingDir).toBe(projectDir);
    expect(state.model).toBe("deepseek-v4-pro");
    expect(state.designSystem).toBe("Claude (Anthropic)");
    expect(state.direction).toBe("原型");
    // 只点一次发送；任务书带标记进了对话
    expect(state.sendClicks).toBe(1);
    expect(state.conversation).toContain("【tianshu:tsk_od:r0:initial】");
    // 事件流：派发 + 运行中（启发式）
    expect(events).toContain("task_dispatched");
    expect(events).toContain("file_modification_started");
  });

  it("无 projectPath：跳过目录绑定与视觉验收，终态文案如实说明（计划 §4）", async () => {
    const state = makeOpenDesignFakeState({
      pollScript: [
        { stopVisible: true, sendStarting: true },
        { stopVisible: false, sendStarting: false },
      ],
    });
    const { res } = await run(state, { ctx: { projectPath: "" } });

    expect(res.ok).toBe(true);
    expect(res.progressSummary ?? "").toContain("已跳过目录绑定与视觉验收");
    // 无项目模式**必须**跳过目录交互（沿用界面当前工作目录）
    expect(state.clicks).not.toContain("working-dir-trigger");
    expect(state.sendClicks).toBe(1);
  });

  it("模型名未命中 → model_unavailable 硬失败，并回显当前可见候选（绝不模糊匹配）", async () => {
    const state = makeOpenDesignFakeState({ models: ["deepseek-v4.1-flash", "claude-fable-5"] });
    const { res } = await run(state, { ctx: { model: "deepseek-v4-pro" } });

    expect(res.hardFailure).toBe(true);
    expect(res.endReason).toBe("model_unavailable");
    expect(res.error ?? "").toContain("deepseek-v4.1-flash");
    expect(res.error ?? "").toContain("claude-fable-5");
    // 未切模型就不该继续往下派发
    expect(state.sendClicks).toBe(0);
  });

  it("非法设计方向在入口即拒（不进 GUI）", async () => {
    let ensureCalled = false;
    const state = makeOpenDesignFakeState();
    const { res } = await run(state, {
      ctx: { designDirection: "幻灯片" },
      deps: {
        ensureInstance: async () => {
          ensureCalled = true;
          return { ready: { port: 9889 } };
        },
      },
    });

    expect(res.hardFailure).toBe(true);
    expect(res.endReason).toBe("setup_failed");
    expect(res.error ?? "").toContain("幻灯片");
    expect(ensureCalled).toBe(false);
  });

  it("版本不在已取证列表 → version_mismatch（fail-closed，不派发）", async () => {
    const state = makeOpenDesignFakeState();
    const { res } = await run(state, {
      command: path.join(oldInstallDir, "Open Design.exe"),
      // 门禁按宿主平台取表（见 makeResolved 的说明）：把**当前宿主平台**写进已取证列表，
      // 这条用例才能在 Windows / Linux / macOS 三种腿上**同等生效**（而不是只在 Windows 上跑）。
      supportedVersions: { [process.platform]: ["0.24.1"] },
    });
    expect(res.hardFailure).toBe(true);
    expect(res.endReason).toBe("version_mismatch");
    expect(res.error ?? "").toContain("0.25.0");
    expect(state.sendClicks).toBe(0);
  });

  it("版本门禁按宿主平台取表：宿主平台未取证时不拦截（避免跨平台误报）", async () => {
    // 与上一条互补：内置 profile 只填 win32，宿主不是 win32 时门禁「未配置即放行」——
    // 这是刻意的平台语义，不是漏洞（派发资格另由 registry 的 status 判定）。
    const state = makeOpenDesignFakeState();
    const { res } = await run(state, {
      command: path.join(oldInstallDir, "Open Design.exe"),
      supportedVersions: { "some-other-platform": ["0.24.1"] },
    });
    expect(res.endReason).not.toBe("version_mismatch");
  });

  it("布局守卫未命中（局部锚点漂移）→ selector_drift 硬失败，不进任何点击", async () => {
    const state = makeOpenDesignFakeState({ missingAnchors: ["composer"] });
    const { res } = await run(state);
    expect(res.hardFailure).toBe(true);
    expect(res.endReason).toBe("selector_drift");
    // 诊断必须能支撑「修选择器」：既要报缺哪个键，也要给出当前页面渲染了什么
    expect(res.error ?? "").toContain("composer");
    expect(res.error ?? "").toContain("页面文本片段");
    expect(state.sendClicks).toBe(0);
    expect(state.clicks).not.toContain("model-trigger");
  });

  it("既有实例未开 CDP → needs_user(close_existing_instance)，绝不 kill 用户进程", async () => {
    const state = makeOpenDesignFakeState();
    const { res } = await run(state, {
      deps: { ensureInstance: async () => ({ needsClose: true }) },
    });
    expect(res.endReason).toBe("needs_user");
    expect(res.needsUserKind).toBe("close_existing_instance");
    expect(res.hardFailure).toBeFalsy();
  });

  it("发送结果无法确认 → send_unknown 且只点过一次发送（绝不重发）", async () => {
    const state = makeOpenDesignFakeState({ sendSwallowed: true });
    const { res } = await run(state);
    expect(res.hardFailure).toBe(true);
    expect(res.endReason).toBe("send_unknown");
    expect(res.error ?? "").toContain("不重复发送");
    expect(state.sendClicks).toBe(1);
  });

  it("原生对话框未完成路径提交 → 转 needs_user（可 continue_task 续跑），不派发", async () => {
    const state = makeOpenDesignFakeState({ nativeDialogFails: true });
    const { res } = await run(state);
    expect(res.hardFailure).toBeFalsy();
    expect(res.endReason).toBe("needs_user");
    expect(res.needsUserKind).toBe("setup_recovery");
    expect(res.pendingQuestion ?? "").toContain("工作目录绑定失败");
    expect(state.sendClicks).toBe(0);
  });

  it("取消：尽力点停止按钮并如实回报 guiStop（idle=true 才算已停止）", async () => {
    const state = makeOpenDesignFakeState();
    const controller = new AbortController();
    const { res } = await run(state, {
      signal: controller.signal,
      // 派发确认后立即取消：观察循环第一步就会走 abort 路径
      onEvent: (kind) => {
        if (kind === "task_dispatched") controller.abort();
      },
    });
    expect(res.killed).toBe(true);
    expect(res.endReason).toBe("aborted");
    expect(res.guiStop).toEqual({ clicked: true, idle: true });
    expect(state.clicks).toContain("stop-button");
    expect(res.keptInstance).toBe(true);
  });

  it("返修续说：ack 会话页存在后把返修指令发进当前会话（不重绑目录、不重选模型）", async () => {
    const state = makeOpenDesignFakeState({
      onHome: false,
      conversation: "【tianshu:tsk_od:r0:initial】\n已生成初版",
      model: "deepseek-v4-pro",
      pollScript: [
        { stopVisible: true, sendStarting: true },
        { stopVisible: true, sendStarting: true },
        { stopVisible: false, sendStarting: false },
      ],
    });
    const { res } = await run(state, {
      ctx: {
        round: 1,
        resume: { kind: "rework", sendMessage: true },
        feedback: "【上一轮验收未通过】视觉差异：首页 hero 未对齐",
      },
    });
    expect(res.ok).toBe(true);
    expect(state.sendClicks).toBe(1);
    expect(state.conversation).toContain("【tianshu:tsk_od:r1:rework:r1】");
    expect(state.conversation).toContain("自动验收返修");
    // 返修轮不应再动目录/模型/设计系统
    expect(state.clicks).not.toContain("working-dir-trigger");
    expect(state.clicks).not.toContain("model-trigger");
  });

  it("rework 轮但当前不在会话页 → session_lost，拒绝退化到首页重新派发", async () => {
    const state = makeOpenDesignFakeState({
      onHome: false,
      conversationMissing: true,
    });
    const { res } = await run(state, {
      ctx: { round: 1, resume: { kind: "rework", sendMessage: true } },
    });

    expect(res.hardFailure).toBe(true);
    expect(res.endReason).toBe("session_lost");
    expect(state.sendClicks).toBe(0);
  });
});