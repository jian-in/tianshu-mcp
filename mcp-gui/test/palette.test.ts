import { describe, expect, it } from "vitest";
import {
  PALETTE_RESULT_LIMIT,
  buildStaticCommands,
  buildTaskCommands,
  fuzzyScore,
  rankCommands,
  stepIndex,
  type PaletteCommand,
  type Translate,
} from "@/core/palette";
import type { TaskSummary } from "@/api/types";

/** 假翻译：直接把键名当文案，便于断言命令 `id` 与文案的对应关系（不依赖 i18n 单例） */
const t: Translate = (path, params) => {
  if (!params) return path;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), path);
};

function task(taskId: string, patch: Partial<TaskSummary> = {}): TaskSummary {
  return {
    taskId,
    status: "succeeded",
    workspaceMode: "project",
    projectPath: "D:/p",
    displayPath: "D:/p",
    agentId: "codex",
    task: "做点事",
    roundsUsed: 1,
    reportRound: 0,
    createdAt: "2026-09-26T10:00:00Z",
    updatedAt: "2026-09-26T10:30:00Z",
    finishedAt: null,
    lastMessage: null,
    dryRun: false,
    errorType: null,
    checkSummary: null,
    diffstat: null,
    changedFiles: [],
    dataHome: "/home",
    artifacts: {
      agentLogs: [],
      verifyLogs: [],
      reportMd: [],
      reportJson: [],
      reportHtml: [],
      dryRunMd: [],
      dryRunJson: [],
      hasBaseline: false,
      hasDryRunPlan: false,
    },
    ...patch,
  };
}

const cmd = (id: string, label: string, keywords: string[] = []): PaletteCommand => ({
  id,
  group: "nav",
  label,
  hint: null,
  keywords,
});

describe("静态命令（导航 + 数据目录）", () => {
  it("含导航项，且当前数据目录带「当前」标注", () => {
    const commands = buildStaticCommands(t, { dataHomes: ["/home", "/other"], activeHome: "/home" });
    const ids = commands.map((c) => c.id);
    expect(ids).toContain("nav:overview");
    expect(ids).toContain("nav:insights");
    expect(ids).toContain("home:/home");
    expect(ids).toContain("home:/other");
    expect(commands.find((c) => c.id === "home:/home")?.hint).toBe("palette.homeActive");
    expect(commands.find((c) => c.id === "home:/other")?.hint).toBeNull();
  });

  it("不产生任务命令（任务命令一律实时检索）", () => {
    const commands = buildStaticCommands(t, { dataHomes: [], activeHome: "" });
    expect(commands.some((c) => c.group === "tasks")).toBe(false);
  });
});

describe("任务命令：按输入实时检索（无条数上限）", () => {
  const many = Array.from({ length: 300 }, (_, i) =>
    task(`tsk_${String(i).padStart(3, "0")}`, { task: `第 ${i} 个任务`, agentId: i % 2 ? "zcode" : "codex" }),
  );

  it("空输入不返回任何任务命令（一打开不铺任务列表）", () => {
    expect(buildTaskCommands(t, many, "")).toEqual([]);
    expect(buildTaskCommands(t, many, "   ")).toEqual([]);
  });

  it("第 300 个任务（远超旧上限 50）也能被搜到", () => {
    const out = buildTaskCommands(t, many, "tsk_299");
    expect(out.map((c) => c.id)).toEqual(["task:tsk_299"]);
  });

  it("按任务书与 Agent 关键字也能命中（多命中时保持任务集合顺序）", () => {
    const byBrief = buildTaskCommands(t, many, "第 137 个");
    expect(byBrief.map((c) => c.id)).toEqual(["task:tsk_137"]);
    const byAgent = buildTaskCommands(t, many, "zcode");
    expect(byAgent.length).toBe(150);
    expect(byAgent[0]?.id).toBe("task:tsk_001");
  });

  it("无匹配返回空数组（不猜）", () => {
    expect(buildTaskCommands(t, many, "zzzzz-not-exist")).toEqual([]);
  });
});

describe("模糊匹配", () => {
  it("子序列匹配：不要求连续，但顺序必须一致", () => {
    expect(fuzzyScore("Insights", "ins")).not.toBeNull();
    expect(fuzzyScore("Insights", "igs")).not.toBeNull();
    expect(fuzzyScore("Insights", "sgi")).toBeNull();
    expect(fuzzyScore("Insights", "")).toBe(0);
  });

  it("前缀连续命中得分高于中间命中", () => {
    const prefix = fuzzyScore("insights", "ins") ?? 0;
    const middle = fuzzyScore("go ins", "ins") ?? 0;
    expect(prefix).toBeGreaterThan(middle);
  });
});

describe("排序与截断", () => {
  it("空查询保持传入顺序并截断到展示上限", () => {
    const commands = [cmd("a", "A"), cmd("b", "B"), cmd("c", "C")];
    expect(rankCommands(commands, "").map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(rankCommands(commands, "", 2).map((c) => c.id)).toEqual(["a", "b"]);
    expect(rankCommands(commands, "").length).toBeLessThanOrEqual(PALETTE_RESULT_LIMIT);
  });

  it("查询命中 label 或 keywords；不匹配的项被剔除", () => {
    const commands = [
      cmd("task:tsk_1", "打开任务：tsk_1", ["tsk_1"]),
      cmd("nav:settings", "设置"),
    ];
    expect(rankCommands(commands, "tsk").map((c) => c.id)).toEqual(["task:tsk_1"]);
    expect(rankCommands(commands, "设置").map((c) => c.id)).toEqual(["nav:settings"]);
    expect(rankCommands(commands, "zzz")).toEqual([]);
  });

  it("展示上限只截显示条数，不影响检索范围（命中全在候选里）", () => {
    const commands = Array.from({ length: 60 }, (_, i) => cmd(`task:t${i}`, `打开任务：t${i}`, [`t${i}`]));
    const ranked = rankCommands(commands, "t", 5);
    expect(ranked).toHaveLength(5);
    // 未截断的直接调用能看到全部 60 条，说明「截断发生在最后一步」
    expect(rankCommands(commands, "t", 100)).toHaveLength(60);
  });
});

describe("列表键盘导航", () => {
  it("上下移动循环；空列表恒为 0", () => {
    expect(stepIndex(3, 0, 1)).toBe(1);
    expect(stepIndex(3, 2, 1)).toBe(0);
    expect(stepIndex(3, 0, -1)).toBe(2);
    expect(stepIndex(0, 5, 1)).toBe(0);
  });
});
