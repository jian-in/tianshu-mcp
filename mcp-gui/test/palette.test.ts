import { describe, expect, it } from "vitest";
import {
  PALETTE_TASK_LIMIT,
  buildCommands,
  filterCommands,
  fuzzyScore,
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

describe("命令目录装配", () => {
  it("导航 + 数据目录 + 任务，且当前目录带「当前」标注", () => {
    const commands = buildCommands(t, {
      tasks: [task("tsk_1")],
      dataHomes: ["/home", "/other"],
      activeHome: "/home",
    });
    const ids = commands.map((c) => c.id);
    expect(ids).toContain("nav:insights");
    expect(ids).toContain("home:/home");
    expect(ids).toContain("home:/other");
    expect(ids).toContain("task:tsk_1");

    const active = commands.find((c) => c.id === "home:/home");
    expect(active?.hint).toBe("palette.homeActive");
    expect(commands.find((c) => c.id === "home:/other")?.hint).toBeNull();
  });

  it("任务命令有条数上限（超出如实截断，不静默丢弃到无限长列表）", () => {
    const many = Array.from({ length: PALETTE_TASK_LIMIT + 5 }, (_, i) =>
      task(`tsk_${String(i).padStart(3, "0")}`),
    );
    const commands = buildCommands(t, { tasks: many, dataHomes: [], activeHome: "" });
    expect(commands.filter((c) => c.group === "tasks")).toHaveLength(PALETTE_TASK_LIMIT);
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

  it("空查询保持原顺序并截断到上限", () => {
    const commands = [cmd("a", "A"), cmd("b", "B"), cmd("c", "C")];
    expect(filterCommands(commands, "").map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(filterCommands(commands, "", 2).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("查询命中 label 或 keywords；不匹配的项被剔除", () => {
    const commands = [
      cmd("task:tsk_1", "打开任务：tsk_1", ["tsk_1"]),
      cmd("nav:settings", "设置"),
    ];
    expect(filterCommands(commands, "tsk").map((c) => c.id)).toEqual(["task:tsk_1"]);
    expect(filterCommands(commands, "设置").map((c) => c.id)).toEqual(["nav:settings"]);
    expect(filterCommands(commands, "zzz")).toEqual([]);
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
