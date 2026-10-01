//! 洞察聚合（A1 效能 / A2 失败归因 / A3 时间趋势）—— **只读**扫描
//! `tasks/*/task.json` 与每个任务的**最新一轮** `report-<r>.json`。
//!
//! 职责边界（计划 D4）：Rust 只做**扫描 + 解析 + 计数/求和**，比率 / TopN / 趋势补齐 /
//! 周历聚合一律留给前端 `core/insights.ts` 的纯函数（可单测、不进时区逻辑）。
//!
//! 反序列化沿用 `scanner` 的容错风格：缺字段给安全默认，坏报告只计数（`bad_reports`）
//! 不中断整轮扫描——GUI 是只读消费方，绝不让单条坏数据毁掉整页。

use std::collections::BTreeMap;
use std::path::Path;

use serde_json::Value;

use crate::models::{
    InsightsDay, InsightsGroup, InsightsReason, InsightsRequest, InsightsResult, InsightsSummary,
};
use crate::scanner::read_task_summary;
use crate::schema::ACTIVE_STATUSES;
use crate::timestamps::parse_iso_ms;

/// 归因类别 —— 严格对齐 A2 原文四类（**不含 `warning`**，计划已确认移除）。
const KIND_ERROR_TYPE: &str = "errorType";
const KIND_FAILED_CHECK: &str = "failedCheck";
const KIND_BLOCKING_ISSUE: &str = "blockingIssue";
const KIND_SIGNAL: &str = "signal";

/// 聚合一次洞察。`home` 为数据目录根（其下 `tasks/`）。
pub fn collect(home: &Path, req: &InsightsRequest) -> InsightsResult {
    let mut summary = InsightsSummary::default();
    let mut agents: BTreeMap<String, InsightsSummary> = BTreeMap::new();
    let mut projects: BTreeMap<String, InsightsSummary> = BTreeMap::new();
    let mut days: BTreeMap<String, InsightsDay> = BTreeMap::new();
    let mut reasons: BTreeMap<(String, String), i64> = BTreeMap::new();

    let mut scanned_tasks = 0_i64;
    let mut scanned_reports = 0_i64;
    let mut bad_reports = 0_i64;

    let Ok(entries) = std::fs::read_dir(home.join("tasks")) else {
        // 数据目录还没有 tasks/：如实返回全零，而不是报错。
        return InsightsResult {
            summary,
            agents: Vec::new(),
            projects: Vec::new(),
            days: Vec::new(),
            reasons: Vec::new(),
            scanned_tasks,
            scanned_reports,
            bad_reports,
        };
    };

    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let task_id = entry.file_name().to_string_lossy().to_string();
        // 与 `scanner::list_tasks` 完全同口径：只认 tsk_* / vfy_*
        if !(task_id.starts_with("tsk_") || task_id.starts_with("vfy_")) {
            continue;
        }
        scanned_tasks += 1;

        let Some(task) = read_task_summary(home, &task_id) else {
            continue;
        };
        if !matches_range(&task.updated_at, req)
            || !matches_opt(&task.agent_id, req.agent_id.as_deref())
            || !matches_opt(&task.project_path, req.project_path.as_deref())
        {
            continue;
        }

        // 最新一轮报告：优先快照上的 `reportRound`，否则取产物目录里最大的 `report-<r>.json`。
        // （`read_task_summary` 内部已调 `scanner::collect_artifacts`，这里复用其结果，不重复扫目录。）
        let round = task
            .report_round
            .filter(|r| *r >= 0)
            .or_else(|| task.artifacts.report_json.iter().copied().max());
        let report_path = round.map(|r| {
            home.join("tasks")
                .join(&task_id)
                .join(format!("report-{r}.json"))
        });

        let mut report: Option<Value> = None;
        if let Some(path) = report_path.filter(|p| p.is_file()) {
            scanned_reports += 1;
            match std::fs::read_to_string(&path)
                .ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            {
                Some(value) if value.is_object() => report = Some(value),
                _ => bad_reports += 1,
            }
        }

        // 计数：同一份「任务增量」同时进全局、Agent 分组与项目分组。
        apply_task(
            &mut summary,
            &task.status,
            task.rounds_used,
            report.as_ref(),
        );
        // 分组键直接从 task 移出（不再 clone）——后面不再读这两个字段。
        let agent_key = task.agent_id;
        let project_key = task.project_path;
        apply_task(
            agents.entry(agent_key).or_default(),
            &task.status,
            task.rounds_used,
            report.as_ref(),
        );
        apply_task(
            projects.entry(project_key).or_default(),
            &task.status,
            task.rounds_used,
            report.as_ref(),
        );

        // 按天分桶（UTC 日期 = `createdAt` 前 10 字符）
        let date: String = task.created_at.chars().take(10).collect();
        if !date.is_empty() {
            let day = days.entry(date.clone()).or_insert_with(|| InsightsDay {
                date,
                ..InsightsDay::default()
            });
            day.total += 1;
            if ACTIVE_STATUSES.contains(&task.status.as_str()) {
                day.active += 1;
            } else if task.status == "succeeded" {
                day.succeeded += 1;
            } else if task.status == "failed" {
                day.failed += 1;
            }
            if task.rounds_used > 1 {
                day.reworked += 1;
            }
        }

        // 归因：`errorType`（快照） + 失败 check 名 / `blockingIssues[].code` / `analysis.signals`（报告）
        if let Some(error_type) = task.error_type.as_deref() {
            bump_reason(&mut reasons, KIND_ERROR_TYPE, error_type, 1);
        }
        if let Some(value) = report.as_ref() {
            collect_reasons(value, &mut reasons);
        }
    }

    InsightsResult {
        summary,
        agents: to_groups(agents),
        projects: to_groups(projects),
        days: days.into_values().collect(),
        reasons: reasons
            .into_iter()
            .map(|((kind, key), count)| InsightsReason { kind, key, count })
            .collect(),
        scanned_tasks,
        scanned_reports,
        bad_reports,
    }
}

/// 把一条任务的计数与报告派生量并入某个汇总（全局 / Agent 分组 / 项目分组共用同一口径）。
fn apply_task(s: &mut InsightsSummary, status: &str, rounds_used: i64, report: Option<&Value>) {
    s.total += 1;
    s.rounds_sum += rounds_used;

    if ACTIVE_STATUSES.contains(&status) {
        s.active += 1;
    } else if status == "succeeded" {
        s.succeeded += 1;
        // 「一次通过」= 成功且仅用 1 轮（`roundsUsed <= 1`）
        if rounds_used <= 1 {
            s.one_pass_count += 1;
        }
    } else if status == "failed" {
        s.failed += 1;
    } else if status == "needs_attention" {
        s.needs_attention += 1;
    } else if status == "cancelled" {
        s.cancelled += 1;
    } else {
        // needs_user / interrupted / 未知值：如实归入「其他」，不硬塞进上面任何一类
        s.other += 1;
    }

    let Some(rep) = report else {
        s.reports_missing += 1;
        return;
    };
    s.reports_present += 1;

    // 验收耗时：两端都可解析且非负才计入，否则该报告不进分母（不编造时间）
    let span = match (ms_of(rep, "startedAt"), ms_of(rep, "finishedAt")) {
        (Some(started), Some(finished)) if finished >= started => Some(finished - started),
        _ => None,
    };
    if let Some(ms) = span {
        s.verify_ms_sum += ms;
        s.verify_ms_count += 1;
    }
}

/// 从报告里提取三类归因（失败 check / 阻塞问题 / 代码信号）。
fn collect_reasons(rep: &Value, out: &mut BTreeMap<(String, String), i64>) {
    if let Some(checks) = rep.get("checks").and_then(Value::as_array) {
        for check in checks {
            if check.get("passed").and_then(Value::as_bool) != Some(false) {
                continue;
            }
            if let Some(name) = check.get("name").and_then(Value::as_str) {
                bump_reason(out, KIND_FAILED_CHECK, name, 1);
            }
        }
    }
    if let Some(issues) = rep.get("blockingIssues").and_then(Value::as_array) {
        for issue in issues {
            if let Some(code) = issue.get("code").and_then(Value::as_str) {
                bump_reason(out, KIND_BLOCKING_ISSUE, code, 1);
            }
        }
    }
    if let Some(signals) = rep
        .get("analysis")
        .and_then(|analysis| analysis.get("signals"))
        .and_then(Value::as_object)
    {
        for (key, value) in signals {
            // 值为 0 的信号不计入；`count` 用信号自身的出现次数（不是任务数）
            let seen = value.as_i64().unwrap_or(0);
            if seen > 0 {
                bump_reason(out, KIND_SIGNAL, key, seen);
            }
        }
    }
}

fn bump_reason(out: &mut BTreeMap<(String, String), i64>, kind: &str, key: &str, count: i64) {
    if key.is_empty() {
        return;
    }
    *out.entry((kind.to_string(), key.to_string())).or_insert(0) += count;
}

fn ms_of(value: &Value, key: &str) -> Option<i64> {
    parse_iso_ms(value.get(key).and_then(Value::as_str).unwrap_or(""))
}

/// 时间范围过滤：与 `scanner::matches_filter` 同口径（按 `updatedAt` 字符串比较）。
fn matches_range(updated_at: &str, req: &InsightsRequest) -> bool {
    if let Some(from) = req.from.as_deref() {
        if !from.is_empty() && updated_at < from {
            return false;
        }
    }
    if let Some(to) = req.to.as_deref() {
        if !to.is_empty() && updated_at > to {
            return false;
        }
    }
    true
}

fn matches_opt(value: &str, want: Option<&str>) -> bool {
    match want {
        Some(wanted) => wanted.is_empty() || value == wanted,
        None => true,
    }
}

/// 分组按 key 升序输出（BTreeMap 顺序即确定性顺序）；排序与筛选由前端纯函数负责（计划 D4）。
fn to_groups(map: BTreeMap<String, InsightsSummary>) -> Vec<InsightsGroup> {
    map.into_iter()
        .map(|(key, summary)| InsightsGroup { key, summary })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("建目录");
        }
        std::fs::write(path, text).expect("写文件");
    }

    fn req() -> InsightsRequest {
        InsightsRequest {
            data_home: String::new(),
            from: None,
            to: None,
            agent_id: None,
            project_path: None,
        }
    }

    #[test]
    fn aggregates_counts_groups_days_and_reasons() {
        let home = std::env::temp_dir().join("tianshu-gui-insights-test");
        let _ = std::fs::remove_dir_all(&home);

        // 一次通过：succeeded + 1 轮 + 报告（含失败 check / 阻塞问题 / 信号）
        write(
            &home.join("tasks/tsk_1/task.json"),
            r#"{"status":"succeeded","agentId":"codex","projectPath":"D:/p1","roundsUsed":1,
                "createdAt":"2026-09-26T10:00:00Z","updatedAt":"2026-09-26T10:05:00Z"}"#,
        );
        write(
            &home.join("tasks/tsk_1/report-0.json"),
            r#"{"startedAt":"2026-09-26T10:01:00.000Z","finishedAt":"2026-09-26T10:01:02.500Z",
                "checks":[{"name":"typecheck","passed":false},{"name":"build","passed":true}],
                "blockingIssues":[{"code":"VISUAL_BLOCKED"}],
                "analysis":{"signals":{"consoleDebug":3,"todo":0}}}"#,
        );

        // 返修后成功：succeeded + 3 轮；无报告
        write(
            &home.join("tasks/tsk_2/task.json"),
            r#"{"status":"succeeded","agentId":"codex","projectPath":"D:/p1","roundsUsed":3,
                "createdAt":"2026-09-27T08:00:00Z","updatedAt":"2026-09-27T08:30:00Z"}"#,
        );

        // 失败 + errorType，另一个项目
        write(
            &home.join("tasks/tsk_3/task.json"),
            r#"{"status":"failed","agentId":"zcode","projectPath":"D:/p2","roundsUsed":2,
                "errorType":"timeout","createdAt":"2026-09-27T09:00:00Z","updatedAt":"2026-09-27T09:10:00Z"}"#,
        );

        // 活动态
        write(
            &home.join("tasks/tsk_4/task.json"),
            r#"{"status":"running","agentId":"zcode","projectPath":"D:/p2","roundsUsed":0,
                "createdAt":"2026-09-28T09:00:00Z","updatedAt":"2026-09-28T09:01:00Z"}"#,
        );

        // 非 tsk_/vfy_ 前缀：必须跳过
        write(
            &home.join("tasks/other_1/task.json"),
            r#"{"status":"succeeded"}"#,
        );

        let res = collect(&home, &req());
        assert_eq!(res.scanned_tasks, 4, "只统计 tsk_/vfy_ 前缀");
        assert_eq!(res.summary.total, 4);
        assert_eq!(res.summary.succeeded, 2);
        assert_eq!(res.summary.failed, 1);
        assert_eq!(res.summary.active, 1);
        assert_eq!(res.summary.one_pass_count, 1, "仅 tsk_1 是「成功且 1 轮」");
        assert_eq!(res.summary.rounds_sum, 6);
        assert_eq!(res.summary.reports_present, 1);
        assert_eq!(res.summary.reports_missing, 3);
        assert_eq!(res.summary.verify_ms_sum, 2_500);
        assert_eq!(res.summary.verify_ms_count, 1);
        assert_eq!(res.scanned_reports, 1);
        assert_eq!(res.bad_reports, 0);

        // 分组（BTreeMap → key 升序）
        let agents: Vec<(&str, i64, i64)> = res
            .agents
            .iter()
            .map(|g| (g.key.as_str(), g.summary.total, g.summary.succeeded))
            .collect();
        assert_eq!(agents, vec![("codex", 2, 2), ("zcode", 2, 0)]);
        assert_eq!(res.projects.len(), 2);

        // 按天（UTC 日期）
        let days: Vec<(&str, i64, i64)> = res
            .days
            .iter()
            .map(|d| (d.date.as_str(), d.total, d.reworked))
            .collect();
        assert_eq!(
            days,
            vec![
                ("2026-09-26", 1, 0),
                ("2026-09-27", 2, 2),
                ("2026-09-28", 1, 0),
            ]
        );

        // 归因四类中的四类都在此出现
        let has = |kind: &str, key: &str, count: i64| {
            res.reasons
                .iter()
                .any(|r| r.kind == kind && r.key == key && r.count == count)
        };
        assert!(has("failedCheck", "typecheck", 1));
        assert!(has("blockingIssue", "VISUAL_BLOCKED", 1));
        assert!(
            has("signal", "consoleDebug", 3),
            "signal 计数用信号自身出现次数"
        );
        assert!(has("errorType", "timeout", 1));
        assert!(
            !res.reasons.iter().any(|r| r.key == "todo"),
            "值为 0 的信号不计入"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn range_and_dimension_filters_apply_to_tasks() {
        let home = std::env::temp_dir().join("tianshu-gui-insights-filter-test");
        let _ = std::fs::remove_dir_all(&home);
        write(
            &home.join("tasks/tsk_a/task.json"),
            r#"{"status":"succeeded","agentId":"codex","projectPath":"D:/p1","roundsUsed":1,
                "createdAt":"2026-09-26T10:00:00Z","updatedAt":"2026-09-26T10:00:00Z"}"#,
        );
        write(
            &home.join("tasks/tsk_b/task.json"),
            r#"{"status":"failed","agentId":"zcode","projectPath":"D:/p2","roundsUsed":1,
                "createdAt":"2026-10-01T10:00:00Z","updatedAt":"2026-10-01T10:00:00Z"}"#,
        );

        let by_agent = collect(
            &home,
            &InsightsRequest {
                agent_id: Some("zcode".to_string()),
                ..req()
            },
        );
        assert_eq!(by_agent.summary.total, 1);
        assert_eq!(by_agent.summary.failed, 1);
        assert_eq!(by_agent.scanned_tasks, 2, "scannedTasks 是筛选前的访问量");

        let by_range = collect(
            &home,
            &InsightsRequest {
                from: Some("2026-09-30T00:00:00Z".to_string()),
                ..req()
            },
        );
        assert_eq!(by_range.summary.total, 1);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn bad_report_is_counted_not_fatal() {
        let home = std::env::temp_dir().join("tianshu-gui-insights-bad-report-test");
        let _ = std::fs::remove_dir_all(&home);
        write(
            &home.join("tasks/tsk_x/task.json"),
            r#"{"status":"succeeded","agentId":"codex","roundsUsed":1,
                "createdAt":"2026-09-26T10:00:00Z","updatedAt":"2026-09-26T10:00:00Z","reportRound":0}"#,
        );
        write(&home.join("tasks/tsk_x/report-0.json"), "{ 这不是 JSON");

        let res = collect(&home, &req());
        assert_eq!(res.scanned_reports, 1);
        assert_eq!(res.bad_reports, 1);
        assert_eq!(res.summary.reports_present, 0, "坏报告不算 present");
        assert_eq!(res.summary.reports_missing, 1);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn missing_tasks_dir_returns_empty_result() {
        let home = std::env::temp_dir().join("tianshu-gui-insights-empty-test");
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).expect("建目录");
        let res = collect(&home, &req());
        assert_eq!(res.scanned_tasks, 0);
        assert_eq!(res.summary.total, 0);
        assert!(res.days.is_empty());
        assert!(res.agents.is_empty());
        let _ = std::fs::remove_dir_all(&home);
    }
}
