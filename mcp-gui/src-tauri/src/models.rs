//! 前后端共享的数据结构（与 `mcp-gui/src/api/types.ts` 一一对应）。
//!
//! 命名约定：Rust 侧 snake_case，经 `#[serde(rename_all = "camelCase")]` 与前端 JSON 对齐。
//! 输入侧（task.json / task.jsonl）**不做强类型映射**，一律按 `serde_json::Value` 容错解析：
//! GUI 是只读消费方，新增/缺失字段都不应让它失效。

use serde::{Deserialize, Serialize};

/// 一类产物文件的轮次集合
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRounds {
    pub agent_logs: Vec<i64>,
    pub verify_logs: Vec<i64>,
    pub report_md: Vec<i64>,
    pub report_json: Vec<i64>,
    pub report_html: Vec<i64>,
    pub dry_run_md: Vec<i64>,
    pub dry_run_json: Vec<i64>,
    pub has_baseline: bool,
    pub has_dry_run_plan: bool,
}

/// 左栏任务列表项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub task_id: String,
    pub status: String,
    pub workspace_mode: String,
    pub project_path: String,
    pub display_path: String,
    pub agent_id: String,
    pub task: String,
    pub rounds_used: i64,
    pub report_round: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub finished_at: Option<String>,
    pub last_message: Option<String>,
    pub dry_run: bool,
    pub error_type: Option<String>,
    pub check_summary: Option<String>,
    pub diffstat: Option<String>,
    pub changed_files: Vec<String>,
    /// 前后端命令契约字段；Rust 侧部分命令不读取，故显式允许未读
    #[allow(dead_code)]
    pub data_home: String,
    pub artifacts: ArtifactRounds,
}

/// 事件流单条
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEventOut {
    pub ts: String,
    pub event: String,
    pub state: String,
    pub detail: Option<String>,
    pub data: Option<serde_json::Value>,
    /// 由后端判定（status / agent / note / unknown），前端不重复维护词表
    pub kind: String,
    /// task.jsonl 中的物理行号（从 1 起，坏行也占号）
    pub line: i64,
}

/// 一段日志读取结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogChunk {
    pub text: String,
    pub rel_path: String,
    pub absolute_path: String,
    pub from_byte: u64,
    pub to_byte: u64,
    pub loaded_from: u64,
    pub loaded_to: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataHomeEntry {
    pub path: String,
    pub label: String,
    pub valid: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataHomeState {
    pub detected: String,
    pub active: String,
    pub entries: Vec<DataHomeEntry>,
}

/// 用户偏好（应用自身配置，**不落业务数据目录以外的地方**）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub language: String,
    pub theme: String,
    pub update_source: String,
    pub data_homes: Vec<String>,
    pub last_good_update_source: Option<String>,
    /// 关闭窗口时的行为："tray"（默认，缩小到托盘）/ "exit"（关闭应用）。
    ///
    /// serde 默认值兜底：旧偏好文件缺该字段时按 "tray" 补齐。
    /// 不可省略——`preferences.rs` 的反序列化失败会整份回退默认值，
    /// 缺字段会连带把用户的语言 / 主题 / 数据目录一起重置。
    #[serde(default = "default_close_action")]
    pub close_action: String,
    /// 用户点过「忽略此版本」的那个版本号（`None` = 未忽略任何版本）。
    ///
    /// 只压**自动提示**（启动静默检查）；手动「检查更新」照常展示该版本。
    /// serde 默认值兜底：旧偏好文件缺该字段时按「未忽略」处理——同 `close_action`，
    /// 缺 `#[serde(default)]` 会让整份偏好反序列化失败并回退默认值。
    #[serde(default)]
    pub ignored_update_version: Option<String>,
}

fn default_close_action() -> String {
    "tray".to_string()
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            language: "zh-CN".to_string(),
            theme: "system".to_string(),
            update_source: "auto".to_string(),
            data_homes: Vec::new(),
            last_good_update_source: None,
            close_action: default_close_action(),
            ignored_update_version: None,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFilter {
    #[serde(default)]
    pub keyword: String,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub only_active: bool,
    /// 精确匹配 `task.errorType`（`None` / 空串 = 不限）
    #[serde(default)]
    pub error_type: Option<String>,
    /// `None` = 不限；`Some(true/false)` 精确匹配 `task.dryRun`
    #[serde(default)]
    pub dry_run: Option<bool>,
    /// `Some(true)` = `roundsUsed > 1`；`Some(false)` = `roundsUsed <= 1`
    #[serde(default)]
    pub reworked: Option<bool>,
    /// `Some(true)` = 存在 `report-<轮次>.html`（`artifacts.reportHtml` 非空）
    #[serde(default)]
    pub has_visual: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksRequest {
    /// 前后端命令契约字段；Rust 侧部分命令不读取，故显式允许未读
    #[allow(dead_code)]
    pub data_home: String,
    #[serde(default)]
    pub filter: TaskFilter,
    #[serde(default = "default_sort_key")]
    pub sort_key: String,
    #[serde(default = "default_sort_dir")]
    pub sort_dir: String,
}

fn default_sort_key() -> String {
    "updatedAt".to_string()
}

fn default_sort_dir() -> String {
    "desc".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadEventsRequest {
    /// 前后端命令契约字段；Rust 侧部分命令不读取，故显式允许未读
    #[allow(dead_code)]
    pub data_home: String,
    pub task_id: String,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub window_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadEventsResult {
    pub events: Vec<TaskEventOut>,
    pub total_bytes: u64,
    pub loaded_from: u64,
    pub loaded_to: u64,
    pub bad_lines: i64,
    pub loaded_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadLogRequest {
    /// 前后端命令契约字段；Rust 侧部分命令不读取，故显式允许未读
    #[allow(dead_code)]
    pub data_home: String,
    pub rel_path: String,
    /// "tail" | "before"
    pub mode: String,
    #[serde(default)]
    pub loaded_from: Option<u64>,
    #[serde(default)]
    pub window_bytes: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadReportRequest {
    /// 前后端命令契约字段；Rust 侧部分命令不读取，故显式允许未读
    #[allow(dead_code)]
    pub data_home: String,
    pub task_id: String,
    pub round: i64,
    /// "md" | "json" | "html" | "dry-run-md" | "dry-run-json"
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadReportResult {
    pub rel_path: String,
    pub absolute_path: String,
    pub text: String,
    pub missing: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFileRequest {
    /// 前后端命令契约字段；Rust 侧部分命令不读取，故显式允许未读
    #[allow(dead_code)]
    pub data_home: String,
    pub rel_path: String,
    pub target_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTaskZipRequest {
    /// 前后端命令契约字段；Rust 侧部分命令不读取，故显式允许未读
    #[allow(dead_code)]
    pub data_home: String,
    pub task_id: String,
    pub target_path: String,
    #[serde(default)]
    pub exclude_heavy_logs: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub target_path: String,
    pub bytes: u64,
    pub excluded: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchScope {
    #[serde(default)]
    pub event_stream: bool,
    #[serde(default)]
    pub agent_logs: bool,
    #[serde(default)]
    pub verify_logs: bool,
    #[serde(default)]
    pub reports: bool,
    #[serde(default)]
    pub server_log: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    /// 前后端命令契约字段；Rust 侧部分命令不读取，故显式允许未读
    #[allow(dead_code)]
    pub data_home: String,
    pub keyword: String,
    pub scope: SearchScope,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default = "default_max_hits")]
    pub max_hits_per_file: usize,
}

fn default_max_hits() -> usize {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub rel_path: String,
    pub line: i64,
    pub text: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFileGroup {
    pub task_id: Option<String>,
    pub rel_path: String,
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub groups: Vec<SearchFileGroup>,
    pub scanned_files: i64,
    pub total_hits: i64,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceProbe {
    pub reachable: bool,
    pub latency_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSourceResult {
    pub gitee: SourceProbe,
    pub github: SourceProbe,
    pub picked: String,
    pub cached: bool,
    pub degraded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckUpdateResult {
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub source: Option<String>,
    pub manual_download_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallUpdateResult {
    pub installed: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppVersionInfo {
    pub version: String,
    /// 内置公钥是否已配置（占位符未替换时为 false）
    pub updater_configured: bool,
}

/* ---------------- 洞察聚合（A1 / A2 / A3，批次一） ---------------- */

/// 洞察聚合的入参（只读；`data_home` 为前后端命令契约字段，与 `list_tasks` 同口径）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsRequest {
    /// 前后端命令契约字段；Rust 侧部分命令不读取，故显式允许未读
    #[allow(dead_code)]
    pub data_home: String,
    /// 起始时间（ISO 串，按 `updatedAt` 比较；空 = 不限）
    #[serde(default)]
    pub from: Option<String>,
    /// 结束时间（ISO 串，按 `updatedAt` 比较；空 = 不限）
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
}

/// 一次聚合的计数与求和（**比率一律交前端**，见计划 D4）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsSummary {
    pub total: i64,
    pub succeeded: i64,
    pub failed: i64,
    pub active: i64,
    pub needs_attention: i64,
    pub cancelled: i64,
    /// 未归入上述任何一类的状态（`needs_user` / `interrupted` / 未知值）
    pub other: i64,
    /// `roundsUsed` 求和
    pub rounds_sum: i64,
    /// 「一次通过」任务数：**`succeeded` 且 `roundsUsed <= 1`**（成功且仅用 1 轮）
    pub one_pass_count: i64,
    /// 找到并解析成功最新一轮报告的任务数
    pub reports_present: i64,
    /// 没有可用报告（无轮次 / 文件缺失 / 解析失败）的任务数
    pub reports_missing: i64,
    /// 验收耗时求和（ms；仅统计 `startedAt`/`finishedAt` 均可解析的报告）
    pub verify_ms_sum: i64,
    /// 参与耗时求和的报告数（分母）
    pub verify_ms_count: i64,
}

/// 按维度分组的聚合（`agents` / `projects` 共用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsGroup {
    pub key: String,
    pub summary: InsightsSummary,
}

/// 按天分桶（日期取 `createdAt` 前 10 字符，即 **UTC 日期**，见计划 D5）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsDay {
    pub date: String,
    pub total: i64,
    pub succeeded: i64,
    pub failed: i64,
    pub active: i64,
    /// `roundsUsed > 1` 的任务数（返修率的分子）
    pub reworked: i64,
}

/// 归因条目。`kind` 取值严格为 A2 原文四类：
/// `"errorType"` / `"failedCheck"` / `"blockingIssue"` / `"signal"`（**不含 warning**）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsReason {
    pub kind: String,
    pub key: String,
    pub count: i64,
}

/// 洞察聚合出参
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsResult {
    pub summary: InsightsSummary,
    pub agents: Vec<InsightsGroup>,
    pub projects: Vec<InsightsGroup>,
    pub days: Vec<InsightsDay>,
    pub reasons: Vec<InsightsReason>,
    /// 访问过的任务目录数（`tsk_*` / `vfy_*`，**筛选前**——供界面如实展示数据规模）
    pub scanned_tasks: i64,
    /// 尝试读取的 `report-*.json` 文件数
    pub scanned_reports: i64,
    /// 解析失败的 `report-*.json` 数
    pub bad_reports: i64,
}

/// 双源更新端点（与 README / docs 中登记的一致）
pub const UPDATE_ENDPOINT_GITHUB: &str =
    "https://raw.githubusercontent.com/lanlan0811/tianshu-mcp/master/update/gui/latest.json";
pub const UPDATE_ENDPOINT_GITEE: &str =
    "https://gitee.com/lan0811/tianshu-mcp/raw/master/update/gui/latest-gitee.json";

/// 手动下载兜底入口（更新失败时给用户；**按源分开**，与本次实际使用的源一致）
pub const MANUAL_DOWNLOAD_URL_GITHUB: &str = "https://github.com/lanlan0811/tianshu-mcp/releases";
pub const MANUAL_DOWNLOAD_URL_GITEE: &str = "https://gitee.com/lan0811/tianshu-mcp/releases";

/// 尾窗默认字节数（与 `src/tasks/task-store.ts` 的 64 KiB 思路一致）
pub const DEFAULT_WINDOW_BYTES: u64 = 64 * 1024;
