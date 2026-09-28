/**
 * Open Design 的「输入任务书 → 点发送 → 确认已派发」段（步 7/8）。
 *
 * 两条纪律：
 * 1. **发送前回读**：输入框里必须真的包含本次任务的标记（`【tianshu:…】`），
 *    否则说明 `Input.insertText` 没进到受控编辑器里——此时绝不能点发送（会派一份空任务）；
 * 2. **只点一次、绝不重发**：发送后进入有界确认；确认不到就如实报 `send_unknown`，
 *    重发会造成「同一任务在 GUI 里跑两遍」这种最难收拾的状态。
 */
import type { OpenDesignPollSnapshot } from "./cdp.js";

/** 发送段需要的最小页面能力（真实实现为 OpenDesignCdpClient；单测注入内存桩） */
export interface OpenDesignSendPage {
  inputText(): Promise<string>;
  conversationText(): Promise<string>;
  /** 清空任务输入框（全选 + 删除）。**输入任务书前必须先调用**，见 dispatchTask 注释 */
  clearInput(): Promise<boolean>;
  typeText(text: string): Promise<void>;
  clickKey(
    key: "sendButton",
    options?: { expect?: "working-dir-panel" | "none"; expectBudgetMs?: number },
  ): Promise<{ clicked: boolean; count: number }>;
  poll(): Promise<OpenDesignPollSnapshot>;
  waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean>;
  /** 有界等待（用于「重试一次」前的短暂让位） */
  sleep(ms: number): Promise<void>;
}

export interface SendConfirmationEvidence {
  /** 对话正文里出现了本次任务标记（= 用户消息已落地） */
  seenMessage: boolean;
  /** 出现运行信号（停止按钮 / 受理中） */
  seenRunning: boolean;
  /** 输入框已被清空（受控编辑器把内容交出去了） */
  inputCleared: boolean;
}

/**
 * 派发确认判据（纯函数，可单测）。
 *
 * `seenMessage` 或 `seenRunning` 任一成立即算已派发：
 * - `seenMessage`：任务书文本已出现在对话流里（最强证据）；
 * - `seenRunning`：停止按钮/受理中按钮出现（次强证据，覆盖「对话还没渲染完但已在跑」）。
 *
 * 刻意**不**把 `inputCleared` 单独当成功证据：清空也可能是误触/Escape 导致，
 * 只有它成立时宁可报 `send_unknown` 让调用方见到真实情况。
 */
export function judgeSendConfirmation(evidence: SendConfirmationEvidence): boolean {
  return evidence.seenMessage || evidence.seenRunning;
}

export type SendOutcomeReason = "input_mismatch" | "send_failed" | "send_unknown";

export interface SendOutcome {
  ok: boolean;
  reason?: SendOutcomeReason;
  message?: string;
  evidence?: SendConfirmationEvidence;
  /** 发送前的对话文本（返修轮基线与诊断用） */
  before: string;
}

export interface DispatchTaskInput {
  page: OpenDesignSendPage;
  /** 要发送的完整文本（已含标记与上下文） */
  text: string;
  /** 本次任务的标记（回读判据） */
  marker: string;
  /** 派发确认预算（ms） */
  confirmBudgetMs: number;
  /** 确认轮询间隔（ms） */
  pollIntervalMs: number;
}

/**
 * 输入并发送任务书，返回是否**已确认派发**。
 * 调用方在 `ok:false` 时必须按 reason 落终态且**不得重试发送**。
 */
export async function dispatchTask(input: DispatchTaskInput): Promise<SendOutcome> {
  const { page, text, marker } = input;
  const before = await page.conversationText().catch(() => "");

  /**
   * **先清空再输入**（真机 2026-09-28 实测）：首页输入框可能残留产品模板或上次草稿，
   * 而 `Input.insertText` 是**插到光标处**、不是替换全文 —— 真机上就出现了
   * 「游戏化习惯应用 制作一份新员工入职指南… 应用，用经验值…」这种模板与任务书混杂的 55 字文本，
   * 回读不含本次标记，于是 fail-closed 放弃发送；用户看到的现象正是「没有点击发送按钮」。
   */
  const cleared = await page.clearInput().catch(() => false);
  if (!cleared)
    return {
      ok: false,
      reason: "input_mismatch",
      before,
      message:
        "任务输入框无法唯一定位（清空失败）——选择器可能已漂移或页面不在首页；已放弃发送，避免把任务插进残留文本",
    };

  await page.typeText(text);
  // 输入回读：受控编辑器可能晚一拍才反映 insertText，**重读一次**（计划 §5「重试一次后硬失败」）；
  // 重读仍不含标记 → 判 input_mismatch 且**不点发送**（否则会派一份空任务）。
  let typed = await page.inputText();
  if (!typed.includes(marker)) {
    await page.sleep(300);
    typed = await page.inputText();
  }
  if (!typed.includes(marker))
    return {
      ok: false,
      reason: "input_mismatch",
      before,
      message: `输入框回读不一致（未包含本次任务标记，已重读一次），已放弃发送以避免派发空任务：实际 ${typed.length} 字`,
    };

  /**
   * 发送按钮：**不可用时重试一次**（按钮可能刚由「未就绪」转为可用，计划 §5），仍不可用才硬失败。
   *
   * 注意重试的边界：这里重试的是「点不到按钮」；**「发送结果无法确认」绝不重试**——
   * 那一路径下第一次点击可能已经生效，再点一次就是重复派单（最危险的状态）。
   */
  let clicked = await page.clickKey("sendButton");
  let clickAttempts = 1;
  if (clicked.count !== 1 || !clicked.clicked) {
    await page.sleep(500);
    clicked = await page.clickKey("sendButton");
    clickAttempts = 2;
  }
  if (clicked.count !== 1 || !clicked.clicked)
    return {
      ok: false,
      reason: "send_failed",
      before,
      message: `发送按钮无法唯一点击（已尝试 ${clickAttempts} 次；匹配 ${clicked.count}）——窗口可能被遮挡或选择器漂移`,
    };

  let evidence: SendConfirmationEvidence = {
    seenMessage: false,
    seenRunning: false,
    inputCleared: false,
  };
  const deadline = Date.now() + input.confirmBudgetMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const [conversation, inputText, poll] = await Promise.all([
      page.conversationText().catch(() => ""),
      page.inputText().catch(() => ""),
      page.poll().catch(() => undefined),
    ]);
    evidence = {
      seenMessage:
        evidence.seenMessage || (Boolean(marker) && conversation.includes(marker)),
      seenRunning:
        evidence.seenRunning || Boolean(poll && (poll.stopVisible || poll.sendStarting)),
      inputCleared: evidence.inputCleared || !inputText.normalize("NFKC").trim(),
    };
    if (judgeSendConfirmation(evidence)) return { ok: true, before, evidence };
    // eslint-disable-next-line no-await-in-loop
    await page.waitFor(async () => false, Math.min(input.pollIntervalMs, 500));
  }
  return {
    ok: false,
    reason: "send_unknown",
    before,
    evidence,
    message:
      `发送结果无法确认（对话出现任务标记=${evidence.seenMessage}，运行信号=${evidence.seenRunning}，` +
      `输入框已清空=${evidence.inputCleared}）；**不重复发送**，请到 Open Design 窗口确认本轮是否已在运行`,
  };
}