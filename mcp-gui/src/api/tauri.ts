/**
 * Tauri IPC 实现（真实运行时）。
 *
 * 命令名与 `src-tauri/src/lib.rs` 的 `#[tauri::command]` 一一对应。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DEEPLINK_EVENT } from "@/core/deeplink";
import type {
  AppVersionInfo,
  BaselineInfo,
  CheckUpdateResult,
  DataHomeState,
  DiskUsage,
  ExportResult,
  InsightsResult,
  InstallUpdateResult,
  LogChunk,
  Preferences,
  ProbeSourceResult,
  ReadEventsResult,
  ReadReportResult,
  SearchResult,
  TaskSummary,
} from "./types";
import type { GuiApi } from "./gui-api";

export const tauriApi: GuiApi = {
  getAppVersion: () => invoke<AppVersionInfo>("get_app_version"),
  getDataHomeState: () => invoke<DataHomeState>("get_data_home_state"),
  addDataHome: (path) => invoke<DataHomeState>("add_data_home", { path }),
  removeDataHome: (path) => invoke<DataHomeState>("remove_data_home", { path }),
  setActiveDataHome: (path) => invoke<DataHomeState>("set_active_data_home", { path }),
  pickDirectory: () => invoke<string | null>("pick_directory"),
  pickSavePath: (defaultName) => invoke<string | null>("pick_save_path", { defaultName }),
  listTasks: (req) => invoke<TaskSummary[]>("list_tasks", { req }),
  getInsights: (req) => invoke<InsightsResult>("get_insights", { req }),
  readBaseline: (req) => invoke<BaselineInfo>("read_baseline", { req }),
  scanDiskUsage: (req) => invoke<DiskUsage>("scan_disk_usage", { req }),
  takePendingDeepLinks: () => invoke<string[]>("take_pending_deeplinks"),
  onDeepLink: async (handler) => listen(DEEPLINK_EVENT, () => handler()),
  readEvents: (req) => invoke<ReadEventsResult>("read_events", { req }),
  readLog: (req) => invoke<LogChunk>("read_log", { req }),
  readReport: (req) => invoke<ReadReportResult>("read_report", { req }),
  exportFile: (req) => invoke<ExportResult>("export_file", { req }),
  exportTaskZip: (req) => invoke<ExportResult>("export_task_zip", { req }),
  searchAll: (req) => invoke<SearchResult>("search_all", { req }),
  searchCancel: () => invoke<void>("search_cancel"),
  probeUpdateSources: () => invoke<ProbeSourceResult>("probe_update_sources"),
  checkUpdate: (source) => invoke<CheckUpdateResult>("check_update", { source }),
  installUpdate: (source) => invoke<InstallUpdateResult>("install_update", { source }),
  openExternal: (url) => openUrl(url),
  getPreferences: () => invoke<Preferences>("get_preferences"),
  setPreferences: (prefs) => invoke<void>("set_preferences", { prefs }),
  watchStart: (paths) => invoke<void>("watch_start", { paths }),
  watchStop: () => invoke<void>("watch_stop"),
};