/**
 * Open Design 的「工作目录」绑定（计划 P2 / 图 1、图 2）。
 *
 * 时序（与截图一一对应，改动前先看 docs/opendesign-cdp.md §5）：
 *   1. 回读当前工作目录显示值 —— **已是目标目录就直接跳过**（不做无意义点击）；
 *   2. 展开「工作目录」触发器；
 *   3. 点「选择目录」菜单项 → 弹出 Windows 原生「选择文件夹」对话框；
 *   4. 走 `dialog.ts` 填绝对路径 → 回读校验 → 确认 → 等对话框关闭；
 *   5. **回读工作目录显示值**，确认绑定真的生效（原生对话框关闭 ≠ 应用已接受该目录）。
 *
 * 门禁纪律：
 * - 步骤 2/3 用**坐标点击**（可信点击），但坐标来自 DOM 实测；坐标缺失即 fail-closed；
 * - 原生对话框的**基线**必须在点「选择目录」之前采样，否则会把用户自己的对话框当成本次弹出的；
 * - 任一步失败都返回结构化 `reason`，由上层决定转 `needs_user` 还是硬失败——
 *   绝不在「回读不一致」的情况下继续往下走（那会把后续失败归因到完全无关的地方）。
 */
import type { GuiProfile } from "../../config/schema.js";
import type { AgentRunLogger } from "../adapter.js";
import type { SelectorOverrides } from "./dom.js";
import type { OpenDesignSelectorKey } from "./selectors.js";
import {
  exactMatchPointExpression,
  existsExpression,
  selectorSpecFor,
  singlePointExpression,
  triggerTextExpression,
} from "./dom.js";
import {
  selectOpenDesignFolder,
  listOwnedDialogs,
  type FolderDialogDeps,
  type FolderDialogOutcome,
} from "./dialog.js";

/** 页面客户端最小接口（真实实现为 `cdp.ts` 的客户端；单测注入内存桩） */
export interface OpenDesignPage {
  evaluate<T = unknown>(expression: string): Promise<T>;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  clickAt(point: { x: number; y: number }, options?: { expect?: string }): Promise<boolean>;
}

/** 路径比较归一：Windows 大小写不敏感 + 反斜杠 + 去尾斜杠 */
export function normalizeWorkspacePath(value: string | undefined): string {
  let out = (value ?? "").trim().replace(/\//g, "\\").replace(/\\+$/, "");
  if (/^[a-zA-Z]:\.?$/.test(out)) out = `${out.slice(0, 2)}\\`;
  // 路径可能被界面截断成 `D:\Trae项目\tian…`，比较前统一去掉省略号尾巴
  out = out.replace(/(…|\.\.\.)$/, "");
  return process.platform === "win32" ? out.toLowerCase() : out;
}

/**
 * 目标路径是否与当前显示值一致。
 *
 * 三种形态（后两种来自真机实测）：
 * 1. 显示完整路径 → 直接相等；
 * 2. 以省略号截断（`D:\Trae项目\tian…`）→ 前缀匹配；
 * 3. **只显示末段目录名**（真机 2026-09-27：绑到 `D:\Trae项目\AI游戏\test` 后触发区只显示 `test`）
 *    → 末段相等**且**有独立旁证（产品已把该目录记为最近绑定）。
 *
 * 末段单独看太宽（`D:\a\test` 与 `D:\b\test` 区分不开），因此第 3 种**必须**带旁证，缺旁证一律拒绝
 * ——宁可多要一次人工确认，也不能把「绑错目录」当成功（那会让 MCP 往别的目录派活）。
 */
export function workspaceMatches(
  actual: string | undefined,
  wanted: string,
  sidecar?: { recentLinkedDirs?: string[] },
): boolean {
  const a = normalizeWorkspacePath(actual);
  const w = normalizeWorkspacePath(wanted);
  if (!a || !w) return false;
  if (a === w) return true;
  // 界面常见截断：以省略号结尾，只保留了前缀
  const shownEllipsis = /(…|\.\.\.)\s*$/.test((actual ?? "").trim());
  if (shownEllipsis && w.startsWith(a)) return true;
  // 只显示末段目录名：必须由产品自己的记录（app-config.recentLinkedDirs）佐证
  const tail = w.split("\\").filter(Boolean).pop() ?? "";
  if (!tail || a !== tail) return false;
  return (sidecar?.recentLinkedDirs ?? []).some((dir) => normalizeWorkspacePath(dir) === w);
}

export type WorkspaceBindReason =
  "already-bound" | "no-panel" | "no-item" | "click" | "native" | "readback" | "timeout";

export interface WorkspaceBindOutcome {
  ok: boolean;
  /** 绑定后回读到的工作目录显示值 */
  shown?: string;
  reason?: WorkspaceBindReason;
  message?: string;
  /** 原生对话框返回的细节（诊断用） */
  native?: FolderDialogOutcome;
}

export interface BindWorkspaceInput {
  page: OpenDesignPage;
  /** 目标绝对路径（项目根） */
  targetPath: string;
  /** 受管实例 pid（原生对话框归属核对用） */
  ownerPids: number[];
  gui: GuiProfile;
  logger: AgentRunLogger;
  overrides?: SelectorOverrides;
  signal?: AbortSignal;
  deps?: WorkspaceBindDeps;
}

export interface WorkspaceBindDeps extends FolderDialogDeps {
  listDialogs: (pids: number[], options: { signal?: AbortSignal }) => Promise<string[]>;
  selectFolder: (
    targetPath: string,
    pids: number[],
    baseline: string[],
    options: { signal?: AbortSignal; onProgress?: (stage: string) => void },
  ) => Promise<FolderDialogOutcome>;
  sleep: (ms: number) => Promise<void>;
  /**
   * 独立旁证：读产品自己记录的最近绑定目录（`app-config.json` 的 `recentLinkedDirs`，首位即最近一次）。
   * 触发区只显示末段目录名时靠它区分「绑对了」与「绑到了同名目录」。
   * 缺省返回空数组 = 无旁证 → 末段形态一律不放行（fail-closed）。
   */
  readRecentLinkedDirs?: () => Promise<string[]>;
}

/** 回读重试：产品把「最近绑定目录」异步落盘，触发区文本也可能晚一拍更新 */
const READBACK_ATTEMPTS = 4;
const READBACK_RETRY_MS = 700;

const DEFAULT_DEPS: WorkspaceBindDeps = {
  listDialogs: (pids, options) => listOwnedDialogs(pids, options),
  selectFolder: (targetPath, pids, baseline, options) =>
    selectOpenDesignFolder(targetPath, pids, baseline, options),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** 在预算内轮询直到谓词为真（返回是否命中） */
async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    signal?.throwIfAborted();
    // eslint-disable-next-line no-await-in-loop
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    // eslint-disable-next-line no-await-in-loop
    await sleep(200);
  }
}

/** 读回工作目录显示值（触发器文本；空串表示触发器缺失或还没渲染） */
export async function readWorkspaceValue(
  page: OpenDesignPage,
  overrides: SelectorOverrides = {},
): Promise<string> {
  return page.evaluate<string>(triggerTextExpression("workingDirValue", overrides));
}

/**
 * 等元素的中心坐标连续两次一致再返回（过渡动画结束）。
 *
 * 为什么必须等：面板/菜单展开有过渡动画，动画期间读到的 `rect` 还在移动，
 * 拿它去点就会落到空处。真机 2026-09-27 实测：手动序列在展开后隔 ~700ms 才点，
 * 「最近使用的目录」列表每次都出；适配器紧跟着点，列表始终不挂载 —— 就是踩了这个。
 */
async function waitForStablePoint(
  page: OpenDesignPage,
  key: OpenDesignSelectorKey,
  overrides: SelectorOverrides,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const read = async (): Promise<string> => {
    const r = await page.evaluate<{ count: number; point?: { x: number; y: number } }>(
      singlePointExpression(selectorSpecFor(key, overrides)),
    );
    return r.count === 1 && r.point ? `${Math.round(r.point.x)},${Math.round(r.point.y)}` : "";
  };
  let prev = await read();
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(150);
    const now = await read();
    if (now && now === prev) return;
    prev = now;
  }
}

/**
 * 试着用「最近使用的目录」切换工作目录：点入口 → 在列表里按文本**精确**点目标 → 回读校验。
 *
 * 为什么优先它：这是纯 DOM 点击，不碰 Win32 自动化。真机 2026-09-27 实测原生对话框路线
 * 时好时坏（一次成功，之后多次「对话框正常关闭、编辑框内容也对，但应用没接受」）。
 *
 * 返回 `null` 表示这条路线不可用（入口不在 / 列表无目标 / 点了没生效），由调用方回退原生对话框。
 */
async function bindViaRecentDirs(
  page: OpenDesignPage,
  targetPath: string,
  overrides: SelectorOverrides,
  deps: WorkspaceBindDeps,
  logger: AgentRunLogger,
): Promise<WorkspaceBindOutcome | null> {
  // 面板刚展开时入口还在动画中，先等它停稳再读坐标（见 waitForStablePoint 注释）
  await waitForStablePoint(page, "recentDirTrigger", overrides, deps.sleep);
  const entry = await page.evaluate<{ count: number; point?: { x: number; y: number } }>(
    singlePointExpression(selectorSpecFor("recentDirTrigger", overrides)),
  );
  if (entry.count !== 1 || !entry.point) return null;
  const opened = await page.clickAt(entry.point, { expect: "working-dir-recent-list" });
  if (!opened) return null;
  // 等列表**真的挂载**再匹配：盲目 sleep 在慢环境会读到一个还没渲染的列表，
  // 把「还没出来」误判成「列表里没有目标目录」（真机 2026-09-27 就栽在这里）。
  const listed = await waitUntil(
    () => page.evaluate<boolean>(existsExpression(selectorSpecFor("recentDirList", overrides))),
    5_000,
    deps.sleep,
  );
  if (!listed) {
    logger.info("[opendesign] 「最近使用的目录」列表未挂载，回退原生对话框");
    return null;
  }
  const tail = normalizeWorkspacePath(targetPath).split("\\").filter(Boolean).pop() ?? "";
  // 列表项可能显示完整路径，也可能只显示末段目录名 —— 两种都试，命中唯一才算数
  const wanted = [...new Set([targetPath, tail].filter(Boolean))];
  let available: string[] = [];
  for (const label of wanted) {
    const hit = await page.evaluate<{
      count: number;
      available: string[];
      point?: { x: number; y: number };
    }>(exactMatchPointExpression("recentDirItem", label, overrides));
    if (hit.available?.length) available = hit.available;
    if (hit.count !== 1 || !hit.point) continue;
    const clicked = await page.clickAt(hit.point, { expect: "workspace-bound" });
    if (!clicked) continue;
    const shown = await readWorkspaceValue(page, overrides);
    const recentLinkedDirs = (await deps.readRecentLinkedDirs?.()) ?? [];
    if (workspaceMatches(shown, targetPath, { recentLinkedDirs })) {
      logger.info(`[opendesign] 经「最近使用的目录」绑定成功：${shown}（点击「${label}」）`);
      return { ok: true, shown };
    }
  }
  logger.info(
    `[opendesign] 「最近使用的目录」未命中目标（候选：${JSON.stringify(available.slice(0, 8))}），回退原生对话框`,
  );
  return null;
}

/**
 * 绑定工作目录。返回结构化结果：
 * - `already-bound`：当前显示值已是目标目录（未做任何点击）；
 * - 其余 reason 表示失败，调用方据此决定 `needs_user` / 硬失败。
 */
export async function bindWorkspace(input: BindWorkspaceInput): Promise<WorkspaceBindOutcome> {
  const { page, targetPath, ownerPids, gui, logger } = input;
  const overrides = input.overrides ?? gui.selectors ?? {};
  const deps: WorkspaceBindDeps = { ...DEFAULT_DEPS, ...input.deps };
  const panelBudget = gui.projectTriggerTimeoutMs;

  // 1) 已是目标目录 → 跳过（不做无意义点击，也不改动用户既有绑定）
  //    这里必须与步骤 6 用**同一份判据与同一份旁证**：触发区只显示末段目录名（真机形态），
  //    少了 `recentLinkedDirs` 旁证就会把「已经绑好了」误判成「需要重新绑定」，
  //    接着去展开面板、等「选择目录」项，直到超时——真机 2026-09-28 就卡在这里。
  const before = await readWorkspaceValue(page, overrides);
  const recentBefore = (await deps.readRecentLinkedDirs?.()) ?? [];
  if (workspaceMatches(before, targetPath, { recentLinkedDirs: recentBefore })) {
    logger.info(`[opendesign] 工作目录已是目标值，跳过绑定：${before}`);
    return { ok: true, shown: before, reason: "already-bound" };
  }
  logger.info(`[opendesign] 工作目录当前为「${before || "(空)"}」，准备绑定到 ${targetPath}`);

  // 2) 展开「工作目录」触发器（坐标点击：可信点击；坐标来自 DOM 实测）
  const triggerPoint = await page.evaluate<{ count: number; point?: { x: number; y: number } }>(
    singlePointExpression(selectorSpecFor("workingDirTrigger", overrides)),
  );
  if (triggerPoint.count !== 1 || !triggerPoint.point) {
    return {
      ok: false,
      reason: "no-panel",
      message: `「工作目录」触发器无法唯一定位（匹配 ${triggerPoint.count}）——选择器可能已漂移`,
    };
  }
  const opened = await page.clickAt(triggerPoint.point, { expect: "working-dir-panel" });
  if (!opened) {
    return {
      ok: false,
      reason: "click",
      message: "点击「工作目录」后未观察到面板变化（合成点击可能被吞）",
    };
  }

  // 3) 等「选择目录」项出现（文本谓词兜底：菜单项文案是稳定的中文）
  logger.info("[opendesign] 已展开「工作目录」面板，等待「选择目录」项出现…");
  const itemReady = await waitUntil(
    () => page.evaluate<boolean>(existsExpression(selectorSpecFor("selectDirItem", overrides))),
    panelBudget,
    deps.sleep,
    input.signal,
  );
  if (!itemReady) {
    return {
      ok: false,
      reason: "no-item",
      message: `展开后未出现「选择目录」项（预算 ${panelBudget}ms）`,
    };
  }
  logger.info("[opendesign] 「选择目录」项已就位，准备切换工作目录");
  // 3.5) **优先走「最近使用的目录」**：纯 DOM 点击，不依赖 Win32 自动化。
  //      真机 2026-09-27 实测：原生对话框路线在两次运行间时好时坏 —— 一次绑定成功，
  //      之后多次都是「对话框正常关闭、编辑框内容也对，但应用没接受指定目录」；
  //      而面板里本就有「最近使用的目录」入口（探针实测 working-dir-recent）。
  //      能点它就绝不动原生对话框；不可用时再回退。
  const viaRecent = await bindViaRecentDirs(page, targetPath, overrides, deps, logger);
  if (viaRecent) return viaRecent;

  // 4) **基线必须在点击之前采样**：只有不在基线里的窗口才可能是本次弹出的
  const baseline = await deps.listDialogs(ownerPids, { signal: input.signal });

  const itemPoint = await page.evaluate<{
    count: number;
    available?: string[];
    point?: { x: number; y: number };
  }>(exactMatchPointExpression("selectDirItem", "选择目录", overrides));
  if (itemPoint.count !== 1 || !itemPoint.point) {
    return {
      ok: false,
      reason: "no-item",
      message:
        `「选择目录」项无法唯一点击（匹配 ${itemPoint.count}）` +
        `${itemPoint.available?.length ? `；当前可见候选：${itemPoint.available.slice(0, 10).join("、")}` : ""}`,
    };
  }
  const clicked = await page.clickAt(itemPoint.point, { expect: "native-folder-dialog" });
  if (!clicked) {
    return {
      ok: false,
      reason: "click",
      message: "点击「选择目录」未生效（原生对话框可能未弹出）",
    };
  }

  // 5) 原生对话框：填路径 → 回读 → 确认 → 等关闭
  // 原生对话框是已知慢点（Win32 对话框 + UIA 填路径），阶段进度用 info 级 —— 慢环境排查必须看得见。
  logger.info(`[opendesign] 开始原生「选择文件夹」：填入 ${targetPath}`);
  const native = await deps.selectFolder(targetPath, ownerPids, baseline, {
    signal: input.signal,
    onProgress: (stage) => logger.info(`[opendesign] 原生对话框：${stage}`),
  });
  if (!native.ok) {
    return {
      ok: false,
      reason: "native",
      message: native.message,
      native,
    };
  }

  // 6) 回读工作目录显示值：**对话框关闭 ≠ 应用已接受**
  //    触发区可能只显示末段目录名，且产品把「最近绑定目录」异步落盘，
  //    故在短窗口内重试（UI 值 + 独立旁证一起看），避免把「刚写下去」误判成失败。
  let shown = "";
  let matched = false;
  for (let attempt = 0; attempt < READBACK_ATTEMPTS; attempt++) {
    // eslint-disable-next-line no-await-in-loop
    shown = await readWorkspaceValue(page, overrides);
    // eslint-disable-next-line no-await-in-loop
    const recentLinkedDirs = (await deps.readRecentLinkedDirs?.()) ?? [];
    if (workspaceMatches(shown, targetPath, { recentLinkedDirs })) {
      matched = true;
      break;
    }
    if (attempt < READBACK_ATTEMPTS - 1) {
      logger.debug(
        `[opendesign] 工作目录回读暂未命中（第 ${attempt + 1} 次：「${shown}」），${READBACK_RETRY_MS}ms 后重试`,
      );
      // eslint-disable-next-line no-await-in-loop
      await deps.sleep(READBACK_RETRY_MS);
    }
  }
  if (!matched) {
    return {
      ok: false,
      reason: "readback",
      shown,
      native,
      message: `原生对话框已确认，但工作目录回读为「${shown}」，与目标不一致（未把绑定当成成功）`,
    };
  }
  logger.info(`[opendesign] 工作目录绑定成功：${shown}`);
  return { ok: true, shown, native };
}
