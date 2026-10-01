//! A9 产物磁盘占用统计（**只读**）。
//!
//! 口径：
//! - 只统计数据目录下的 `logs/` 与 `tasks/<目录>/`，**只 `stat` 文件、不读内容、不删除任何文件**；
//! - `tasks/` 下**所有**子目录都计入（**不按 `tsk_` / `vfy_` 前缀过滤**）——磁盘占用要如实反映实际占盘，
//!   过滤前缀会把真实占用算漏；这与「任务列表」的扫描口径**有意不同**，界面上已标注；
//! - `top_tasks` 只放**任务目录**体积前 20；`logs/` 的体积由 `logs_bytes` 单列（避免污染「可清理」的相对口径）。

use std::fs;
use std::path::Path;

use crate::models::{DiskUsage, DiskUsageFile, DiskUsageItem};

/// 体积排行取前 N（后端只排序，**不做删除**）
const TOP_N: usize = 20;

fn scan_dir(rel_path: &str, dir: &Path, task_id: Option<String>) -> DiskUsageItem {
    let mut bytes: u64 = 0;
    let mut files: i64 = 0;
    let mut heaviest: Option<DiskUsageFile> = None;

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            // 只统计普通文件；子目录（当前产物布局里不存在）不递归，避免意外的深目录拖慢扫描
            let meta = match entry.metadata() {
                Ok(meta) => meta,
                Err(_) => continue,
            };
            if !meta.is_file() {
                continue;
            }
            let len = meta.len();
            bytes += len;
            files += 1;
            // 取「更大的那个」；还没有候选时直接采用（不用 `map(..).unwrap_or(..)`——`clippy::map_unwrap_or` 会提示改写法）
            let heavier = match &heaviest {
                Some(current) => len > current.bytes,
                None => true,
            };
            if heavier {
                heaviest = Some(DiskUsageFile {
                    name: path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    bytes: len,
                });
            }
        }
    }

    let heaviest_ratio = match (&heaviest, bytes) {
        (Some(h), b) if b > 0 => h.bytes as f64 / b as f64,
        _ => 0.0,
    };

    DiskUsageItem {
        task_id,
        rel_path: rel_path.to_string(),
        bytes,
        files,
        heaviest,
        heaviest_ratio,
    }
}

/// 扫描数据目录下的 `logs/` 与 `tasks/*`，给出总体积与任务体积排行。
pub fn scan_disk_usage(home: &Path) -> DiskUsage {
    let logs = scan_dir("logs", &home.join("logs"), None);

    let mut task_items: Vec<DiskUsageItem> = Vec::new();
    let tasks_root = home.join("tasks");
    if let Ok(entries) = fs::read_dir(&tasks_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            // 目录名非法 UTF-8 时跳过（无法构造可读的 rel_path，不编造）
            let name = match path.file_name() {
                Some(name) => name.to_string_lossy().to_string(),
                None => continue,
            };
            task_items.push(scan_dir(&format!("tasks/{name}"), &path, Some(name)));
        }
    }

    let tasks_bytes: u64 = task_items.iter().map(|item| item.bytes).sum();
    let scanned_dirs = task_items.len() as i64;

    // 体积降序；同体积按路径升序，保证顺序稳定
    task_items.sort_by(|a, b| {
        b.bytes
            .cmp(&a.bytes)
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    let top_tasks = task_items.into_iter().take(TOP_N).collect();

    DiskUsage {
        total_bytes: tasks_bytes + logs.bytes,
        logs_bytes: logs.bytes,
        tasks_bytes,
        top_tasks,
        scanned_dirs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_file(path: &Path, bytes: usize) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("建目录");
        }
        std::fs::write(path, vec![b'x'; bytes]).expect("写文件");
    }

    #[test]
    fn totals_logs_and_tasks_and_keeps_top_sorted() {
        let home = std::env::temp_dir().join("tianshu-gui-disk-test");
        let _ = std::fs::remove_dir_all(&home);
        write_file(&home.join("logs/server.log"), 100);
        write_file(&home.join("tasks/tsk_big/agent-0.log"), 300);
        write_file(&home.join("tasks/tsk_big/report-0.json"), 100);
        write_file(&home.join("tasks/tsk_small/agent-0.log"), 50);
        // 非 tsk_/vfy_ 前缀的目录也计入（磁盘占用按实测，不按前缀过滤）
        write_file(&home.join("tasks/other/note.txt"), 10);

        let usage = scan_disk_usage(&home);
        assert_eq!(usage.logs_bytes, 100);
        assert_eq!(usage.tasks_bytes, 460);
        assert_eq!(usage.total_bytes, 560);
        assert_eq!(usage.scanned_dirs, 3);

        let first = &usage.top_tasks[0];
        assert_eq!(first.task_id.as_deref(), Some("tsk_big"));
        assert_eq!(first.bytes, 400);
        assert_eq!(first.files, 2);
        let heaviest = first.heaviest.as_ref().expect("应有最大文件");
        assert_eq!(heaviest.name, "agent-0.log");
        assert_eq!(heaviest.bytes, 300);
        assert!((first.heaviest_ratio - 0.75).abs() < 1e-9);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn empty_home_yields_zeros() {
        let home = std::env::temp_dir().join("tianshu-gui-disk-empty-test");
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).expect("建目录");
        let usage = scan_disk_usage(&home);
        assert_eq!(usage.total_bytes, 0);
        assert_eq!(usage.logs_bytes, 0);
        assert_eq!(usage.tasks_bytes, 0);
        assert!(usage.top_tasks.is_empty());
        assert_eq!(usage.scanned_dirs, 0);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn empty_task_dir_is_listed_with_zero_ratio() {
        let home = std::env::temp_dir().join("tianshu-gui-disk-emptydir-test");
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(home.join("tasks/tsk_empty")).expect("建目录");
        let usage = scan_disk_usage(&home);
        assert_eq!(usage.scanned_dirs, 1);
        assert_eq!(usage.top_tasks[0].bytes, 0);
        assert!(usage.top_tasks[0].heaviest.is_none());
        assert_eq!(usage.top_tasks[0].heaviest_ratio, 0.0);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn top_tasks_is_capped_at_20() {
        let home = std::env::temp_dir().join("tianshu-gui-disk-top-test");
        let _ = std::fs::remove_dir_all(&home);
        for i in 0..25 {
            write_file(&home.join(format!("tasks/tsk_{i:02}/agent-0.log")), 10 + i);
        }
        let usage = scan_disk_usage(&home);
        assert_eq!(usage.scanned_dirs, 25);
        assert_eq!(usage.top_tasks.len(), TOP_N);
        // 最大的排第一（第 24 个目录写在最后、体积最大）
        assert_eq!(usage.top_tasks[0].task_id.as_deref(), Some("tsk_24"));
        let _ = std::fs::remove_dir_all(&home);
    }
}
