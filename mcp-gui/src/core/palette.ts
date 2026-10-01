/**
 * 命令面板的**命令目录与模糊匹配**（纯函数，可单测）。
 *
 * 目录由 `buildCommands` 从既有数据（任务列表 / 数据目录）装配，文案经传入的 `t` 解析，
 * 因此本模块不依赖 Vue、不依赖 i18n 单例，测试里给个假 `t` 即可。
 * 面板组件只负责渲染与派发 `id`——**动作实现仍在 `App.vue`**（面板不知道视图状态）。
 */
import type { TaskSummary } from "@/api/types";

/** 与 `useI18n().t` 同形的最小翻译函数签名 */
export type Translate = (path: string, params?: Record<string, string | number>) => string;

type PaletteGroup = "nav" | "tasks" | "homes";

export interface PaletteCommand {
  /** 稳定标识：`nav:<view>` / `task:<taskId>` / `home:<path>`，由调用方据此分发 */
  id: string;
  group: PaletteGroup;
  label: string;
  /** 右侧次要说明（路径 / 状态等）；无则 `null` */
  hint: string | null;
  /** 模糊匹配的附加词（小写）；`label` 本身也会参与匹配 */
  keywords: string[];
}

/** 任务命令的条数上限：任务可能上千，面板不做虚拟滚动，超出部分**如实提示**而不是静默丢弃 */
export const PALETTE_TASK_LIMIT = 50;

/** 结果列表的展示上限 */
export const PALETTE_RESULT_LIMIT = 20;

export function buildCommands(
  t: Translate,
  input: {
    tasks: TaskSummary[];
    dataHomes: string[];
    /** 当前数据目录（命中项加「当前」标注） */
    activeHome: string;
  },
): PaletteCommand[] {
  const nav: PaletteCommand[] = [
    navItem("nav:overview", t("palette.cmdOverview")),
    navItem("nav:insights", t("palette.cmdInsights")),
    navItem("nav:serverLog", t("palette.cmdServerLog")),
    navItem("nav:capabilities", t("palette.cmdCapabilities")),
    navItem("nav:search", t("palette.cmdSearch")),
    navItem("nav:settings", t("palette.cmdSettings")),
  ];

  const homes: PaletteCommand[] = input.dataHomes.map((path) => ({
    id: `home:${path}`,
    group: "homes" as const,
    label: t("palette.cmdSwitchHome", { path }),
    hint: path === input.activeHome ? t("palette.homeActive") : null,
    keywords: [path.toLowerCase()],
  }));

  const shown = input.tasks.slice(0, PALETTE_TASK_LIMIT);
  const tasks: PaletteCommand[] = shown.map((task) => ({
    id: `task:${task.taskId}`,
    group: "tasks" as const,
    label: t("palette.cmdOpenTask", { id: task.taskId }),
    hint: task.task ? truncate(task.task, 60) : null,
    keywords: [task.taskId.toLowerCase(), task.task.toLowerCase(), task.agentId.toLowerCase()],
  }));

  return [...nav, ...homes, ...tasks];
}

function navItem(id: string, label: string): PaletteCommand {
  return { id, group: "nav", label, hint: null, keywords: [] };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * 子序列模糊匹配：`query` 的字符需按序出现在 `text` 中（不区分大小写）。
 * 返回分数（越大越靠前）：连续命中与更靠前的起始位置得分更高；不匹配返回 `null`。
 * 空 `query` 返回 0（视为全匹配）。
 */
export function fuzzyScore(text: string, query: string): number | null {
  const hay = text.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (needle === "") return 0;

  let score = 0;
  let cursor = 0;
  let prevHit = -2;
  for (const ch of needle) {
    const at = hay.indexOf(ch, cursor);
    if (at < 0) return null;
    // 连续命中额外加分；命中越靠前分越高
    score += at === prevHit + 1 ? 3 : 1;
    score += Math.max(0, 8 - at);
    prevHit = at;
    cursor = at + 1;
  }
  // 前缀命中再加权（「ins」应优先于「insights」中间位置的同序命中）
  if (hay.startsWith(needle)) score += 10;
  return score;
}

/** 命令的匹配分数：取 `label` 与 `keywords` 中的最高分 */
export function scoreCommand(command: PaletteCommand, query: string): number | null {
  const candidates = [command.label, ...command.keywords];
  let best: number | null = null;
  for (const text of candidates) {
    const score = fuzzyScore(text, query);
    if (score === null) continue;
    best = best === null ? score : Math.max(best, score);
  }
  return best;
}

/**
 * 过滤 + 排序：分数降序，同分按分组（导航 → 目录 → 任务）与标签稳定排序，最后截断到 `limit`。
 * 空查询时保持目录原顺序（导航优先），便于「打开即见」。
 */
export function filterCommands(
  commands: PaletteCommand[],
  query: string,
  limit = PALETTE_RESULT_LIMIT,
): PaletteCommand[] {
  const max = Math.max(0, Math.trunc(limit));
  if (query.trim() === "") return commands.slice(0, max);

  const order: Record<PaletteGroup, number> = { nav: 0, homes: 1, tasks: 2 };
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter((row): row is { command: PaletteCommand; index: number; score: number } => row.score !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        order[a.command.group] - order[b.command.group] ||
        a.index - b.index,
    )
    .slice(0, max)
    .map((row) => row.command);
}

/** 列表键盘导航：上下移动并**循环**；空列表恒为 0（不产生越界索引） */
export function stepIndex(count: number, index: number, delta: number): number {
  if (count <= 0) return 0;
  return (index + delta + count) % count;
}