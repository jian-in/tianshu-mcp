import { describe, expect, it } from "vitest";
import { buildStages, stageShare, totalMs } from "@/core/timeline";
import type { TaskEvent } from "@/api/types";

function ev(ts: string, event: string, state: string, kind: TaskEvent["kind"] = "status"): TaskEvent {
  return { ts, event, state, kind, detail: null, data: null, line: 1 };
}

const ISO = (seconds: number): string =>
  `2026-09-26T10:00:${String(seconds).padStart(2, "0")}.000Z`;

describe("A6 阶段甘特 · buildStages", () => {
  it("按状态跃迁切段：每段结束时间 = 下一条状态事件时间", () => {
    const stages = buildStages([
      ev(ISO(0), "created", "queued"),
      ev(ISO(1), "started", "running"),
      ev(ISO(11), "succeeded", "succeeded"),
    ]);
    expect(stages.map((s) => s.name)).toEqual(["created", "started", "succeeded"]);
    expect(stages[0]).toMatchObject({ startedAt: ISO(0), endedAt: ISO(1), ms: 1000 });
    expect(stages[1]).toMatchObject({ startedAt: ISO(1), endedAt: ISO(11), ms: 10_000 });
    // 最后一段没有结束时间：如实 null（界面标「进行中」），不编造时长
    expect(stages[2]).toMatchObject({ startedAt: ISO(11), endedAt: null, ms: null });
  });

  it("只看状态跃迁：agent / note / unknown 事件不参与切段，也不打断相邻关系", () => {
    const stages = buildStages([
      ev(ISO(0), "created", "queued"),
      ev(ISO(1), "task_dispatched", "running", "agent"),
      ev(ISO(2), "note", "running", "note"),
      ev(ISO(3), "started", "running"),
    ]);
    expect(stages.map((s) => s.name)).toEqual(["created", "started"]);
    // 中间夹着 agent / note 事件时，created 段仍以「下一条状态事件」为结束（不是下一条任意事件）
    expect(stages[0]!.ms).toBe(3000);
  });

  it("时间不可解析 → ms 为 null（不编造）；事件倒挂也为 null", () => {
    const stages = buildStages([
      ev("not-a-time", "created", "queued"),
      ev(ISO(5), "started", "running"),
      ev(ISO(1), "failed", "failed"),
    ]);
    expect(stages[0]!.ms).toBeNull();
    expect(stages[1]!.ms).toBeNull();
  });

  it("空输入与无状态事件 → 空数组", () => {
    expect(buildStages([])).toEqual([]);
    expect(buildStages([ev(ISO(0), "note", "running", "note")])).toEqual([]);
  });

  it("key 在同一任务内唯一（序号 + 事件名）", () => {
    const stages = buildStages([ev(ISO(0), "started", "running"), ev(ISO(1), "started", "running")]);
    expect(new Set(stages.map((s) => s.key)).size).toBe(2);
  });
});

describe("A6 阶段甘特 · totalMs / stageShare", () => {
  it("总时长只累加可解析阶段；一个都没有时 null", () => {
    const stages = buildStages([
      ev(ISO(0), "created", "queued"),
      ev(ISO(2), "started", "running"),
      ev(ISO(5), "succeeded", "succeeded"),
    ]);
    expect(totalMs(stages)).toBe(5000);
    expect(totalMs([])).toBeNull();
    expect(totalMs(buildStages([ev(ISO(0), "created", "queued")]))).toBeNull();
  });

  it("占比：总时长不可得或该段不可得时为 null（界面渲染成「进行中」段）", () => {
    const stages = buildStages([
      ev(ISO(0), "created", "queued"),
      ev(ISO(2), "started", "running"),
      ev(ISO(5), "succeeded", "succeeded"),
    ]);
    expect(stageShare(stages[0]!, 5000)).toBeCloseTo(0.4, 6);
    expect(stageShare(stages[2]!, 5000)).toBeNull();
    expect(stageShare(stages[0]!, null)).toBeNull();
    expect(stageShare(stages[0]!, 0)).toBeNull();
  });
});
