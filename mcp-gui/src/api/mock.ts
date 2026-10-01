/**
 * Mock 数据出口：**不装 Rust / 不在桌面运行时**也能完整调 UI 与交互逻辑。
 *
 * 数据来自 `mcp-gui/fixtures/`（真实日志样本，已脱敏），在构建期被 Vite
 * 以 `?raw` 内联为字符串映射，因此浏览器预览与 node 单测都能零 IO 使用。
 *
 * 写操作（导出、安装更新）在 mock 下明确报错，**不假装成功**。
 */
import pkg from "../../package.json";
import { byteLength, sliceRangeByBytes, sliceTailByBytes } from "@/core/bytes";
import { classifyEvent, parseEventStream } from "@/core/events";
import {
  aggregateInsights,
  extractReportFields,
  type InsightRecord,
  type ReportInsightFields,
} from "@/core/insights";
import { DEFAULT_WINDOW_BYTES, planInitialWindow } from "@/core/tailwindow";
import { parseVersion } from "@/core/version";
import type { GuiApi } from "./gui-api";
import type {
  AppVersionInfo,
  ArtifactRounds,
  BaselineInfo,
  CheckUpdateResult,
  DataHomeState,
  DiskUsage,
  DiskUsageItem,
  ExportResult,
  InsightsResult,
  InstallUpdateResult,
  LogChunk,
  Preferences,
  ProbeSourceResult,
  ReadEventsResult,
  ReadReportResult,
  SearchFileGroup,
  SearchHit,
  SearchRequest,
  SearchResult,
  TaskEvent,
  TaskSummary,
} from "./types";

const RAW_FIXTURES = import.meta.glob("../../fixtures/**/*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** 相对 fixtures 根的文件映射（键统一为正斜杠） */
function buildFileMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(RAW_FIXTURES)) {
    const idx = key.indexOf("fixtures/");
    if (idx < 0) continue;
    map.set(key.slice(idx + "fixtures/".length), value);
  }
  return map;
}

export const MOCK_FILES: Map<string, string> = buildFileMap();

/** 预览模式下的虚拟数据目录（不指向真实磁盘） */
export const MOCK_HOME = "<预览数据目录>";

export const MOCK_APP_VERSION: string = pkg.version;

function emptyArtifacts(): ArtifactRounds {
  return {
    agentLogs: [],
    verifyLogs: [],
    reportMd: [],
    reportJson: [],
    reportHtml: [],
    dryRunMd: [],
    dryRunJson: [],
    hasBaseline: false,
    hasDryRunPlan: false,
  };
}

/** 与 Rust `BaselineInfo::default()` 同形：缺失 / 损坏一律「没有可用基线」 */
function emptyBaseline(): BaselineInfo {
  return {
    present: false,
    isRepo: false,
    head: null,
    dirty: false,
    dirtyFilesCount: 0,
    preExistingChangedCount: 0,
    preExistingUntrackedCount: 0,
    capturedAt: null,
    message: null,
  };
}

function collectArtifacts(taskId: string): ArtifactRounds {
  const a = emptyArtifacts();
  const prefix = `tasks/${taskId}/`;
  for (const rel of MOCK_FILES.keys()) {
    if (!rel.startsWith(prefix)) continue;
    const name = rel.slice(prefix.length);
    const m = /^(agent|verify|report|dry-run-report)-(\d+)\.(log|md|json|html)$/.exec(name);
    if (m) {
      const kind = m[1] ?? "";
      const round = Number(m[2] ?? "0");
      const ext = m[3] ?? "";
      if (kind === "agent" && ext === "log") a.agentLogs.push(round);
      else if (kind === "verify" && ext === "log") a.verifyLogs.push(round);
      else if (kind === "report" && ext === "md") a.reportMd.push(round);
      else if (kind === "report" && ext === "json") a.reportJson.push(round);
      else if (kind === "report" && ext === "html") a.reportHtml.push(round);
      else if (kind === "dry-run-report" && ext === "md") a.dryRunMd.push(round);
      else if (kind === "dry-run-report" && ext === "json") a.dryRunJson.push(round);
      continue;
    }
    if (name === "baseline.json") a.hasBaseline = true;
    if (name === "dry-run-plan.md") a.hasDryRunPlan = true;
  }
  for (const key of ["agentLogs", "verifyLogs", "reportMd", "reportJson", "reportHtml", "dryRunMd", "dryRunJson"] as const) {
    a[key].sort((x, y) => x - y);
  }
  return a;
}

function toSummary(taskId: string, raw: string): TaskSummary | null {
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (k: string): string => (typeof meta[k] === "string" ? (meta[k] as string) : "");
  const num = (k: string): number | null =>
    typeof meta[k] === "number" && Number.isFinite(meta[k]) ? (meta[k] as number) : null;
  return {
    taskId,
    status: str("status"),
    workspaceMode: str("workspaceMode") || "project",
    projectPath: str("projectPath"),
    displayPath: str("displayPath"),
    agentId: str("agentId"),
    task: str("task"),
    roundsUsed: num("roundsUsed") ?? 0,
    reportRound: num("reportRound"),
    createdAt: str("createdAt"),
    updatedAt: str("updatedAt"),
    finishedAt: typeof meta.finishedAt === "string" ? meta.finishedAt : null,
    lastMessage: typeof meta.lastMessage === "string" ? meta.lastMessage : null,
    dryRun: meta.dryRun === true,
    errorType: typeof meta.errorType === "string" ? meta.errorType : null,
    checkSummary: typeof meta.checkSummary === "string" ? meta.checkSummary : null,
    diffstat: typeof meta.diffstat === "string" ? meta.diffstat : null,
    changedFiles: Array.isArray(meta.changedFiles)
      ? meta.changedFiles.filter((x): x is string => typeof x === "string")
      : [],
    dataHome: MOCK_HOME,
    artifacts: collectArtifacts(taskId),
  };
}

let activeHome = MOCK_HOME;
const extraHomes: string[] = [];

function homeState(): DataHomeState {
  return {
    detected: MOCK_HOME,
    active: activeHome,
    entries: [
      { path: MOCK_HOME, label: MOCK_HOME, valid: true, message: "" },
      ...extraHomes.map((p) => ({ path: p, label: p, valid: true, message: "" })),
    ],
  };
}

const PREF_KEY = "tianshu-mcp-logs.preferences";

/** 预览模式下「可用的新版本」：当前版本的 patch + 1（永不追平自己） */
function mockAvailableVersion(): string {
  const p = parseVersion(MOCK_APP_VERSION);
  if (!p) return "9.9.9";
  return `${p.major}.${p.minor}.${p.patch + 1}`;
}

/**
 * 预览模式下用于演示「更新日志面板」的 release 正文（Markdown）。
 * 刻意包含标题 / 列表 / 行内代码，便于在预览里核对 Markdown 渲染确实生效。
 */
const MOCK_RELEASE_NOTES = [
  `## Tianshu-mcp 日志台 ${mockAvailableVersion()}（预览数据）`,
  "",
  "本页面在**本地预览（mock）**下展示，用于核对更新日志面板的排版与交互。",
  "",
  "### 新增",
  "",
  "- 启动静默检查到新版本时，弹出更新窗口",
  "- 窗口内提供 **立即更新** / **忽略此版本** / **稍后** 三个动作",
  "- 显式展示本次将使用的更新源（Gitee / GitHub）与实际探测结果",
  "",
  "### 已知限制",
  "",
  "- 预览模式不执行真实下载与安装（点「立即更新」会明确报错）",
].join("\n");

function defaultPreferences(): Preferences {
  return {
    language: "zh-CN",
    theme: "system",
    updateSource: "auto",
    dataHomes: [],
    lastGoodUpdateSource: null,
    closeAction: "tray",
    ignoredUpdateVersion: null,
  };
}

function loadPreferences(): Preferences {
  try {
    const raw = globalThis.localStorage?.getItem(PREF_KEY);
    if (!raw) return defaultPreferences();
    return { ...defaultPreferences(), ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return defaultPreferences();
  }
}

function savePreferences(prefs: Preferences): void {
  try {
    globalThis.localStorage?.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    // 预览模式无持久化能力时静默忽略（不影响 UI 调试）
  }
}

function relPathOfLog(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function readWhole(relPath: string): string | null {
  const rel = relPathOfLog(relPath);
  return MOCK_FILES.get(rel) ?? null;
}

function logChunk(relPath: string, mode: "tail" | "before", loadedFrom: number | undefined, windowBytes: number | undefined): LogChunk {
  const rel = relPathOfLog(relPath);
  const text = MOCK_FILES.get(rel) ?? "";
  const win = windowBytes ?? DEFAULT_WINDOW_BYTES;
  if (mode === "tail") {
    const initial = planInitialWindow(byteLength(text), win);
    const slice = sliceRangeByBytes(text, initial.from, initial.to);
    return {
      text: slice.text,
      relPath: rel,
      absolutePath: `${MOCK_HOME}/${rel}`,
      fromByte: slice.fromByte,
      toByte: slice.toByte,
      loadedFrom: slice.fromByte,
      loadedTo: slice.toByte,
      totalBytes: slice.totalBytes,
    };
  }
  const from = Math.max(0, (loadedFrom ?? 0) - win);
  const to = loadedFrom ?? 0;
  const slice = sliceRangeByBytes(text, from, to);
  return {
    text: slice.text,
    relPath: rel,
    absolutePath: `${MOCK_HOME}/${rel}`,
    fromByte: slice.fromByte,
    toByte: slice.toByte,
    loadedFrom: slice.fromByte,
    loadedTo: loadedFrom ?? slice.toByte,
    totalBytes: slice.totalBytes,
  };
}

function scanFiles(pred: (rel: string) => boolean): string[] {
  return [...MOCK_FILES.keys()].filter(pred);
}

function searchOneFile(rel: string, req: SearchRequest): SearchFileGroup | null {
  const text = MOCK_FILES.get(rel) ?? "";
  const needle = req.caseSensitive ? req.keyword : req.keyword.toLowerCase();
  const hits: SearchHit[] = [];
  let truncated = false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const hay = req.caseSensitive ? line : line.toLowerCase();
    const at = hay.indexOf(needle);
    if (at < 0) continue;
    if (hits.length >= req.maxHitsPerFile) {
      truncated = true;
      break;
    }
    const start = Math.max(0, at - 40);
    const end = Math.min(line.length, at + needle.length + 40);
    hits.push({
      relPath: rel,
      line: i + 1,
      text: line,
      snippet: `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`,
    });
  }
  if (hits.length === 0) return null;
  const m = /^tasks\/([^/]+)\//.exec(rel);
  return { taskId: m ? (m[1] ?? null) : null, relPath: rel, hits, truncated };
}

export const mockApi: GuiApi = {
  getAppVersion: async (): Promise<AppVersionInfo> => ({
    version: MOCK_APP_VERSION,
    updaterConfigured: false,
  }),

  getDataHomeState: async () => homeState(),

  addDataHome: async (path) => {
    const normalized = path.trim();
    if (normalized && normalized !== MOCK_HOME && !extraHomes.includes(normalized)) {
      extraHomes.push(normalized);
    }
    return homeState();
  },

  removeDataHome: async (path) => {
    const i = extraHomes.indexOf(path);
    if (i >= 0) extraHomes.splice(i, 1);
    if (activeHome === path) activeHome = MOCK_HOME;
    return homeState();
  },

  setActiveDataHome: async (path) => {
    activeHome = path || MOCK_HOME;
    return homeState();
  },

  pickDirectory: async () => null,
  pickSavePath: async () => null,

  listTasks: async (req) => {
    void req;
    const out: TaskSummary[] = [];
    for (const rel of scanFiles((r) => /^tasks\/[^/]+\/task\.json$/.test(r))) {
      const m = /^tasks\/([^/]+)\/task\.json$/.exec(rel);
      const taskId = m?.[1];
      if (!taskId) continue;
      const summary = toSummary(taskId, MOCK_FILES.get(rel) ?? "");
      if (summary) out.push(summary);
    }
    return out;
  },

  /**
   * 预览下的洞察聚合：**口径镜像 Rust `insights.rs`**（只认 tsk_/vfy_ 前缀、最新一轮报告、
   * 四类归因、UTC 日期桶），实现在 `@/core/insights` 的 `aggregateInsights`。
   * 真源是 Rust 侧——两者必须同步，改一处要改两处。
   */
  getInsights: async (req): Promise<InsightsResult> => {
    const records: InsightRecord[] = [];
    let scannedTasks = 0;
    let scannedReports = 0;
    let badReports = 0;

    for (const rel of MOCK_FILES.keys()) {
      const m = /^tasks\/((?:tsk_|vfy_)[^/]*)\/task\.json$/.exec(rel);
      if (!m) continue;
      scannedTasks += 1;
      const taskId = m[1] ?? "";
      const summary = toSummary(taskId, MOCK_FILES.get(rel) ?? "");
      if (!summary) continue;

      // 与 Rust 同口径：优先快照的 reportRound，否则取产物里最大的 report-<r>.json
      const round =
        summary.reportRound !== null && summary.reportRound >= 0
          ? summary.reportRound
          : summary.artifacts.reportJson.length > 0
            ? Math.max(...summary.artifacts.reportJson)
            : null;

      let report: ReportInsightFields | null = null;
      if (round !== null) {
        const raw = MOCK_FILES.get(`tasks/${taskId}/report-${round}.json`);
        if (raw !== undefined) {
          scannedReports += 1;
          try {
            report = extractReportFields(JSON.parse(raw) as unknown);
          } catch {
            // 坏报告只计数（与 Rust 一致），不让它毁掉整页
            badReports += 1;
          }
        }
      }

      records.push({
        status: summary.status,
        roundsUsed: summary.roundsUsed,
        agentId: summary.agentId,
        projectPath: summary.projectPath,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        errorType: summary.errorType,
        report,
      });
    }

    return aggregateInsights(records, req, { scannedTasks, scannedReports, badReports });
  },

  /** A5：从 fixtures 读 `baseline.json`（缺失即 `present = false`，与 Rust 同口径） */
  readBaseline: async (req): Promise<BaselineInfo> => {
    const raw = MOCK_FILES.get(`tasks/${req.taskId}/baseline.json`);
    if (raw === undefined) return emptyBaseline();
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const str = (k: string): string | null => (typeof parsed[k] === "string" ? (parsed[k] as string) : null);
      const count = (k: string): number => {
        const value = parsed[k];
        if (Array.isArray(value)) return value.length;
        return typeof value === "number" && Number.isFinite(value) ? value : 0;
      };
      return {
        present: true,
        isRepo: parsed.isRepo === true,
        head: str("head"),
        dirty: parsed.dirty === true,
        dirtyFilesCount: count("dirtyFiles"),
        preExistingChangedCount: count("preExistingChanged"),
        preExistingUntrackedCount: count("preExistingUntracked"),
        capturedAt: str("capturedAt"),
        message: str("message"),
      };
    } catch {
      // 基线损坏：如实当「没有可用基线」，不编造零值
      return emptyBaseline();
    }
  },

  /**
   * A9：用 fixtures 文件体积统计（**口径镜像 Rust `diskscan.rs`**：只统计 `logs/` 与 `tasks/<目录>/`,
   * 不按 `tsk_`/`vfy_` 前缀过滤，`top_tasks` 只取任务目录前 20）。
   */
  scanDiskUsage: async (): Promise<DiskUsage> => {
    const logsText = MOCK_FILES.get("logs/server.log") ?? "";
    const logsBytes = byteLength(logsText);

    const byDir = new Map<string, DiskUsageItem>();
    for (const [rel, text] of MOCK_FILES.entries()) {
      const m = /^tasks\/([^/]+)\//.exec(rel);
      if (!m) continue;
      const taskId = m[1] ?? "";
      const name = rel.slice(`tasks/${taskId}/`.length);
      if (name.includes("/")) continue;
      const item =
        byDir.get(taskId) ??
        ({
          taskId,
          relPath: `tasks/${taskId}`,
          bytes: 0,
          files: 0,
          heaviest: null,
          heaviestRatio: 0,
        } satisfies DiskUsageItem);
      const bytes = byteLength(text);
      item.bytes += bytes;
      item.files += 1;
      if (item.heaviest === null || bytes > item.heaviest.bytes) item.heaviest = { name, bytes };
      byDir.set(taskId, item);
    }

    const items = [...byDir.values()].map((item) => ({
      ...item,
      heaviestRatio: item.bytes > 0 && item.heaviest ? item.heaviest.bytes / item.bytes : 0,
    }));
    const tasksBytes = items.reduce((sum, item) => sum + item.bytes, 0);
    const topTasks = items
      .slice()
      .sort((a, b) => b.bytes - a.bytes || a.relPath.localeCompare(b.relPath))
      .slice(0, 20);

    return {
      totalBytes: tasksBytes + logsBytes,
      logsBytes,
      tasksBytes,
      topTasks,
      scannedDirs: items.length,
    };
  },

  /** A8b：预览模式没有系统协议注册，如实返回空队列（不假装收到深链） */
  takePendingDeepLinks: async () => [],

  /** A8b：预览模式无深链信号；返回空取消函数（调用方按同一份代码处理两种运行时） */
  onDeepLink: async () => () => {},

  readEvents: async (req): Promise<ReadEventsResult> => {
    const rel = `tasks/${req.taskId}/task.jsonl`;
    const text = MOCK_FILES.get(rel) ?? "";
    // `full` 时给全文（阶段甘特用）；缺省仍走尾部窗口，与 Rust 侧同口径
    const sliced = req.full
      ? { text, totalBytes: byteLength(text), fromByte: 0, toByte: byteLength(text) }
      : sliceTailByBytes(text, req.windowBytes ?? DEFAULT_WINDOW_BYTES);
    const parsed = parseEventStream(sliced.text);
    const events: TaskEvent[] = parsed.events;
    return {
      events: req.limit && req.limit > 0 ? events.slice(-req.limit) : events,
      totalBytes: sliced.totalBytes,
      loadedFrom: sliced.fromByte,
      loadedTo: sliced.toByte,
      badLines: parsed.badLines,
      loadedCount: events.length,
    };
  },

  readLog: async (req) => logChunk(req.relPath, req.mode, req.loadedFrom, req.windowBytes),

  readReport: async (req): Promise<ReadReportResult> => {
    const rel =
      req.kind === "dry-run-md"
        ? `tasks/${req.taskId}/dry-run-report-${req.round}.md`
        : req.kind === "dry-run-json"
          ? `tasks/${req.taskId}/dry-run-report-${req.round}.json`
          : `tasks/${req.taskId}/report-${req.round}.${req.kind}`;
    const text = MOCK_FILES.get(rel);
    return {
      relPath: rel,
      absolutePath: `${MOCK_HOME}/${rel}`,
      text: text ?? "",
      missing: text === undefined,
    };
  },

  exportFile: async (): Promise<ExportResult> => {
    throw new Error("本地预览模式不支持导出（请在桌面应用中操作）");
  },

  exportTaskZip: async (): Promise<ExportResult> => {
    throw new Error("本地预览模式不支持导出（请在桌面应用中操作）");
  },

  searchAll: async (req): Promise<SearchResult> => {
    if (!req.keyword.trim()) {
      return { groups: [], scannedFiles: 0, totalHits: 0, cancelled: false };
    }
    const groups: SearchFileGroup[] = [];
    let scannedFiles = 0;
    let totalHits = 0;
    for (const rel of MOCK_FILES.keys()) {
      const isEvent = /^tasks\/[^/]+\/task\.jsonl$/.test(rel);
      const isAgentLog = /^tasks\/[^/]+\/agent-\d+\.log$/.test(rel);
      const isVerifyLog = /^tasks\/[^/]+\/verify-\d+\.log$/.test(rel);
      const isReport = /^tasks\/[^/]+\/report-\d+\.(md|json)$/.test(rel);
      const isServerLog = rel === "logs/server.log";
      const inScope =
        (isEvent && req.scope.eventStream) ||
        (isAgentLog && req.scope.agentLogs) ||
        (isVerifyLog && req.scope.verifyLogs) ||
        (isReport && req.scope.reports) ||
        (isServerLog && req.scope.serverLog);
      if (!inScope) continue;
      scannedFiles += 1;
      const group = searchOneFile(rel, req);
      if (group) {
        groups.push(group);
        totalHits += group.hits.length;
      }
    }
    return { groups, scannedFiles, totalHits, cancelled: false };
  },

  searchCancel: async () => {},

  probeUpdateSources: async (): Promise<ProbeSourceResult> => ({
    gitee: { reachable: false, latencyMs: null },
    github: { reachable: false, latencyMs: null },
    picked: "github",
    cached: false,
    degraded: true,
  }),

  // 预览模式下如实返回「有可用更新」：否则更新日志面板在预览里无从调试。
  // 安装仍会明确报错——mock 不假装能安装（见 installUpdate）。
  checkUpdate: async (source: string): Promise<CheckUpdateResult> => ({
    available: true,
    currentVersion: MOCK_APP_VERSION,
    version: mockAvailableVersion(),
    notes: MOCK_RELEASE_NOTES,
    source: source === "gitee" ? "gitee" : "github",
    // 与 Rust 侧同语义：兜底入口跟随本次实际使用的源（未知源回退 GitHub）
    manualDownloadUrl:
      source === "gitee"
        ? "https://gitee.com/lan0811/tianshu-mcp/releases"
        : "https://github.com/lanlan0811/tianshu-mcp/releases",
    error: null,
  }),

  installUpdate: async (): Promise<InstallUpdateResult> => {
    throw new Error("本地预览模式不支持安装更新");
  },

  // 浏览器预览下确实能打开外部链接，故如实实现（新窗口 + noopener）
  openExternal: async (url: string): Promise<void> => {
    window.open(url, "_blank", "noopener,noreferrer");
  },

  getPreferences: async () => loadPreferences(),
  setPreferences: async (prefs) => savePreferences(prefs),

  watchStart: async () => {},
  watchStop: async () => {},
};

/** 导出给单测使用：确保 fixtures 被正确打包 */
export function fixtureFileCount(): number {
  return MOCK_FILES.size;
}

/** 导出给单测使用：事件分类口径需与后端一致 */
export const mockInternals = { classifyEvent, readWhole };