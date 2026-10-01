import { describe, expect, it } from "vitest";
import {
  aggregateInsights,
  avg,
  dayOf,
  extractReportFields,
  fillTrend,
  mondayOf,
  parseUtcMillis,
  rate,
  reworkRate,
  sortGroups,
  topN,
  toWeeks,
  type InsightRecord,
} from "@/core/insights";
import type { InsightsDay, InsightsGroup, InsightsReason } from "@/api/types";

const day = (
  date: string,
  total = 0,
  over: Partial<InsightsDay> = {},
): InsightsDay => ({ date, total, succeeded: 0, failed: 0, active: 0, reworked: 0, ...over });

describe("insights · 比率与均值（分母 0 一律 null，不编造 0%）", () => {
  it("rate", () => {
    expect(rate(3, 4)).toBe(0.75);
    expect(rate(0, 5)).toBe(0);
    expect(rate(1, 0)).toBeNull();
    expect(rate(1, -2)).toBeNull();
    expect(rate(Number.NaN, 2)).toBeNull();
  });

  it("avg", () => {
    expect(avg(2500, 2)).toBe(1250);
    expect(avg(0, 0)).toBeNull();
    expect(avg(100, 0)).toBeNull();
  });

  it("reworkRate", () => {
    expect(reworkRate({ total: 4, reworked: 1 })).toBe(0.25);
    expect(reworkRate({ total: 0, reworked: 0 })).toBeNull();
  });
});

describe("insights · 排序与 TopN", () => {
  const reasons: InsightsReason[] = [
    { kind: "failedCheck", key: "build", count: 1 },
    { kind: "signal", key: "consoleDebug", count: 3 },
    { kind: "errorType", key: "timeout", count: 1 },
    { kind: "failedCheck", key: "typecheck", count: 3 },
  ];

  it("topN：count 降序 + key 升序（同分稳定）", () => {
    expect(topN(reasons, 3).map((r) => `${r.key}:${r.count}`)).toEqual([
      "consoleDebug:3",
      "typecheck:3",
      "build:1",
    ]);
  });

  it("topN：n = 0 取空，n 超过长度取全部，且不改原数组", () => {
    expect(topN(reasons, 0)).toEqual([]);
    expect(topN(reasons, 99)).toHaveLength(4);
    expect(reasons.map((r) => r.key)).toEqual(["build", "consoleDebug", "timeout", "typecheck"]);
  });

  const groups: InsightsGroup[] = [
    {
      key: "b",
      summary: {
        total: 2,
        succeeded: 1,
        failed: 0,
        active: 0,
        needsAttention: 0,
        cancelled: 0,
        other: 0,
        roundsSum: 2,
        onePassCount: 1,
        reportsPresent: 0,
        reportsMissing: 2,
        verifyMsSum: 0,
        verifyMsCount: 0,
      },
    },
    {
      key: "a",
      summary: {
        total: 4,
        succeeded: 4,
        failed: 0,
        active: 0,
        needsAttention: 0,
        cancelled: 0,
        other: 0,
        roundsSum: 4,
        onePassCount: 4,
        reportsPresent: 0,
        reportsMissing: 4,
        verifyMsSum: 0,
        verifyMsCount: 0,
      },
    },
    {
      key: "c",
      summary: {
        total: 0,
        succeeded: 0,
        failed: 0,
        active: 0,
        needsAttention: 0,
        cancelled: 0,
        other: 0,
        roundsSum: 0,
        onePassCount: 0,
        reportsPresent: 0,
        reportsMissing: 0,
        verifyMsSum: 0,
        verifyMsCount: 0,
      },
    },
  ];

  it("sortGroups：按总量 / 成功率 / key，且不修改入参顺序", () => {
    expect(sortGroups(groups, "total").map((g) => g.key)).toEqual(["a", "b", "c"]);
    expect(sortGroups(groups, "successRate").map((g) => g.key)).toEqual(["a", "b", "c"]);
    expect(sortGroups(groups, "key").map((g) => g.key)).toEqual(["a", "b", "c"]);
    expect(groups.map((g) => g.key)).toEqual(["b", "a", "c"]);
  });
});

describe("insights · UTC 时间解析（严格镜像 Rust timestamps.rs）", () => {
  it("epoch 与毫秒", () => {
    expect(parseUtcMillis("1970-01-01T00:00:00Z")).toBe(0);
    expect(parseUtcMillis("2000-03-01T00:00:00Z")).toBe(951_868_800_000);
    const base = parseUtcMillis("2026-01-02T03:04:05Z");
    expect(base).not.toBeNull();
    expect(parseUtcMillis("2026-01-02T03:04:05.678Z")).toBe((base ?? 0) + 678);
    expect(parseUtcMillis("2026-01-02T03:04:05.6789Z")).toBe((base ?? 0) + 678);
  });

  it("非法输入一律 null（含偏移量写法与不存在的日期）", () => {
    for (const bad of [
      "",
      "not-a-time",
      "2026-01-02T03:04:05",
      "2026-01-02T03:04:05+08:00",
      "2026-13-01T00:00:00Z",
      "2026-02-30T00:00:00Z",
      "2023-02-29T00:00:00Z",
      "2026-01-02T24:00:00Z",
    ]) {
      expect(parseUtcMillis(bad), bad).toBeNull();
    }
    // 闰年合法
    expect(parseUtcMillis("2024-02-29T00:00:00Z")).not.toBeNull();
  });

  it("dayOf 取前 10 字符并校验合法性", () => {
    expect(dayOf("2026-09-26T11:41:03.512Z")).toBe("2026-09-26");
    expect(dayOf("2026-13-01T00:00:00Z")).toBeNull();
    expect(dayOf("")).toBeNull();
  });
});

describe("insights · 周历（周一为一周之始，跨月/跨年归并）", () => {
  // 星期真值由 `date -d <d> +%u`（ISO，1=周一）取证：
  // 2026-09-26=6(六) 2026-09-27=7(日) 2026-09-28=1(一) 2025-12-29=1(一) 2026-01-04=7(日) 2026-10-04=7(日)
  it("mondayOf", () => {
    expect(mondayOf("2026-09-26")).toBe("2026-09-21");
    expect(mondayOf("2026-09-27")).toBe("2026-09-21");
    expect(mondayOf("2026-09-28")).toBe("2026-09-28");
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
    expect(mondayOf("2026-01-04")).toBe("2025-12-29");
    expect(mondayOf("bad")).toBeNull();
  });

  it("toWeeks：跨月与跨年都归并到同一周（周起始日 = 周一）", () => {
    const weeks = toWeeks([
      day("2026-09-28", 1, { succeeded: 1 }),
      day("2026-10-04", 2, { succeeded: 1, failed: 1, reworked: 1 }),
    ]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.weekStart).toBe("2026-09-28");
    expect(weeks[0]!.total).toBe(3);
    expect(weeks[0]!.reworked).toBe(1);

    const crossYear = toWeeks([
      day("2025-12-29", 1, { succeeded: 1 }),
      day("2026-01-04", 1, { failed: 1 }),
    ]);
    expect(crossYear).toHaveLength(1);
    expect(crossYear[0]!.weekStart).toBe("2025-12-29");
    expect(crossYear[0]!.total).toBe(2);
  });

  it("toWeeks：非法日期跳过，空输入给空数组", () => {
    expect(toWeeks([])).toEqual([]);
    expect(toWeeks([day("not-a-date", 5)])).toEqual([]);
  });
});

describe("insights · 趋势补齐", () => {
  it("按 from/to 补齐缺失日期并补零", () => {
    const out = fillTrend(
      [day("2026-09-26", 2, { succeeded: 2 }), day("2026-09-28", 1, { failed: 1 })],
      "2026-09-26",
      "2026-09-29",
    );
    expect(out.map((d) => d.date)).toEqual([
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
    ]);
    expect(out[1]).toMatchObject({ total: 0, succeeded: 0 });
    expect(out[3]).toMatchObject({ total: 0 });
  });

  it("不给范围时按已出现日期的最小/最大补齐；空输入给空数组", () => {
    const out = fillTrend([day("2026-09-27", 1), day("2026-09-29", 1)], null, null);
    expect(out.map((d) => d.date)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29"]);
    expect(fillTrend([], null, null)).toEqual([]);
  });

  it("范围非法或过长时原样返回（不猜、不炸）", () => {
    const single = [day("2026-09-26", 1)];
    expect(fillTrend(single, "2026-09-30", "2026-09-01")).toEqual(single);
    expect(fillTrend(single, "bad", "worse")).toEqual(single);
    expect(fillTrend(single, "1900-01-01", "2026-09-26")).toEqual(single);
  });
});

describe("insights · 报告容错提取", () => {
  it("提取失败 check / 阻塞码 / 正数信号；非对象与坏值不抛错", () => {
    const fields = extractReportFields({
      startedAt: "2026-09-26T10:01:00.000Z",
      finishedAt: "2026-09-26T10:01:02.500Z",
      checks: [{ name: "typecheck", passed: false }, { name: "build", passed: true }],
      blockingIssues: [{ code: "VISUAL_BLOCKED" }],
      analysis: { signals: { consoleDebug: 3, todo: 0 } },
    });
    expect(fields.spanMs).toBe(2500);
    expect(fields.failedChecks).toEqual(["typecheck"]);
    expect(fields.blockingCodes).toEqual(["VISUAL_BLOCKED"]);
    expect(fields.signals).toEqual({ consoleDebug: 3 });
  });

  it("缺字段 / 类型不符 / 时间倒挂 → 安全默认", () => {
    expect(extractReportFields(null)).toEqual({
      spanMs: null,
      failedChecks: [],
      blockingCodes: [],
      signals: {},
    });
    const inverted = extractReportFields({
      startedAt: "2026-09-26T10:00:02Z",
      finishedAt: "2026-09-26T10:00:01Z",
    });
    expect(inverted.spanMs).toBeNull();
  });
});

describe("insights · 聚合镜像（与 Rust insights.rs 单测同数据同结论）", () => {
  const records: InsightRecord[] = [
    {
      status: "succeeded",
      roundsUsed: 1,
      agentId: "codex",
      projectPath: "D:/p1",
      createdAt: "2026-09-26T10:00:00Z",
      updatedAt: "2026-09-26T10:05:00Z",
      errorType: null,
      report: {
        spanMs: 2500,
        failedChecks: ["typecheck"],
        blockingCodes: ["VISUAL_BLOCKED"],
        signals: { consoleDebug: 3 },
      },
    },
    {
      status: "succeeded",
      roundsUsed: 3,
      agentId: "codex",
      projectPath: "D:/p1",
      createdAt: "2026-09-27T08:00:00Z",
      updatedAt: "2026-09-27T08:30:00Z",
      errorType: null,
      report: null,
    },
    {
      status: "failed",
      roundsUsed: 2,
      agentId: "zcode",
      projectPath: "D:/p2",
      createdAt: "2026-09-27T09:00:00Z",
      updatedAt: "2026-09-27T09:10:00Z",
      errorType: "timeout",
      report: null,
    },
    {
      status: "running",
      roundsUsed: 0,
      agentId: "zcode",
      projectPath: "D:/p2",
      createdAt: "2026-09-28T09:00:00Z",
      updatedAt: "2026-09-28T09:01:00Z",
      errorType: null,
      report: null,
    },
  ];

  const res = aggregateInsights(records, {
    from: null,
    to: null,
    agentId: null,
    projectPath: null,
  });

  it("汇总计数与求和", () => {
    expect(res.summary).toMatchObject({
      total: 4,
      succeeded: 2,
      failed: 1,
      active: 1,
      onePassCount: 1,
      roundsSum: 6,
      reportsPresent: 1,
      reportsMissing: 3,
      verifyMsSum: 2500,
      verifyMsCount: 1,
    });
    expect(res.scannedTasks).toBe(4);
    expect(res.scannedReports).toBe(0);
    expect(res.badReports).toBe(0);
  });

  it("Agent / 项目分组与按天桶", () => {
    expect(res.agents.map((g) => [g.key, g.summary.total, g.summary.succeeded])).toEqual([
      ["codex", 2, 2],
      ["zcode", 2, 0],
    ]);
    expect(res.projects).toHaveLength(2);
    expect(res.days.map((d) => [d.date, d.total, d.reworked])).toEqual([
      ["2026-09-26", 1, 0],
      ["2026-09-27", 2, 2],
      ["2026-09-28", 1, 0],
    ]);
  });

  it("四类归因齐全，且 0 值信号不计入", () => {
    const find = (kind: string, key: string) =>
      res.reasons.find((r) => r.kind === kind && r.key === key);
    expect(find("failedCheck", "typecheck")?.count).toBe(1);
    expect(find("blockingIssue", "VISUAL_BLOCKED")?.count).toBe(1);
    expect(find("signal", "consoleDebug")?.count).toBe(3);
    expect(find("errorType", "timeout")?.count).toBe(1);
    expect(res.reasons).toHaveLength(4);
  });

  it("筛选：按 agent / 时间范围，且 scannedTasks 是筛选前的访问量", () => {
    const byAgent = aggregateInsights(records, {
      from: null,
      to: null,
      agentId: "zcode",
      projectPath: null,
    });
    expect(byAgent.summary.total).toBe(2);
    expect(byAgent.summary.failed).toBe(1);
    expect(byAgent.scannedTasks).toBe(4);

    const byRange = aggregateInsights(records, {
      from: "2026-09-28T00:00:00Z",
      to: null,
      agentId: null,
      projectPath: null,
    });
    expect(byRange.summary.total, "只有 09-28 那条的 updatedAt 在起点之后").toBe(1);

    const noneInRange = aggregateInsights(records, {
      from: "2026-09-30T00:00:00Z",
      to: null,
      agentId: null,
      projectPath: null,
    });
    expect(noneInRange.summary.total).toBe(0);
    expect(noneInRange.scannedTasks, "被时间范围滤掉也仍计入 scannedTasks").toBe(4);
  });

  it("空集：全零且不抛错", () => {
    const empty = aggregateInsights([], { from: null, to: null, agentId: null, projectPath: null });
    expect(empty.summary.total).toBe(0);
    expect(empty.days).toEqual([]);
    expect(empty.agents).toEqual([]);
    expect(empty.scannedTasks).toBe(0);
  });
});
