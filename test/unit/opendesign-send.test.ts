/**
 * 发送段判据测试（步 7/8）。
 *
 * 三条纪律固化为回归：
 * 1. **发送前回读**：输入框不含本次任务标记就不点发送（否则会派一份空任务）；
 * 2. **只点一次、绝不重发**：确认不到只报 `send_unknown`，不重试；
 * 3. 确认证据分三种（消息落地 / 运行信号 / 输入框清空），但**清空单独不算成功**。
 */
import { describe, expect, it } from "vitest";
import {
  dispatchTask,
  judgeSendConfirmation,
  type OpenDesignSendPage,
} from "../../src/agents/opendesign/send.js";
import type { OpenDesignPollSnapshot } from "../../src/agents/opendesign/cdp.js";

const MARKER = "【tianshu:tsk_x:r0:initial】";

interface StubState {
  inputText: string;
  conversation: string;
  /** 点击发送后产生什么证据 */
  effect?: {
    conversationGrew?: boolean;
    running?: boolean;
    clearInput?: boolean;
  };
  /** 发送按钮是否可唯一点击 */
  sendCount?: number;
  sendClicked?: boolean;
}

function makePage(state: StubState) {
  let sendClicks = 0;
  const page: OpenDesignSendPage = {
    inputText: async () => state.inputText,
    conversationText: async () => state.conversation,
    typeText: async (text) => {
      state.inputText += text;
    },
    clickKey: async () => {
      sendClicks += 1;
      const count = state.sendCount ?? 1;
      if (count !== 1) return { clicked: false, count };
      const effect = state.effect ?? {};
      if (effect.conversationGrew) state.conversation += `\n${state.inputText}`;
      if (effect.clearInput) state.inputText = "";
      return { clicked: state.sendClicked ?? true, count: 1 };
    },
    poll: async (): Promise<OpenDesignPollSnapshot> => ({
      stopVisible: Boolean(state.effect?.running),
      sendStarting: false,
      conversationText: state.conversation,
      inputText: state.inputText,
      pageHidden: false,
    }),
    waitFor: async (_predicate, timeoutMs) =>
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), Math.min(timeoutMs, 10))),
  };
  return { page, sendClicks: () => sendClicks };
}

describe("judgeSendConfirmation：派发确认判据", () => {
  it("消息落地或运行信号任一成立即算已派发", () => {
    expect(
      judgeSendConfirmation({ seenMessage: true, seenRunning: false, inputCleared: false }),
    ).toBe(true);
    expect(
      judgeSendConfirmation({ seenMessage: false, seenRunning: true, inputCleared: false }),
    ).toBe(true);
  });

  it("只有「输入框被清空」不算成功（可能是误触/Escape，宁可报未知）", () => {
    expect(
      judgeSendConfirmation({ seenMessage: false, seenRunning: false, inputCleared: true }),
    ).toBe(false);
  });
});

describe("dispatchTask：输入并发送", () => {
  it("输入框不含标记 → input_mismatch，且**不点发送**", async () => {
    const state: StubState = { inputText: "", conversation: "" };
    const { page, sendClicks } = makePage(state);
    // typeText 被替换成「什么都没输进去」（复刻 insertText 没落进受控编辑器）
    const broken: OpenDesignSendPage = { ...page, typeText: async () => {} };
    const out = await dispatchTask({
      page: broken,
      text: `${MARKER}\n任务`,
      marker: MARKER,
      confirmBudgetMs: 200,
      pollIntervalMs: 5,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("input_mismatch");
    expect(sendClicks()).toBe(0);
  });

  it("发送按钮不唯一 → send_failed，只尝试一次", async () => {
    const state: StubState = { inputText: "", conversation: "", sendCount: 2 };
    const { page, sendClicks } = makePage(state);
    const out = await dispatchTask({
      page,
      text: `${MARKER}\n任务`,
      marker: MARKER,
      confirmBudgetMs: 200,
      pollIntervalMs: 5,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("send_failed");
    expect(sendClicks()).toBe(1);
  });

  it("消息落地 → 确认成功", async () => {
    const state: StubState = {
      inputText: "",
      conversation: "",
      effect: { conversationGrew: true, running: true },
    };
    const { page, sendClicks } = makePage(state);
    const out = await dispatchTask({
      page,
      text: `${MARKER}\n任务`,
      marker: MARKER,
      confirmBudgetMs: 200,
      pollIntervalMs: 5,
    });
    expect(out.ok).toBe(true);
    expect(out.evidence?.seenMessage).toBe(true);
    expect(sendClicks()).toBe(1);
  });

  it("无任何证据 → send_unknown 且绝不重发", async () => {
    const state: StubState = { inputText: "", conversation: "", effect: {} };
    const { page, sendClicks } = makePage(state);
    const out = await dispatchTask({
      page,
      text: `${MARKER}\n任务`,
      marker: MARKER,
      confirmBudgetMs: 50,
      pollIntervalMs: 5,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("send_unknown");
    expect(out.message).toContain("不重复发送");
    expect(sendClicks()).toBe(1);
  });
});