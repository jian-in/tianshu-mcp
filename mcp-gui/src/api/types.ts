/**
 * mcp-gui ↔ Tauri 后端的命令契约（唯一事实来源）。
 *
 * 命名与 src-tauri/src/lib.rs 注册的 `#[tauri::command]` 一一对应（snake_case）。
 * 前端所有取数都必须经 src/api/ 出口，不得直连文件系统。
 */

/** 应用运行模式：真实 Tauri 进程 / 浏览器本地预览（mock） */
export type RuntimeMode = "tauri" | "mock";

/** 一类产物文件的轮次集合（缺失即空数组） */
export interface ArtifactRounds {
  agentLogs: number[];
  verifyLogs: number[];
  reportMd: number[];
  reportJson: number[];
  reportHtml: number[];
  dryRunMd: number[];
  dryRunJson: number[];
  hasBaseline: boolean;
  hasDryRunPlan: boolean;
}

/** 左栏任务列表项（由 task.json 快照 + 目录扫描聚合） */
export interface TaskSummary {
  taskId: string;
  status: string;
  workspaceMode: string;
  projectPath: string;
  displayPath: string;
  agentId: string;
  task: string;
  roundsUsed: number;
  reportRound: number | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastMessage: string | null;
  dryRun: boolean;
  errorType: string | null;
  checkSummary: string | null;
  diffstat: string | null;
  changedFiles: string[];
  dataHome: string;
  artifacts: ArtifactRounds;
}

/** 事件流单条（task.jsonl 一行） */
export interface TaskEvent {
  ts: string;
  event: string;
  state: string;
  detail: string | null;
  data: Record<string, unknown> | null;
  /** 由后端判定的事件类别，避免前端重复维护词表 */
  kind: EventKind;
  /** 在 task.jsonl 中的从 1 开始的物理行号（坏行也占号） */
  line: number;
}

export type EventKind = "status" | "agent" | "note" | "unknown";

/** 一段日志读取结果（尾部窗口或向前加载的一块） */
export interface LogChunk {
  text: string;
  /** 相对数据目录的路径（正斜杠） */
  relPath: string;
  absolutePath: string;
  /** 本次读取覆盖的字节区间 [fromByte, toByte) */
  fromByte: number;
  toByte: number;
  /** 已经加载到内存的区间 [loadedFrom, loadedTo) */
  loadedFrom: number;
  loadedTo: number;
  totalBytes: number;
}

export interface DataHomeEntry {
  path: string;
  label: string;
  /** 目录下存在 logs/ 或 tasks/ 才算合法 */
  valid: boolean;
  message: string;
}

export interface DataHomeState {
  /** 自动探测到的默认目录（TIANSHU_MCP_HOME → ~/.tianshu-mcp） */
  detected: string;
  active: string;
  entries: DataHomeEntry[];
}

export interface Preferences {
  language: "zh-CN" | "en-US";
  theme: "system" | "light" | "dark";
  /** 更新源三态：自动择优 / 强制 Gitee / 强制 GitHub */
  updateSource: "auto" | "gitee" | "github";
  /** 用户手动追加的数据目录（不含自动探测的默认目录） */
  dataHomes: string[];
  /** 上次成功使用的更新源（两端均不可达时回退） */
  lastGoodUpdateSource: "gitee" | "github" | null;
  /** 关闭窗口时的行为：缩小到托盘（默认）/ 关闭应用 */
  closeAction: "tray" | "exit";
  /** 用户点过「忽略此版本」的版本号（只压自动提示；手动检查仍展示） */
  ignoredUpdateVersion: string | null;
}

/** 任务筛选条件（全部可选，缺省即不限制） */
export interface TaskFilter {
  keyword: string;
  agentId: string | null;
  status: string | null;
  projectPath: string | null;
  /** ISO 时间下界（含） */
  from: string | null;
  /** ISO 时间上界（含） */
  to: string | null;
  onlyActive: boolean;
  /** 精确匹配 `task.errorType`（null = 不限） */
  errorType: string | null;
  /** true / false 精确匹配 `task.dryRun`（null = 不限） */
  dryRun: boolean | null;
  /** true = `roundsUsed > 1`；false = `roundsUsed <= 1`（null = 不限） */
  reworked: boolean | null;
  /** true = 存在 `report-<轮次>.html`（null = 不限） */
  hasVisual: boolean | null;
}

export type SortKey = "updatedAt" | "createdAt" | "taskId";
export type SortDir = "asc" | "desc";

export interface ListTasksRequest {
  dataHome: string;
  filter: TaskFilter;
  sortKey: SortKey;
  sortDir: SortDir;
}

export interface ReadEventsRequest {
  dataHome: string;
  taskId: string;
  /** 只取最后 N 条（0 或不传 = 全量；全量仅用于中小文件） */
  limit?: number;
  /** 尾部窗口字节数（不传用后端默认） */
  windowBytes?: number;
  /** `true` = 读**全量**事件流（阶段甘特专用）；缺省 `false` 仍读尾部窗口，行为不变 */
  full?: boolean;
}

export interface ReadEventsResult {
  events: TaskEvent[];
  totalBytes: number;
  loadedFrom: number;
  loadedTo: number;
  /** task.jsonl 中被跳过的坏行数（如实披露，不静默） */
  badLines: number;
  /** 事件总数（本次已加载窗口内的） */
  loadedCount: number;
}

export interface ReadLogRequest {
  dataHome: string;
  /** 相对数据目录的路径，正斜杠；如 logs/server.log 或 tasks/<id>/agent-0.log */
  relPath: string;
  /** tail = 尾部窗口；before = 继续向前加载一块 */
  mode: "tail" | "before";
  /** 已加载区间起点（before 模式必填） */
  loadedFrom?: number;
  windowBytes?: number;
}

export interface ReadReportRequest {
  dataHome: string;
  taskId: string;
  round: number;
  kind: "md" | "json" | "html" | "dry-run-md" | "dry-run-json";
}

export interface ReadReportResult {
  relPath: string;
  absolutePath: string;
  /** 文本内容；html 为完整 HTML 源串（前端必须走 sandbox iframe 渲染） */
  text: string;
  missing: boolean;
}

export interface ExportFileRequest {
  dataHome: string;
  relPath: string;
  /** 由用户选择的保存路径（经 pick_save_path 得到） */
  targetPath: string;
}

export interface ExportTaskZipRequest {
  dataHome: string;
  taskId: string;
  targetPath: string;
  /** 排除体积大的原始日志（agent-*.log / verify-*.log） */
  excludeHeavyLogs: boolean;
}

export interface ExportResult {
  targetPath: string;
  bytes: number;
  /** 被排除的文件数（excludeHeavyLogs 时如实回报） */
  excluded: number;
}

export interface SearchRequest {
  dataHome: string;
  keyword: string;
  /** 搜索范围开关 */
  scope: {
    eventStream: boolean;
    agentLogs: boolean;
    verifyLogs: boolean;
    reports: boolean;
    serverLog: boolean;
  };
  caseSensitive: boolean;
  /** 每个文件最多返回的命中数 */
  maxHitsPerFile: number;
}

export interface SearchHit {
  relPath: string;
  line: number;
  text: string;
  /** 命中片段（前后各截若干字符） */
  snippet: string;
}

export interface SearchFileGroup {
  taskId: string | null;
  relPath: string;
  hits: SearchHit[];
  truncated: boolean;
}

export interface SearchResult {
  groups: SearchFileGroup[];
  scannedFiles: number;
  totalHits: number;
  cancelled: boolean;
}

export interface ProbeSourceResult {
  gitee: { reachable: boolean; latencyMs: number | null };
  github: { reachable: boolean; latencyMs: number | null };
  picked: "gitee" | "github";
  cached: boolean;
  /** 两端均不可达时为 true，此时 picked 是回退值 */
  degraded: boolean;
}

export interface CheckUpdateResult {
  available: boolean;
  currentVersion: string;
  version: string | null;
  notes: string | null;
  source: "gitee" | "github" | null;
  /** 手动下载入口（更新失败时给出，保证主流程不受影响） */
  manualDownloadUrl: string | null;
  error: string | null;
}

export interface InstallUpdateResult {
  installed: boolean;
  version: string | null;
  error: string | null;
}

export interface AppVersionInfo {
  version: string;
  /** 内置公钥是否已配置（占位符未替换时为 false） */
  updaterConfigured: boolean;
}

/* ---------------- 洞察聚合（A1 效能 / A2 归因 / A3 趋势） ---------------- */

/** 洞察入参（只读；时间范围按 `updatedAt` 比较，口径同 `list_tasks`） */
export interface InsightsRequest {
  dataHome: string;
  from: string | null;
  to: string | null;
  agentId: string | null;
  projectPath: string | null;
}

/** 一次聚合的计数与求和——**比率一律由前端算**（`core/insights.ts`），后端不产生百分比 */
export interface InsightsSummary {
  total: number;
  succeeded: number;
  failed: number;
  active: number;
  needsAttention: number;
  cancelled: number;
  /** 未归入上述任何一类的状态（needs_user / interrupted / 未知值） */
  other: number;
  roundsSum: number;
  /** 「一次通过」任务数：**succeeded 且 roundsUsed <= 1** */
  onePassCount: number;
  reportsPresent: number;
  reportsMissing: number;
  verifyMsSum: number;
  verifyMsCount: number;
}

/** 按维度分组的聚合（agents / projects 共用） */
export interface InsightsGroup {
  key: string;
  summary: InsightsSummary;
}

/** 按天分桶（日期为 `createdAt` 前 10 字符，即 **UTC 日期**） */
export interface InsightsDay {
  date: string;
  total: number;
  succeeded: number;
  failed: number;
  active: number;
  /** roundsUsed > 1 的任务数（返修率的分子） */
  reworked: number;
}

/** 归因类别（严格四类，不含 warning） */
export type InsightsReasonKind = "errorType" | "failedCheck" | "blockingIssue" | "signal";

export interface InsightsReason {
  kind: InsightsReasonKind;
  key: string;
  count: number;
}

export interface InsightsResult {
  summary: InsightsSummary;
  agents: InsightsGroup[];
  projects: InsightsGroup[];
  days: InsightsDay[];
  reasons: InsightsReason[];
  /** 访问过的任务目录数（筛选前，供界面如实展示数据规模） */
  scannedTasks: number;
  /** 尝试读取的 report-*.json 数 */
  scannedReports: number;
  /** 解析失败的 report-*.json 数 */
  badReports: number;
}

/* ---------------- A5 基线漂移（只读） ---------------- */

export interface BaselineRequest {
  dataHome: string;
  taskId: string;
}

/** `tasks/<任务>/baseline.json` 的容错摘要；**文件缺失不是错误**（`present = false`） */
export interface BaselineInfo {
  present: boolean;
  isRepo: boolean;
  head: string | null;
  dirty: boolean;
  dirtyFilesCount: number;
  preExistingChangedCount: number;
  preExistingUntrackedCount: number;
  capturedAt: string | null;
  message: string | null;
}

/* ---------------- A9 磁盘占用（只读统计，不删除任何文件） ---------------- */

export interface DiskUsageRequest {
  dataHome: string;
}

export interface DiskUsageFile {
  name: string;
  bytes: number;
}

export interface DiskUsageItem {
  /** 任务目录名；`logs/` 这类非任务条目为 `null` */
  taskId: string | null;
  relPath: string;
  bytes: number;
  files: number;
  heaviest: DiskUsageFile | null;
  /** `heaviest.bytes / bytes`（目录为空时为 0） */
  heaviestRatio: number;
}

export interface DiskUsage {
  totalBytes: number;
  logsBytes: number;
  tasksBytes: number;
  /** **任务目录**体积前 20（`logs/` 单列在 `logsBytes`） */
  topTasks: DiskUsageItem[];
  scannedDirs: number;
}