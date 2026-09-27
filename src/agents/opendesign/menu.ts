/**
 * Open Design 的「触发区 → 下拉/面板 → 精确选中 → 回读确认」通用选择器
 * （步 4/5/6 共用：模型、设计系统、设计方向）。
 *
 * 为什么抽成一份而不是三步各写一遍：三步的**判据纪律完全一致**，任何一处漏掉回读
 * 都会出现「点了但没生效却继续往下走」——那种错误最终会被归因到完全无关的地方
 * （历史教训：把「模型没切成功」报成「选择器漂移」）。集中一份即集中一份回归测试。
 *
 * 判据（每一步都 fail-closed）：
 * 1. 触发器必须**唯一可见**，否则 `no-trigger`（回显可见命中数）；
 * 2. 展开后菜单/面板必须在预算内出现，否则 `no-menu`；
 * 3. 菜单项按**可见文本/aria 精确匹配**（NFKC 归一后全等），未命中回显当前可见候选；
 *    **绝不退化成模糊匹配**——选错模型/设计系统比报错危险得多；
 * 4. 回读触发器文本，与目标不一致即 `readback`（点中 ≠ 生效）。
 */
import type { AgentRunLogger } from "../adapter.js";
import type { OpenDesignSelectorKey } from "./selectors.js";
import { exactUiName } from "./model.js";

/** 选择器需要的最小页面能力（真实实现为 `cdp.ts` 的 OpenDesignCdpClient；单测注入内存桩） */
export interface OpenDesignMenuPage {
  exists(key: OpenDesignSelectorKey): Promise<boolean>;
  count(key: OpenDesignSelectorKey): Promise<number>;
  labels(key: OpenDesignSelectorKey): Promise<string[]>;
  triggerText(key: OpenDesignSelectorKey): Promise<string>;
  clickKey(
    key: OpenDesignSelectorKey,
    options?: { expect?: "working-dir-panel" | "none"; expectBudgetMs?: number },
  ): Promise<{ clicked: boolean; count: number }>;
  clickExact(
    key: OpenDesignSelectorKey,
    value: string,
  ): Promise<{ clicked: boolean; count: number; available: string[] }>;
  /** 在指定语义键的输入框里清空后键入（设计系统面板的搜索框） */
  clearAndType(key: OpenDesignSelectorKey, text: string): Promise<boolean>;
  waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean>;
  dismissMenus(): Promise<void>;
}

export type MenuSelectReason =
  | "no-trigger"
  | "no-menu"
  | "no-item"
  | "ambiguous"
  | "click"
  | "readback";

export interface MenuSelectOutcome {
  ok: boolean;
  /** 已完成选择（含「本来就是目标值」的复用分支） */
  reason?: MenuSelectReason;
  /** 回读到（或复用）的当前值文本 */
  shown?: string;
  /** 未命中时的可见候选（fail-closed 报错必须回显） */
  candidates?: string[];
  message?: string;
}

export interface SelectMenuItemInput {
  page: OpenDesignMenuPage;
  /** 触发器语义键（模型/设计系统/设计方向） */
  triggerKey: OpenDesignSelectorKey;
  /** 菜单项语义键 */
  itemKey: OpenDesignSelectorKey;
  /** 目标显示名（精确匹配） */
  target: string;
  /** 展开菜单/面板的预算（ms） */
  budgetMs: number;
  /** 该面板需要先搜索过滤时给出搜索框语义键（设计系统） */
  searchKey?: OpenDesignSelectorKey;
  /** 面板会遮住触发器文本时，回读前先关闭浮层 */
  dismissBeforeReadback?: boolean;
  /** 面向人的步骤名（模型 / 设计系统 / 设计方向），只用于文案 */
  what: string;
  logger?: AgentRunLogger;
}

function join(available: string[]): string {
  return available.slice(0, 20).join("、");
}

/**
 * 在菜单/面板里精确选中目标项并回读确认。
 *
 * 返回 `{ok:true}` 表示**回读已确认**；`{ok:false, reason}` 由调用方决定是
 * 硬失败还是转 `needs_user`（本模块不做该决策）。
 */
export async function selectMenuItem(input: SelectMenuItemInput): Promise<MenuSelectOutcome> {
  const { page, triggerKey, itemKey, target, budgetMs, what } = input;
  const log = input.logger;

  // 1) 已是目标值 → 复用（不做无意义点击，也不改动用户既有选择）
  const before = await page.triggerText(triggerKey);
  if (exactUiName(before, target)) {
    log?.info(`[opendesign] ${what}回读已匹配，复用「${before}」`);
    return { ok: true, shown: before };
  }

  // 2) 展开触发器（可信点击；坐标缺失即 fail-closed）
  const opened = await page.clickKey(triggerKey);
  if (opened.count !== 1 || !opened.clicked)
    return {
      ok: false,
      reason: "no-trigger",
      message: `「${what}」触发器无法唯一点击（匹配 ${opened.count}）——选择器可能已漂移`,
    };

  // 3) 等菜单/面板出现
  const menuReady = await page.waitFor(() => page.exists(itemKey), budgetMs);
  if (!menuReady)
    return {
      ok: false,
      reason: "no-menu",
      message: `点击「${what}」触发器后 ${budgetMs}ms 内未出现可选项（菜单/面板未展开或点击被吞）`,
    };

  // 4) 需要过滤时先搜索（搜索只负责把目标行渲染出来，不参与身份判定）
  if (input.searchKey) {
    const filtered = await page.clearAndType(input.searchKey, target);
    if (!filtered) {
      await page.dismissMenus();
      return { ok: false, reason: "no-menu", message: `「${what}」面板的搜索框无法定位或输入` };
    }
  }

  // 5) 精确匹配并点击
  const click = await page.clickExact(itemKey, target);
  if (click.count > 1) {
    await page.dismissMenus();
    return {
      ok: false,
      reason: "ambiguous",
      candidates: click.available,
      message: `「${what}」存在多个同名候选，无法消歧（匹配 ${click.count}）：${join(click.available)}`,
    };
  }
  if (!click.clicked) {
    const visible = click.available.length ? click.available : await page.labels(itemKey);
    await page.dismissMenus();
    return {
      ok: false,
      reason: "no-item",
      candidates: visible,
      message: `未找到${what}「${target}」${visible.length ? `；当前可见候选：${join(visible)}` : "；当前菜单没有可见候选项"}`,
    };
  }

  // 6) 回读确认（点中 ≠ 生效）
  if (input.dismissBeforeReadback) await page.dismissMenus();
  const shown = await waitForTriggerText(page, triggerKey, target, Math.min(budgetMs, 5_000));
  if (!exactUiName(shown, target))
    return {
      ok: false,
      reason: "readback",
      shown,
      message: `「${what}」回读不一致：期望「${target}」，实际「${shown || "空"}」`,
    };
  log?.info(`[opendesign] ${what}已切换并回读：${shown}`);
  return { ok: true, shown };
}

/**
 * 在预算内轮询触发器文本直到与目标一致。
 * 回读是异步的（面板关闭 + 状态落定需要时间），读一次必然读到中间态。
 */
export async function waitForTriggerText(
  page: Pick<OpenDesignMenuPage, "triggerText" | "waitFor">,
  triggerKey: OpenDesignSelectorKey,
  target: string,
  budgetMs: number,
): Promise<string> {
  let last = await page.triggerText(triggerKey);
  if (exactUiName(last, target)) return last;
  await page.waitFor(async () => {
    last = await page.triggerText(triggerKey);
    return exactUiName(last, target);
  }, budgetMs);
  return last;
}