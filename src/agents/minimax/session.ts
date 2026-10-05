/**
 * 会话建立与定位。
 *
 * 真机事实（2026-10-05，MiniMax Code 3.1.0）：
 * 1) 侧栏「新建任务」的 `data-testid="sidebar-shortcut-task.new"` **挂在 `<kbd>` 上**
 *    （显示 Ctrl+N）；真正可点击的是它的祖先 `button[aria-label="新建任务"]`。
 *    直接点 kbd 无效——这是本适配器与其它 6 个的关键差异之一；
 * 2) 新建任务后**不会自动清空项目**（实测仍停在 `.appdata`）：进入会话后仍需显式核对/绑定项目；
 * 3) 会话条目本身**没有显式 id 属性**（`sidebar-session-group` 只给 `data-workspace-dir`），
 *    因此会话锚点只能记「项目路径 + 会话标题」。定位原会话必须唯一匹配，
 *    **绝不打开「最近会话」**。
 */
import type { MinimaxProjectGroup } from "./workspace.js";
import { normalizeProjectName, normalizeProjectPath } from "./workspace.js";

export interface MinimaxDraftCdp {
  newTask(): Promise<boolean>;
  newTaskInProject(): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}

export interface MinimaxDraftDeps {
  sleep?: (ms: number) => Promise<void>;
  /** 轮询间隔（ms）；默认 100 */
  pollIntervalMs?: number;
  /** 点击被吞后的重试间隔（ms）；默认 1500 */
  reclickMs?: number;
}

/**
 * 建立新的会话（草稿），并以「输入框 + 模型触发器已挂载」确认它真的建立了。
 *
 * 流程：点「新建任务」→ 等输入框挂载；未挂载则**周期性重试**（全局入口与「在该项目中新建任务」
 * 交替），直到截止时间；始终未挂载即 fail-closed 返回 false（调用方不得发送任务）。
 *
 * 为什么必须重试而不是点两次：真机实测单次合成点击会被 Chromium 节流吞掉，
 * 表现为「点了新建任务却毫无反应」。置前（focusMainWindow）能显著降低概率，但不能消除，
 * 所以以「输入框已挂载」为准做有界重试。
 */
export async function ensureFreshDraft(
  cdp: MinimaxDraftCdp,
  deadlineMs: number,
  deps: MinimaxDraftDeps = {},
): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const interval = deps.pollIntervalMs ?? 100;
  const reclick = deps.reclickMs ?? 1_500;
  let lastClick = 0;
  let useProjectEntry = false;
  while (Date.now() < deadlineMs) {
    if (Date.now() - lastClick >= reclick) {
      // 首次必然点击（lastClick=0）：初始任务一律新建会话，**不复用**可能残留的旧会话。
      // 之后交替使用两个入口：全局入口可靠，分组入口在「已停在某会话」时更精确。
      await (useProjectEntry ? cdp.newTaskInProject() : cdp.newTask());
      useProjectEntry = !useProjectEntry;
      lastClick = Date.now();
    }
    if (await cdp.exists("chatInput")) return true;
    await sleep(interval);
  }
  return cdp.exists("chatInput");
}

export interface MinimaxSessionsCdp {
  sessionTitles(): Promise<{ dir: string; title: string }[]>;
  projectGroups(): Promise<MinimaxProjectGroup[]>;
  projectTriggerText(): Promise<string>;
}

export interface MinimaxSessionLocation {
  found: boolean;
  /** 命中来源：project-group=当前项目分组就是目标；title=按标题唯一命中 */
  source?: "project-group" | "title";
  title?: string;
  reason?: "missing-anchor" | "not-found" | "ambiguous";
}

/**
 * 唯一定位当前会话所属项目。
 *
 * 判据分两层（都是可观测事实，不猜）：
 * 1. **项目分组**：`data-workspace-dir` 与 projectPath 归一后严格相等 → 命中即确认
 *    （这是权威判据，导航栏当前项目名只是辅助）；
 * 2. 分组不存在时回退**项目触发器文本**与目录基名比较——只作弱判据，
 *    因为同名不同目录无法区分，此时必须由调用方按「唯一命中」纪律处理。
 *
 * id 与标题都缺失、命中 0 条或多条 → 一律 found:false，不做「取列表第一项」之类的猜测。
 */
export async function locateSessionProject(
  cdp: MinimaxSessionsCdp,
  projectPath: string,
  sessionTitle?: string,
  platform: NodeJS.Platform = process.platform,
): Promise<MinimaxSessionLocation> {
  if (!projectPath && !sessionTitle) return { found: false, reason: "missing-anchor" };
  const target = normalizeProjectPath(projectPath, platform);
  const groups = await cdp.projectGroups().catch(() => [] as MinimaxProjectGroup[]);
  if (target) {
    const exact = groups.filter(
      (g) => g.dir && normalizeProjectPath(g.dir, platform) === target,
    );
    if (exact.length === 1) return { found: true, source: "project-group" };
    if (exact.length > 1) return { found: false, reason: "ambiguous" };
  }
  // 分组缺席（新项目尚未登记）时的弱判据：项目触发器文本 vs 目录基名。
  const trigger = (await cdp.projectTriggerText().catch(() => "")) || "";
  const base = projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  if (base && normalizeProjectName(trigger) === normalizeProjectName(base))
    return { found: true, source: "title" };
  if (sessionTitle) {
    const sessions = await cdp.sessionTitles().catch(() => [] as { dir: string; title: string }[]);
    const wantedTitle = normalizeProjectName(sessionTitle);
    const matches = sessions.filter((s) => normalizeProjectName(s.title) === wantedTitle);
    if (matches.length === 1) return { found: true, source: "title", title: matches[0]!.title };
    if (matches.length > 1) return { found: false, reason: "ambiguous" };
  }
  return { found: false, reason: groups.length ? "not-found" : "missing-anchor" };
}
