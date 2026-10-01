/**
 * 前端唯一数据出口的接口定义（tauri 实现与 mock 实现共同遵守）。
 */
import type {
  AppVersionInfo,
  BaselineInfo,
  BaselineRequest,
  CheckUpdateResult,
  DataHomeState,
  DiskUsage,
  DiskUsageRequest,
  ExportFileRequest,
  ExportResult,
  ExportTaskZipRequest,
  InstallUpdateResult,
  InsightsRequest,
  InsightsResult,
  ListTasksRequest,
  LogChunk,
  Preferences,
  ProbeSourceResult,
  ReadEventsRequest,
  ReadEventsResult,
  ReadLogRequest,
  ReadReportRequest,
  ReadReportResult,
  SearchRequest,
  SearchResult,
  TaskSummary,
} from "./types";

export interface GuiApi {
  getAppVersion(): Promise<AppVersionInfo>;
  getDataHomeState(): Promise<DataHomeState>;
  addDataHome(path: string): Promise<DataHomeState>;
  removeDataHome(path: string): Promise<DataHomeState>;
  setActiveDataHome(path: string): Promise<DataHomeState>;
  /** 原生目录选择（mock 下返回 null） */
  pickDirectory(): Promise<string | null>;
  /** 原生保存路径选择（mock 下返回 null） */
  pickSavePath(defaultName: string): Promise<string | null>;
  listTasks(req: ListTasksRequest): Promise<TaskSummary[]>;
  /** 洞察聚合（A1 效能 / A2 归因 / A3 趋势）：只读扫描，不写业务数据 */
  getInsights(req: InsightsRequest): Promise<InsightsResult>;
  /** A5 基线漂移：只读某个任务的 `baseline.json`（缺失即 `present = false`） */
  readBaseline(req: BaselineRequest): Promise<BaselineInfo>;
  /** A9 磁盘占用统计：只读 `stat`，**不删除任何文件** */
  scanDiskUsage(req: DiskUsageRequest): Promise<DiskUsage>;
  /** A8b 取走 Rust 侧待处理深链队列（冷启动与热启动共用一条路径） */
  takePendingDeepLinks(): Promise<string[]>;
  /** A8b 订阅深链信号；返回取消订阅函数（mock 下为空实现） */
  onDeepLink(handler: () => void): Promise<() => void>;
  readEvents(req: ReadEventsRequest): Promise<ReadEventsResult>;
  readLog(req: ReadLogRequest): Promise<LogChunk>;
  readReport(req: ReadReportRequest): Promise<ReadReportResult>;
  exportFile(req: ExportFileRequest): Promise<ExportResult>;
  exportTaskZip(req: ExportTaskZipRequest): Promise<ExportResult>;
  searchAll(req: SearchRequest): Promise<SearchResult>;
  searchCancel(): Promise<void>;
  probeUpdateSources(): Promise<ProbeSourceResult>;
  checkUpdate(source: string): Promise<CheckUpdateResult>;
  installUpdate(source: string): Promise<InstallUpdateResult>;
  /** 用系统默认浏览器打开外部链接（仅两个发行页域名的白名单内） */
  openExternal(url: string): Promise<void>;
  getPreferences(): Promise<Preferences>;
  setPreferences(prefs: Preferences): Promise<void>;
  watchStart(paths: string[]): Promise<void>;
  watchStop(): Promise<void>;
}