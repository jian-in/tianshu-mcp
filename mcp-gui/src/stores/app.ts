/**
 * 应用主状态（三栏数据、各 Tab 内容、搜索与更新）。
 *
 * 所有取数一律经 `@/api` 出口；本模块不直接访问文件系统与 Tauri。
 */
import { computed, reactive } from "vue";
import { api, isMockRuntime } from "@/api";
import type {
  BaselineInfo,
  CheckUpdateResult,
  DataHomeState,
  DiskUsage,
  InsightsResult,
  LogChunk,
  ProbeSourceResult,
  SearchRequest,
  SearchResult,
  SortDir,
  SortKey,
  TaskEvent,
  TaskFilter,
  TaskSummary,
} from "@/api/types";
import { emptyLogFilter, type LogFilter } from "@/core/logline";
import { emptyFilter, facetValues, filterTasks, sortTasks } from "@/core/filter";
import { firstDeepLinkTarget, parseDeepLink, type DeepLinkTarget } from "@/core/deeplink";
import { nextCompareSelection } from "@/core/insights";
import { summarizeReport, type ReportSummary } from "@/core/report";
import { DEFAULT_WINDOW_BYTES } from "@/core/tailwindow";
import { shouldPrompt } from "@/core/version";
import { preferences, updatePreferences } from "@/stores/preferences";

export type TabKey =
  | "events"
  | "agentLogs"
  | "verifyLogs"
  | "reports"
  | "baseline"
  | "serverLog"
  | "search";
export type ReportKind = "md" | "json" | "html" | "dry-run-md" | "dry-run-json";

export interface SearchState {
  keyword: string;
  caseSensitive: boolean;
  scope: SearchRequest["scope"];
  result: SearchResult | null;
  running: boolean;
  scanned: number;
}

export interface UpdateState {
  currentVersion: string;
  updaterConfigured: boolean;
  checking: boolean;
  installing: boolean;
  probe: ProbeSourceResult | null;
  result: CheckUpdateResult | null;
  /** 更新日志面板是否打开（手动检查一律打开；启动静默检查仅在「未被忽略」时打开） */
  dialogOpen: boolean;
}

/** 洞察页状态（**不实时监听**，见计划 D12：进页加载 + 手动刷新 + 切目录重载） */
export interface InsightsState {
  data: InsightsResult | null;
  loading: boolean;
  /** 时间范围（按 `updatedAt`，ISO 串；null = 不限） */
  from: string | null;
  to: string | null;
  /** A4 多任务对比：已勾选的任务 ID（按勾选先后顺序，最多 4 个） */
  compareIds: string[];
  /** A4：`taskId → 最新报告摘要`；`null` = 已尝试读取但报告缺失或不可解析 */
  compareReports: Record<string, ReportSummary | null>;
  compareLoading: boolean;
}

const EMPTY_HOME: DataHomeState = { detected: "", active: "", entries: [] };

export const app = reactive({
  ready: false,
  dataHome: EMPTY_HOME as DataHomeState,
  tasks: [] as TaskSummary[],
  tasksLoading: false,
  filter: emptyFilter() as TaskFilter,
  sortKey: "updatedAt" as SortKey,
  sortDir: "desc" as SortDir,
  selectedTaskId: null as string | null,
  tab: "events" as TabKey,
  error: null as string | null,

  // 事件流
  events: [] as TaskEvent[],
  eventsBadLines: 0,
  eventsLoadedFrom: 0,
  eventsLoadedTo: 0,
  eventsTotalBytes: 0,
  eventsWindowBytes: DEFAULT_WINDOW_BYTES,
  eventsLoading: false,

  // 事件流**全量**（A6 阶段甘特：按需读取，同一任务只读一次）
  eventsFull: [] as TaskEvent[],
  eventsFullTaskId: null as string | null,
  eventsFullBadLines: 0,
  eventsFullLoading: false,

  // A5 基线漂移（按任务读取）
  baseline: null as BaselineInfo | null,
  baselineLoading: false,

  // A9 磁盘占用（只读统计）
  disk: null as DiskUsage | null,
  diskLoading: false,

  // 原始日志（agent-* / verify-* / server.log 共用）
  logRelPath: "",
  logText: "",
  logChunk: null as LogChunk | null,
  logFilter: emptyLogFilter() as LogFilter,
  logShowLineNumbers: true,
  logWrap: false,
  logFollow: true,
  logLoading: false,

  // 报告
  reportKind: "md" as ReportKind,
  reportRound: 0,
  reportText: "",
  reportMissing: false,
  reportLoading: false,
  compareOn: false,
  compareLeftRound: 0,
  compareRightRound: 0,

  search: {
    keyword: "",
    caseSensitive: false,
    scope: {
      eventStream: true,
      agentLogs: true,
      verifyLogs: true,
      reports: true,
      serverLog: true,
    },
    result: null,
    running: false,
    scanned: 0,
  } as SearchState,

  update: {
    currentVersion: "",
    updaterConfigured: false,
    checking: false,
    installing: false,
    probe: null,
    result: null,
    dialogOpen: false,
  } as UpdateState,

  insights: {
    data: null,
    loading: false,
    from: null,
    to: null,
    compareIds: [],
    compareReports: {},
    compareLoading: false,
  } as InsightsState,
});

export const visibleTasks = computed(() =>
  sortTasks(filterTasks(app.tasks, app.filter), app.sortKey, app.sortDir),
);

export const taskFacets = computed(() => facetValues(app.tasks));

export const selectedTask = computed(
  () => app.tasks.find((t) => t.taskId === app.selectedTaskId) ?? null,
);

export function setError(err: unknown): void {
  app.error = err instanceof Error ? err.message : String(err);
}

export function clearError(): void {
  app.error = null;
}

/* ---------------- 数据目录 ---------------- */

export async function refreshDataHome(): Promise<void> {
  try {
    app.dataHome = await api.getDataHomeState();
    app.error = null;
  } catch (err) {
    setError(err);
  }
}

export async function setActiveDataHome(path: string): Promise<void> {
  try {
    app.dataHome = await api.setActiveDataHome(path);
    app.selectedTaskId = null;
    // 换目录后以下缓存都失效（它们属于旧目录的任务）
    clearCompareTasks();
    clearTaskScopedCaches();
    await refreshTasks();
    // 已加载过洞察时切目录要重载（D12：不做实时监听，但切目录必须跟着变）
    if (app.insights.data) await loadInsights();
  } catch (err) {
    setError(err);
  }
}

/** 清掉「属于某个任务 / 某次扫描」的缓存：基线、全量事件、磁盘占用 */
function clearTaskScopedCaches(): void {
  app.baseline = null;
  app.eventsFull = [];
  app.eventsFullTaskId = null;
  app.eventsFullBadLines = 0;
  app.disk = null;
}

export async function addDataHome(): Promise<void> {
  try {
    const picked = await api.pickDirectory();
    if (!picked) return;
    app.dataHome = await api.addDataHome(picked);
    await refreshTasks();
  } catch (err) {
    setError(err);
  }
}

export async function removeDataHome(path: string): Promise<void> {
  try {
    app.dataHome = await api.removeDataHome(path);
    await refreshTasks();
  } catch (err) {
    setError(err);
  }
}

/* ---------------- 任务列表 ---------------- */

export async function refreshTasks(): Promise<void> {
  app.tasksLoading = true;
  try {
    app.tasks = await api.listTasks({
      dataHome: app.dataHome.active,
      filter: app.filter,
      sortKey: app.sortKey,
      sortDir: app.sortDir,
    });
    app.error = null;
    if (app.selectedTaskId && !app.tasks.some((t) => t.taskId === app.selectedTaskId)) {
      app.selectedTaskId = null;
    }
    // 对比勾选只保留仍存在的任务（否则上限会被幽灵项占满）
    app.insights.compareIds = app.insights.compareIds.filter((id) =>
      app.tasks.some((t) => t.taskId === id),
    );
    if (!app.selectedTaskId && app.tasks.length > 0) {
      await selectTask(app.tasks[0]?.taskId ?? null);
    }
  } catch (err) {
    setError(err);
  } finally {
    app.tasksLoading = false;
  }
}

export async function selectTask(taskId: string | null): Promise<void> {
  app.selectedTaskId = taskId;
  if (!taskId) return;
  await openTab(app.tab);
}

export async function openTab(tab: TabKey): Promise<void> {
  app.tab = tab;
  const task = selectedTask.value;
  if (!task) return;
  switch (tab) {
    case "events":
      await loadEvents(true);
      break;
    case "agentLogs":
      await openRoundLog("agent", pickRound(task.artifacts.agentLogs));
      break;
    case "verifyLogs":
      await openRoundLog("verify", pickRound(task.artifacts.verifyLogs));
      break;
    case "reports":
      await openReport(currentReportRound(), app.reportKind);
      break;
    case "baseline":
      await loadBaseline();
      break;
    case "serverLog":
      await openLog("logs/server.log");
      break;
    case "search":
    default:
      break;
  }
}

function pickRound(rounds: number[]): number | null {
  if (rounds.length === 0) return null;
  return rounds[rounds.length - 1] ?? null;
}

function currentReportRound(): number {
  const task = selectedTask.value;
  if (!task) return 0;
  if (app.reportKind.startsWith("dry-run")) {
    return pickRound(task.artifacts.dryRunMd) ?? 0;
  }
  return task.reportRound ?? pickRound(task.artifacts.reportMd) ?? 0;
}

/* ---------------- 事件流 ---------------- */

export async function loadEvents(reset: boolean): Promise<void> {
  const taskId = app.selectedTaskId;
  if (!taskId) return;
  if (reset) {
    app.eventsWindowBytes = DEFAULT_WINDOW_BYTES;
  }
  app.eventsLoading = true;
  try {
    const res = await api.readEvents({
      dataHome: app.dataHome.active,
      taskId,
      windowBytes: app.eventsWindowBytes,
    });
    app.events = res.events;
    app.eventsBadLines = res.badLines;
    app.eventsLoadedFrom = res.loadedFrom;
    app.eventsLoadedTo = res.loadedTo;
    app.eventsTotalBytes = res.totalBytes;
    app.error = null;
  } catch (err) {
    setError(err);
  } finally {
    app.eventsLoading = false;
  }
}

export async function loadMoreEvents(): Promise<void> {
  if (app.eventsLoadedFrom <= 0) return;
  app.eventsWindowBytes = app.eventsWindowBytes * 4;
  await loadEvents(false);
}

/**
 * A6 阶段甘特：按需读**全量**事件（`full = true`）。
 * 同一任务**只读一次**（切换任务后允许重读）；工具栏的「刷新」会清掉缓存再读。
 */
export async function loadEventsFull(): Promise<void> {
  const taskId = app.selectedTaskId;
  if (!taskId) return;
  if (app.eventsFullTaskId === taskId) return;
  app.eventsFullLoading = true;
  try {
    const res = await api.readEvents({
      dataHome: app.dataHome.active,
      taskId,
      full: true,
    });
    app.eventsFull = res.events;
    app.eventsFullBadLines = res.badLines;
    app.eventsFullTaskId = taskId;
    app.error = null;
  } catch (err) {
    setError(err);
  } finally {
    app.eventsFullLoading = false;
  }
}

/** 丢弃全量事件缓存（下次进入阶段视图会重新读取） */
export function invalidateEventsFull(): void {
  app.eventsFull = [];
  app.eventsFullTaskId = null;
  app.eventsFullBadLines = 0;
}

/* ---------------- A5 基线漂移 ---------------- */

/** 读取当前任务的动工前基线；**没有基线不是错误**（`present = false` 由界面如实提示） */
export async function loadBaseline(): Promise<void> {
  const taskId = app.selectedTaskId;
  if (!taskId) {
    app.baseline = null;
    return;
  }
  app.baselineLoading = true;
  try {
    app.baseline = await api.readBaseline({ dataHome: app.dataHome.active, taskId });
    app.error = null;
  } catch (err) {
    setError(err);
  } finally {
    app.baselineLoading = false;
  }
}

/* ---------------- A9 磁盘占用 ---------------- */

/** 扫描产物磁盘占用（**只读统计，不删任何文件**）；进入复盘分区 / 手动刷新时调用 */
export async function loadDiskUsage(): Promise<void> {
  app.diskLoading = true;
  try {
    app.disk = await api.scanDiskUsage({ dataHome: app.dataHome.active });
    app.error = null;
  } catch (err) {
    setError(err);
  } finally {
    app.diskLoading = false;
  }
}

/* ---------------- 原始日志 ---------------- */

export async function openRoundLog(kind: "agent" | "verify", round: number | null): Promise<void> {
  const taskId = app.selectedTaskId;
  if (!taskId || round === null) {
    app.logRelPath = "";
    app.logText = "";
    app.logChunk = null;
    return;
  }
  await openLog(`tasks/${taskId}/${kind}-${round}.log`);
}

export async function openLog(relPath: string): Promise<void> {
  app.logRelPath = relPath;
  app.logLoading = true;
  try {
    const chunk = await api.readLog({
      dataHome: app.dataHome.active,
      relPath,
      mode: "tail",
      windowBytes: DEFAULT_WINDOW_BYTES,
    });
    app.logChunk = chunk;
    app.logText = chunk.text;
    app.error = null;
  } catch (err) {
    setError(err);
  } finally {
    app.logLoading = false;
  }
}

export async function loadMoreLog(): Promise<void> {
  const chunk = app.logChunk;
  if (!chunk || chunk.loadedFrom <= 0) return;
  app.logLoading = true;
  try {
    const before = await api.readLog({
      dataHome: app.dataHome.active,
      relPath: app.logRelPath,
      mode: "before",
      loadedFrom: chunk.loadedFrom,
      windowBytes: DEFAULT_WINDOW_BYTES,
    });
    app.logChunk = {
      ...chunk,
      loadedFrom: before.loadedFrom,
      totalBytes: before.totalBytes,
    };
    app.logText = before.text + app.logText;
    app.error = null;
  } catch (err) {
    setError(err);
  } finally {
    app.logLoading = false;
  }
}

/** 实时增量：把新追加的尾部内容合并进来（跟随开启时才自动滚底，见组件） */
export async function applyLogGrowth(totalBytes: number): Promise<void> {
  const chunk = app.logChunk;
  if (!chunk || totalBytes <= chunk.loadedTo) return;
  try {
    const fresh = await api.readLog({
      dataHome: app.dataHome.active,
      relPath: app.logRelPath,
      mode: "tail",
      windowBytes: Math.max(DEFAULT_WINDOW_BYTES, totalBytes - chunk.loadedTo + 4096),
    });
    if (fresh.text.length > 0) {
      app.logText = app.logText + fresh.text;
      app.logChunk = { ...chunk, loadedTo: fresh.toByte, totalBytes: fresh.totalBytes };
    }
  } catch {
    // 实时增量失败不打断阅读（下次事件会重试）
  }
}

/* ---------------- 报告 ---------------- */

export async function openReport(round: number, kind: ReportKind): Promise<void> {
  const taskId = app.selectedTaskId;
  if (!taskId) return;
  app.reportRound = round;
  app.reportKind = kind;
  app.reportLoading = true;
  try {
    const res = await api.readReport({
      dataHome: app.dataHome.active,
      taskId,
      round,
      kind,
    });
    app.reportText = res.text;
    app.reportMissing = res.missing;
    app.error = null;
  } catch (err) {
    setError(err);
  } finally {
    app.reportLoading = false;
  }
}

/* ---------------- 洞察聚合（A1 / A2 / A3） ---------------- */

/**
 * 加载洞察聚合。调用时机：进入洞察页 / 页内「刷新」/ 切换数据目录（计划 D12）。
 * **不**在 `bootstrap()` 里调用——避免为没打开洞察页的用户付一次全量扫描。
 */
export async function loadInsights(): Promise<void> {
  app.insights.loading = true;
  try {
    app.insights.data = await api.getInsights({
      dataHome: app.dataHome.active,
      from: app.insights.from,
      to: app.insights.to,
      agentId: null,
      projectPath: null,
    });
    app.error = null;
  } catch (err) {
    setError(err);
  } finally {
    app.insights.loading = false;
  }
}

/* ---------------- A4 多任务对比 ---------------- */

/**
 * 勾选 / 取消勾选一个任务参与对比。
 * 上限（`COMPARE_MAX`，见 `@/core/insights`）：已满时返回 `false` 由界面明确提示——**不静默顶替已有勾选**。
 * 勾选成功后**按需**拉取该任务最新一轮报告（只读 `readReport`），已取过的不重复请求。
 */
export async function toggleCompareTask(taskId: string): Promise<boolean> {
  const next = nextCompareSelection(app.insights.compareIds, taskId);
  if (next === null) return false;
  const added = !app.insights.compareIds.includes(taskId);
  app.insights.compareIds = next;
  if (added) await ensureCompareReport(taskId);
  return true;
}

export function clearCompareTasks(): void {
  app.insights.compareIds = [];
  app.insights.compareReports = {};
}

/** 报告按 `taskId` 缓存：已取过（含「确认缺失」的 `null`）就不再请求 */
async function ensureCompareReport(taskId: string): Promise<void> {
  if (taskId in app.insights.compareReports) return;
  const task = app.tasks.find((t) => t.taskId === taskId);
  if (!task) return;
  const round = task.reportRound ?? (task.artifacts.reportJson.length > 0
    ? (task.artifacts.reportJson[task.artifacts.reportJson.length - 1] ?? null)
    : null);
  app.insights.compareLoading = true;
  try {
    let summary: ReportSummary | null = null;
    if (round !== null) {
      const res = await api.readReport({
        dataHome: app.dataHome.active,
        taskId,
        round,
        kind: "json",
      });
      if (!res.missing) {
        try {
          summary = summarizeReport(JSON.parse(res.text) as unknown);
        } catch {
          // 报告损坏：如实记为「不可解析」，不猜内容
          summary = null;
        }
      }
    }
    app.insights.compareReports[taskId] = summary;
    app.error = null;
  } catch (err) {
    setError(err);
  } finally {
    app.insights.compareLoading = false;
  }
}

/* ---------------- 跨任务搜索 ---------------- */

export async function runSearch(): Promise<void> {
  app.search.running = true;
  app.search.scanned = 0;
  try {
    const res = await api.searchAll({
      dataHome: app.dataHome.active,
      keyword: app.search.keyword,
      scope: { ...app.search.scope },
      caseSensitive: app.search.caseSensitive,
      maxHitsPerFile: 50,
    });
    app.search.result = res;
    app.search.scanned = res.scannedFiles;
    app.error = null;
  } catch (err) {
    setError(err);
  } finally {
    app.search.running = false;
  }
}

export async function cancelSearch(): Promise<void> {
  try {
    await api.searchCancel();
  } catch (err) {
    setError(err);
  }
}

/* ---------------- 导出 ---------------- */

export async function exportCurrentFile(): Promise<string | null> {
  if (!app.logRelPath) return null;
  const base = app.logRelPath.replace(/\//g, "_");
  const target = await api.pickSavePath(base);
  if (!target) return null;
  const res = await api.exportFile({
    dataHome: app.dataHome.active,
    relPath: app.logRelPath,
    targetPath: target,
  });
  return res.targetPath;
}

export async function exportTaskZip(excludeHeavyLogs: boolean): Promise<string | null> {
  const taskId = app.selectedTaskId;
  if (!taskId) return null;
  const target = await api.pickSavePath(`${taskId}.zip`);
  if (!target) return null;
  const res = await api.exportTaskZip({
    dataHome: app.dataHome.active,
    taskId,
    targetPath: target,
    excludeHeavyLogs,
  });
  return res.targetPath;
}

/* ---------------- 更新 ---------------- */

export async function initUpdateInfo(): Promise<void> {
  try {
    const info = await api.getAppVersion();
    app.update.currentVersion = info.version;
    app.update.updaterConfigured = info.updaterConfigured;
  } catch {
    // 取版本失败不阻塞主流程
  }
}

export async function probeUpdateSources(): Promise<void> {
  try {
    app.update.probe = await api.probeUpdateSources();
  } catch (err) {
    setError(err);
  }
}

export function openUpdateDialog(): void {
  app.update.dialogOpen = true;
}

export function closeUpdateDialog(): void {
  app.update.dialogOpen = false;
}

/** 内部：跑一次检查；`silent` 为真时不写错误条（启动静默检查用——失败不该打扰阅读主流程） */
async function runUpdateCheck(source: string, silent = false): Promise<CheckUpdateResult | null> {
  app.update.checking = true;
  try {
    const result = await api.checkUpdate(source);
    app.update.result = result;
    if (!silent) app.error = null;
    return result;
  } catch (err) {
    if (!silent) setError(err);
    return null;
  } finally {
    app.update.checking = false;
  }
}

/** 手动「检查更新」：结果**一律展示**（「忽略此版本」只压自动提示），故总是打开面板 */
export async function checkUpdate(source: string): Promise<void> {
  await runUpdateCheck(source);
  app.update.dialogOpen = true;
}

/**
 * 启动静默检查：仅在具备更新能力时执行（桌面运行时需已注入更新公钥；预览模式按 mock 数据演示）。
 * 有可用版本且**未被忽略**才打开面板；出现更高版本时会自动重新提示（见 `core/version.ts` 的 shouldPrompt）。
 */
export async function checkUpdateOnStartup(): Promise<void> {
  if (!isMockRuntime && !app.update.updaterConfigured) return;
  const result = await runUpdateCheck(preferences.updateSource, true);
  if (result?.available && shouldPrompt(result.version, preferences.ignoredUpdateVersion)) {
    app.update.dialogOpen = true;
  }
}

/** 忽略某个版本：持久化到应用偏好，只压自动提示（手动检查仍会展示该版本） */
export async function ignoreUpdateVersion(version: string | null): Promise<void> {
  if (!version) return;
  await updatePreferences({ ignoredUpdateVersion: version });
  closeUpdateDialog();
}

export async function installUpdate(source: string): Promise<void> {
  app.update.installing = true;
  try {
    const res = await api.installUpdate(source);
    if (res.error) setError(res.error);
  } catch (err) {
    setError(err);
  } finally {
    app.update.installing = false;
  }
}

/** 用系统默认浏览器打开外部链接（失败不阻塞主流程） */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    await api.openExternal(url);
    app.error = null;
  } catch (err) {
    setError(err);
  }
}

/* ---------------- A8b 深链 ---------------- */

export interface DeepLinkDrainResult {
  /** 第一条可识别的目标（`tianshu://task/<id>`）；没有可识别的返回 `null` */
  target: DeepLinkTarget | null;
  /** 无法识别的原始 URL（由界面如实提示，不静默丢弃） */
  invalid: string[];
}

/**
 * 取走待处理深链队列并解析。
 *
 * **冷启动与热启动共用这一条路径**：Rust 侧把 URL 记入队列（冷启动事件早于前端监听，
 * 因此队列是唯一事实来源），热启动再补发一个 `gui://deeplink` 信号驱动前端来取。
 */
export async function drainDeepLinks(): Promise<DeepLinkDrainResult> {
  let urls: string[] = [];
  try {
    urls = await api.takePendingDeepLinks();
  } catch (err) {
    setError(err);
    return { target: null, invalid: [] };
  }
  if (urls.length === 0) return { target: null, invalid: [] };
  return {
    target: firstDeepLinkTarget(urls),
    invalid: urls.filter((url) => parseDeepLink(url) === null),
  };
}

/** 订阅深链信号（返回取消订阅函数）；订阅失败不阻塞主流程 */
export async function subscribeDeepLinks(handler: () => void): Promise<() => void> {
  try {
    return await api.onDeepLink(handler);
  } catch {
    return () => {};
  }
}

/* ---------------- 启动 ---------------- */

export async function bootstrap(): Promise<void> {
  await refreshDataHome();
  await initUpdateInfo();
  await refreshTasks();
  app.ready = true;
  // 启动静默检查放最后且不 await：单源探测超时 4s，不应拖慢首屏
  void checkUpdateOnStartup();
}

export const runtimeIsMock = isMockRuntime;