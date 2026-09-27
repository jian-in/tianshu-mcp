/**
 * selectMenuItem 的判据测试（步 4/5/6 共用的「触发→精确匹配→回读」）。
 *
 * 这些断言把三条纪律固化成回归：
 * 1. 未命中必须**回显候选**，绝不模糊匹配；
 * 2. 多命中（同名/重复控件）即拒绝点击，不猜一个；
 * 3. 点中 ≠ 生效——回读不一致必须报 `readback`。
 */
import { describe, expect, it } from "vitest";
import {
  selectMenuItem,
  waitForTriggerText,
  type OpenDesignMenuPage,
} from "../../src/agents/opendesign/menu.js";
import type { OpenDesignSelectorKey } from "../../src/agents/opendesign/selectors.js";

interface StubState {
  triggerText: string;
  /** 触发器可见命中数（>1 = 无法唯一点击） */
  triggerCount: number;
  /** 菜单是否展开（点触发器后由桩切换） */
  menuOpen: boolean;
  items: string[];
  /** clickExact 的返回覆盖 */
  exact?: { clicked: boolean; count: number; available: string[] };
  /** 点击后触发器回读值（null = 不变，复刻「点了但没生效」） */
  afterClick?: string | null;
  /** 回读轮询期间是否「等一会儿才生效」 */
  delayedReadback?: boolean;
}

function makePage(state: StubState) {
  const calls: string[] = [];
  const page: OpenDesignMenuPage = {
    exists: async (key) => (key === "modelMenuItem" ? state.menuOpen : true),
    count: async () => (state.menuOpen ? state.items.length : 0),
    labels: async () => state.items,
    triggerText: async () => state.triggerText,
    clickKey: async () => {
      calls.push("clickKey");
      if (state.triggerCount !== 1) return { clicked: false, count: state.triggerCount };
      state.menuOpen = true;
      if (state.afterClick !== null && state.afterClick !== undefined)
        state.triggerText = state.afterClick;
      return { clicked: true, count: 1 };
    },
    clickExact: async (_key, value) => {
      calls.push(`clickExact:${value}`);
      if (state.exact) return state.exact;
      const hit = state.items.filter((i) => i.toLowerCase() === value.toLowerCase());
      if (hit.length !== 1) return { clicked: false, count: hit.length, available: state.items };
      state.menuOpen = false;
      if (state.afterClick != null) state.triggerText = state.afterClick;
      return { clicked: true, count: 1, available: state.items };
    },
    clearAndType: async () => {
      calls.push("clearAndType");
      return true;
    },
    waitFor: async (predicate, timeoutMs) => {
      const deadline = Date.now() + Math.min(timeoutMs, 200);
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        if (await predicate()) return true;
        if (Date.now() >= deadline) return false;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    dismissMenus: async () => {
      calls.push("dismissMenus");
      state.menuOpen = false;
    },
  };
  return { page, calls };
}

function base(over: Partial<StubState> = {}): StubState {
  return {
    triggerText: "",
    triggerCount: 1,
    menuOpen: false,
    items: ["deepseek-v4.1-flash", "deepseek-v4-pro"],
    afterClick: "deepseek-v4-pro",
    ...over,
  };
}

const KEY: OpenDesignSelectorKey = "modelTrigger";
const ITEM: OpenDesignSelectorKey = "modelMenuItem";

describe("selectMenuItem：菜单/面板精确选中", () => {
  it("已是目标值 → 直接复用，不做任何点击", async () => {
    const state = base({ triggerText: "deepseek-v4-pro" });
    const { page, calls } = makePage(state);
    const out = await selectMenuItem({
      page,
      triggerKey: KEY,
      itemKey: ITEM,
      target: "deepseek-v4-pro",
      budgetMs: 100,
      what: "模型",
    });
    expect(out.ok).toBe(true);
    expect(out.shown).toBe("deepseek-v4-pro");
    expect(calls).toEqual([]);
  });

  it("触发器无法唯一定位 → no-trigger（不做坐标点击）", async () => {
    const state = base({ triggerCount: 2 });
    const { page, calls } = makePage(state);
    const out = await selectMenuItem({
      page,
      triggerKey: KEY,
      itemKey: ITEM,
      target: "deepseek-v4-pro",
      budgetMs: 100,
      what: "模型",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("no-trigger");
    expect(calls).not.toContain("clickExact:deepseek-v4-pro");
  });

  it("菜单未展开 → no-menu", async () => {
    const state = base();
    const { page } = makePage(state);
    // 桩的 exists 依赖 menuOpen，而 clickKey 会打开菜单；这里直接让 exists 恒 false
    const deadPage: OpenDesignMenuPage = { ...page, exists: async () => false };
    const out = await selectMenuItem({
      page: deadPage,
      triggerKey: KEY,
      itemKey: ITEM,
      target: "deepseek-v4-pro",
      budgetMs: 30,
      what: "模型",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("no-menu");
  });

  it("同名多命中 → ambiguous 并回显候选（绝不猜一个点）", async () => {
    const state = base({
      exact: { clicked: false, count: 2, available: ["v4", "v4"] },
    });
    const { page } = makePage(state);
    const out = await selectMenuItem({
      page,
      triggerKey: KEY,
      itemKey: ITEM,
      target: "v4",
      budgetMs: 100,
      what: "模型",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("ambiguous");
    expect(out.candidates).toEqual(["v4", "v4"]);
    expect(out.message).toContain("多个同名候选");
  });

  it("未命中 → no-item 并回显当前可见候选", async () => {
    const state = base();
    const { page } = makePage(state);
    const out = await selectMenuItem({
      page,
      triggerKey: KEY,
      itemKey: ITEM,
      target: "不存在的模型",
      budgetMs: 100,
      what: "模型",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("no-item");
    expect(out.candidates).toEqual(["deepseek-v4.1-flash", "deepseek-v4-pro"]);
    expect(out.message).toContain("deepseek-v4.1-flash");
  });

  it("点中但回读不一致 → readback（点中 ≠ 生效）", async () => {
    const state = base({ afterClick: null });
    const { page } = makePage(state);
    const out = await selectMenuItem({
      page,
      triggerKey: KEY,
      itemKey: ITEM,
      target: "deepseek-v4-pro",
      budgetMs: 30,
      what: "模型",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("readback");
    expect(out.shown).toBe("");
  });

  it("搜索过滤路径：给出 searchKey 时先清空并输入，再精确点选", async () => {
    const state = base({
      items: ["Claude (Anthropic)", "Linear"],
      afterClick: "Claude (Anthropic)",
      triggerText: "",
    });
    const { page, calls } = makePage(state);
    const out = await selectMenuItem({
      page,
      triggerKey: "designSystemTrigger",
      itemKey: "designSystemItem",
      searchKey: "designSystemSearch",
      target: "Claude (Anthropic)",
      budgetMs: 100,
      dismissBeforeReadback: true,
      what: "设计系统",
    });
    expect(out.ok).toBe(true);
    expect(calls).toContain("clearAndType");
    expect(calls).toContain("clickExact:Claude (Anthropic)");
    expect(calls).toContain("dismissMenus");
  });

  it("waitForTriggerText 在预算内轮询到目标值（回读是异步的）", async () => {
    let text = "";
    const page = {
      triggerText: async () => text,
      waitFor: async (predicate: () => Promise<boolean>, timeoutMs: number) => {
        const deadline = Date.now() + Math.min(timeoutMs, 200);
        setTimeout(() => {
          text = "v4-pro";
        }, 10);
        for (;;) {
          // eslint-disable-next-line no-await-in-loop
          if (await predicate()) return true;
          if (Date.now() >= deadline) return false;
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 5));
        }
      },
    };
    const shown = await waitForTriggerText(page, KEY, "v4-pro", 200);
    expect(shown).toBe("v4-pro");
  });
});