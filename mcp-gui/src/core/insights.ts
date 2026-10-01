/**
 * 洞察聚合的纯函数层（A1 效能 / A2 归因 / A3 趋势）。
 *
 * 后端（Rust `insights.rs`）只给**计数与求和**；比率、TopN、趋势补齐、周历聚合都在这里——
 * 它们是可单测的纯逻辑，且不该把时区/展示判断塞进 Rust（计划 D4）。
 *
 * 口径（与 Rust 侧严格一致，改动必须两边同步）：
 * - 「一次通过」= `status === "succeeded"` 且 `roundsUsed <= 1`
 * - 「返修」= `roundsUsed > 1`（返修率 = `reworked / total`）
 * - 按天桶的日期 = `createdAt` 前 10 字符（**UTC 日期**，计划 D5）
 * - 按周以**周一**为一周之始（ISO-8601，计划 D13）
 * - 分母为 0 一律返回 `null`——**不编造 0%**
 */
import { ACTIVE_STATUSES } from "@/core/events";
import type {
  InsightsDay,
  InsightsGroup,
  InsightsReason,
  InsightsRequest,
  InsightsResult,
  InsightsSummary,
} from "@/api/types";

const DAY_MS = 86_400_000;
/** 趋势补齐的上限（防止异常范围把页面拖死） */
const MAX_TREND_DAYS = 366 * 3;

/* ---------------- 比率与排序 ---------------- */

/** 比率；分母 <= 0 时返回 `null`（不编造 0%） */
export function rate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

/** 均值；计数 <= 0 时返回 `null` */
export function avg(sum: number, count: number): number | null {
  if (!Number.isFinite(sum) || !Number.isFinite(count) || count <= 0) return null;
  return sum / count;
}

/** 返修率 = `reworked / total` */
export function reworkRate(bucket: Pick<InsightsDay, "total" | "reworked">): number | null {
  return rate(bucket.reworked, bucket.total);
}

/** 按 `count` 降序、`key` 升序（稳定、可预期）取前 N 条 */
export function topN(reasons: InsightsReason[], n: number): InsightsReason[] {
  const limit = Math.max(0, Math.trunc(n));
  return [...reasons]
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export type GroupSortKey = "total" | "successRate" | "key";

/** 分组排序：总量降序 / 成功率降序（无分母的排最后）/ key 升序 */
export function sortGroups(groups: InsightsGroup[], by: GroupSortKey): InsightsGroup[] {
  const copy = [...groups];
  copy.sort((a, b) => {
    if (by === "key") return a.key.localeCompare(b.key);
    if (by === "successRate") {
      const ra = rate(a.summary.succeeded, a.summary.total) ?? -1;
      const rb = rate(b.summary.succeeded, b.summary.total) ?? -1;
      return rb - ra || b.summary.total - a.summary.total || a.key.localeCompare(b.key);
    }
    return b.summary.total - a.summary.total || a.key.localeCompare(b.key);
  });
  return copy;
}

/* ---------------- 日期与周历（全部按 UTC） ---------------- */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

function dayToMs(date: string): number | null {
  const m = DAY_RE.exec(date);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(ms)) return null;
  // `Date.UTC` 会把 2 月 30 日归一化，必须反向校验
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== Number(m[1]) ||
    back.getUTCMonth() !== Number(m[2]) - 1 ||
    back.getUTCDate() !== Number(m[3])
  ) {
    return null;
  }
  return ms;
}

function msToDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 取 ISO 串的日期部分（`createdAt` 前 10 字符）；非法返回 `null` */
export function dayOf(iso: string): string | null {
  const head = iso.slice(0, 10);
  return dayToMs(head) === null ? null : head;
}

/**
 * 严格解析 `YYYY-MM-DDTHH:MM:SS(.sss)?Z` 为 epoch 毫秒（Rust `timestamps::parse_iso_ms` 的 TS 镜像）。
 * 仅接受 UTC（`Z` 结尾）；带偏移量的写法一律 `null`——不猜时区。
 */
export function parseUtcMillis(iso: string): number | null {
  const m = ISO_UTC_RE.exec(iso);
  if (!m) return null;
  const [, year, month, day, hour, minute, second, frac] = m;
  const ms = frac ? Number(frac.slice(0, 3).padEnd(3, "0")) : 0;
  const days = dayToMs(`${year}-${month}-${day}`);
  if (days === null) return null;
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);
  if (h > 23 || mi > 59 || s > 60) return null;
  return days + h * 3_600_000 + mi * 60_000 + s * 1_000 + ms;
}

/** 该日期所在周的**周一**（ISO-8601）；非法日期返回 `null` */
export function mondayOf(date: string): string | null {
  const ms = dayToMs(date);
  if (ms === null) return null;
  const dow = new Date(ms).getUTCDay(); // 0=周日 … 6=周六
  const backDays = (dow + 6) % 7; // 周一 → 0
  return msToDay(ms - backDays * DAY_MS);
}

/** 按天 → 按周聚合（周一为一周之始），输出按 `weekStart` 升序 */
export function toWeeks(days: InsightsDay[]): (InsightsDay & { weekStart: string })[] {
  const buckets = new Map<string, InsightsDay & { weekStart: string }>();
  for (const day of days) {
    const weekStart = mondayOf(day.date);
    if (weekStart === null) continue;
    const bucket = buckets.get(weekStart) ?? {
      weekStart,
      date: weekStart,
      total: 0,
      succeeded: 0,
      failed: 0,
      active: 0,
      reworked: 0,
    };
    bucket.total += day.total;
    bucket.succeeded += day.succeeded;
    bucket.failed += day.failed;
    bucket.active += day.active;
    bucket.reworked += day.reworked;
    buckets.set(weekStart, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/**
 * 趋势补齐：把 `[from, to]` 区间内缺失的日期补成 0，保证折线连续。
 * 两端缺省时退化为「已出现的日期范围」；范围非法或过长（> {@link MAX_TREND_DAYS}）时原样返回。
 */
export function fillTrend(days: InsightsDay[], from: string | null, to: string | null): InsightsDay[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return sorted;

  const startDay = from ? dayOf(from) : sorted[0]!.date;
  const endDay = to ? dayOf(to) : sorted[sorted.length - 1]!.date;
  const startMs = startDay === null ? null : dayToMs(startDay);
  const endMs = endDay === null ? null : dayToMs(endDay);
  if (startMs === null || endMs === null || endMs < startMs) return sorted;

  const span = Math.floor((endMs - startMs) / DAY_MS) + 1;
  if (span > MAX_TREND_DAYS) return sorted;

  const present = new Map(sorted.map((d) => [d.date, d]));
  const out: InsightsDay[] = [];
  for (let i = 0; i < span; i += 1) {
    const key = msToDay(startMs + i * DAY_MS);
    out.push(
      present.get(key) ?? { date: key, total: 0, succeeded: 0, failed: 0, active: 0, reworked: 0 },
    );
  }
  return out;
}

/* ---------------- mock 用的 TS 聚合镜像 ---------------- */

/** 一条任务的洞察输入（mock 侧从 fixtures 组装；字段与 Rust 侧读取的完全一致） */
export interface InsightRecord {
  status: string;
  roundsUsed: number;
  agentId: string;
  projectPath: string;
  /** `createdAt`（ISO 串） */
  createdAt: string;
  /** `updatedAt`（ISO 串，用于时间范围过滤，口径同 `list_tasks`） */
  updatedAt: string;
  errorType: string | null;
  /** 最新一轮报告的提取结果；`null` = 无报告或不可解析 */
  report: ReportInsightFields | null;
}

/** 报告里与洞察相关的字段（容错提取，缺失即空/`null`） */
export interface ReportInsightFields {
  /** `finishedAt - startedAt`（ms）；两端不可解析或为负 → `null` */
  spanMs: number | null;
  failedChecks: string[];
  blockingCodes: string[];
  /** 信号名 → 出现次数（仅保留 > 0） */
  signals: Record<string, number>;
}

/** 从已解析的报告 JSON 里容错提取洞察字段（纯函数；非对象一律给空值，不抛错） */
export function extractReportFields(report: unknown): ReportInsightFields {
  const out: ReportInsightFields = { spanMs: null, failedChecks: [], blockingCodes: [], signals: {} };
  if (!report || typeof report !== "object") return out;
  const rec = report as Record<string, unknown>;

  const started = typeof rec.startedAt === "string" ? parseUtcMillis(rec.startedAt) : null;
  const finished = typeof rec.finishedAt === "string" ? parseUtcMillis(rec.finishedAt) : null;
  if (started !== null && finished !== null && finished >= started) out.spanMs = finished - started;

  if (Array.isArray(rec.checks)) {
    for (const check of rec.checks) {
      if (!check || typeof check !== "object") continue;
      const c = check as Record<string, unknown>;
      if (c.passed === false && typeof c.name === "string" && c.name !== "") out.failedChecks.push(c.name);
    }
  }
  if (Array.isArray(rec.blockingIssues)) {
    for (const issue of rec.blockingIssues) {
      if (!issue || typeof issue !== "object") continue;
      const code = (issue as Record<string, unknown>).code;
      if (typeof code === "string" && code !== "") out.blockingCodes.push(code);
    }
  }
  const analysis = rec.analysis;
  const signals =
    analysis && typeof analysis === "object"
      ? (analysis as Record<string, unknown>).signals
      : undefined;
  if (signals && typeof signals === "object") {
    for (const [key, value] of Object.entries(signals as Record<string, unknown>)) {
      const seen = typeof value === "number" && Number.isFinite(value) ? value : 0;
      if (seen > 0) out.signals[key] = seen;
    }
  }
  return out;
}

export interface AggregateMeta {
  /** 访问过的任务目录数（筛选前）；缺省用 `records.length` */
  scannedTasks?: number;
  scannedReports?: number;
  badReports?: number;
}

/**
 * TS 侧聚合镜像（**仅供 mock 预览**；真源是 Rust `insights.rs`，两者口径必须一致）。
 * 实现刻意与 Rust 逐句对应，便于人工比对。
 */
export function aggregateInsights(
  records: InsightRecord[],
  req: Pick<InsightsRequest, "from" | "to" | "agentId" | "projectPath">,
  meta: AggregateMeta = {},
): InsightsResult {
  const summary = emptySummary();
  const agents = new Map<string, InsightsSummary>();
  const projects = new Map<string, InsightsSummary>();
  const days = new Map<string, InsightsDay>();
  const reasons = new Map<string, number>(); // key = `${kind}\u0000${key}`

  for (const rec of records) {
    if (!matchesRange(rec.updatedAt, req.from, req.to)) continue;
    if (!matchesOptional(rec.agentId, req.agentId)) continue;
    if (!matchesOptional(rec.projectPath, req.projectPath)) continue;

    applyRecord(summary, rec);
    const agentBucket = agents.get(rec.agentId) ?? emptySummary();
    applyRecord(agentBucket, rec);
    agents.set(rec.agentId, agentBucket);
    const projectBucket = projects.get(rec.projectPath) ?? emptySummary();
    applyRecord(projectBucket, rec);
    projects.set(rec.projectPath, projectBucket);

    const date = dayOf(rec.createdAt);
    if (date !== null) {
      const day = days.get(date) ?? {
        date,
        total: 0,
        succeeded: 0,
        failed: 0,
        active: 0,
        reworked: 0,
      };
      day.total += 1;
      if (isActive(rec.status)) day.active += 1;
      else if (rec.status === "succeeded") day.succeeded += 1;
      else if (rec.status === "failed") day.failed += 1;
      if (rec.roundsUsed > 1) day.reworked += 1;
      days.set(date, day);
    }

    if (rec.errorType) bumpReason(reasons, "errorType", rec.errorType, 1);
    if (rec.report) {
      for (const name of rec.report.failedChecks) bumpReason(reasons, "failedCheck", name, 1);
      for (const code of rec.report.blockingCodes) bumpReason(reasons, "blockingIssue", code, 1);
      for (const [signal, seen] of Object.entries(rec.report.signals)) {
        bumpReason(reasons, "signal", signal, seen);
      }
    }
  }

  return {
    summary,
    agents: toGroups(agents),
    projects: toGroups(projects),
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    reasons: [...reasons.entries()].map(([composite, count]) => {
      const [kind, key] = composite.split("\u0000");
      return { kind: kind as InsightsReason["kind"], key: key ?? "", count };
    }),
    scannedTasks: meta.scannedTasks ?? records.length,
    scannedReports: meta.scannedReports ?? 0,
    badReports: meta.badReports ?? 0,
  };
}

function emptySummary(): InsightsSummary {
  return {
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
  };
}

function isActive(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

function applyRecord(s: InsightsSummary, rec: InsightRecord): void {
  s.total += 1;
  s.roundsSum += rec.roundsUsed;

  if (isActive(rec.status)) s.active += 1;
  else if (rec.status === "succeeded") {
    s.succeeded += 1;
    if (rec.roundsUsed <= 1) s.onePassCount += 1;
  } else if (rec.status === "failed") s.failed += 1;
  else if (rec.status === "needs_attention") s.needsAttention += 1;
  else if (rec.status === "cancelled") s.cancelled += 1;
  else s.other += 1;

  if (!rec.report) {
    s.reportsMissing += 1;
    return;
  }
  s.reportsPresent += 1;
  if (rec.report.spanMs !== null) {
    s.verifyMsSum += rec.report.spanMs;
    s.verifyMsCount += 1;
  }
}

function bumpReason(map: Map<string, number>, kind: string, key: string, count: number): void {
  if (key === "") return;
  const composite = `${kind}\u0000${key}`;
  map.set(composite, (map.get(composite) ?? 0) + count);
}

function matchesRange(updatedAt: string, from: string | null, to: string | null): boolean {
  if (from && from !== "" && updatedAt < from) return false;
  if (to && to !== "" && updatedAt > to) return false;
  return true;
}

function matchesOptional(value: string, want: string | null): boolean {
  if (!want || want === "") return true;
  return value === want;
}

function toGroups(map: Map<string, InsightsSummary>): InsightsGroup[] {
  return [...map.entries()]
    .map(([key, summary]) => ({ key, summary }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
