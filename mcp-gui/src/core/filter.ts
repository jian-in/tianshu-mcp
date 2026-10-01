/**
 * 任务列表的筛选 / 排序 / 分面（纯函数）。
 */
import type { SortDir, SortKey, TaskFilter, TaskSummary } from "@/api/types";
import { isActiveStatus } from "@/core/events";

export function emptyFilter(): TaskFilter {
  return {
    keyword: "",
    agentId: null,
    status: null,
    projectPath: null,
    from: null,
    to: null,
    onlyActive: false,
    errorType: null,
    dryRun: null,
    reworked: null,
    hasVisual: null,
  };
}

export function filterTasks(tasks: TaskSummary[], filter: TaskFilter): TaskSummary[] {
  const kw = filter.keyword.trim().toLowerCase();
  return tasks.filter((t) => {
    if (filter.onlyActive && !isActiveStatus(t.status)) return false;
    if (filter.agentId && t.agentId !== filter.agentId) return false;
    if (filter.status && t.status !== filter.status) return false;
    if (filter.projectPath && t.projectPath !== filter.projectPath) return false;
    if (filter.from && t.updatedAt < filter.from) return false;
    if (filter.to && t.updatedAt > filter.to) return false;
    // 以下四项与 Rust `scanner.rs` 的 `matches_filter` **逐行同口径**，改一处必须改两处
    if (filter.errorType && t.errorType !== filter.errorType) return false;
    if (filter.dryRun !== null && t.dryRun !== filter.dryRun) return false;
    if (filter.reworked !== null && (t.roundsUsed > 1) !== filter.reworked) return false;
    if (filter.hasVisual !== null && (t.artifacts.reportHtml.length > 0) !== filter.hasVisual) {
      return false;
    }
    if (kw) {
      const haystack = [t.taskId, t.task, t.projectPath, t.displayPath, t.agentId, t.lastMessage ?? ""]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
}

export function sortTasks(tasks: TaskSummary[], key: SortKey, dir: SortDir): TaskSummary[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    const av = key === "taskId" ? a.taskId : key === "createdAt" ? a.createdAt : a.updatedAt;
    const bv = key === "taskId" ? b.taskId : key === "createdAt" ? b.createdAt : b.updatedAt;
    if (av < bv) return -1 * sign;
    if (av > bv) return 1 * sign;
    // 二级稳定键：taskId 升序，保证同秒写入的任务顺序稳定
    return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
  });
}

export interface TaskFacets {
  agents: string[];
  projects: string[];
  statuses: string[];
  /** `errorType` 分面（只收非空值，排序稳定） */
  errorTypes: string[];
}

export function facetValues(tasks: TaskSummary[]): TaskFacets {
  const agents = new Set<string>();
  const projects = new Set<string>();
  const statuses = new Set<string>();
  const errorTypes = new Set<string>();
  for (const t of tasks) {
    if (t.agentId) agents.add(t.agentId);
    if (t.projectPath) projects.add(t.projectPath);
    if (t.status) statuses.add(t.status);
    if (t.errorType) errorTypes.add(t.errorType);
  }
  return {
    agents: [...agents].sort(),
    projects: [...projects].sort(),
    statuses: [...statuses].sort(),
    errorTypes: [...errorTypes].sort(),
  };
}

/** 活动态 / 终态计数（顶部统计条用） */
export function countByPhase(tasks: TaskSummary[]): { active: number; terminal: number } {
  let active = 0;
  let terminal = 0;
  for (const t of tasks) {
    if (isActiveStatus(t.status)) active += 1;
    else terminal += 1;
  }
  return { active, terminal };
}