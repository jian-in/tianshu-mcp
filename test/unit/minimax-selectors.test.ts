import { describe, expect, it } from "vitest";
import { MM_MAIN_SELECTORS, MM_MENU_SELECTORS, cssCandidates, mainSpec, menuSpec, resolveFnSource } from "../../src/agents/minimax/selectors.js";
import {
  contextOptionsExpression,
  effortOptionsExpression,
  hoverPointExpression,
  newTaskPointExpression,
  pollExpression,
  sendButtonPointExpression,
  submenuOpenExpression,
  submenuOwnerExpression,
} from "../../src/agents/minimax/dom.js";
import {
  minimaxMainTargetRank,
  minimaxMenuTargetRank,
  retryMinimaxEvaluation,
  CdpUnavailableError,
} from "../../src/agents/minimax/cdp.js";

/**
 * 选择器表与页面内表达式。
 *
 * 这些判据全部来自真机实测（2026-10-05，MiniMax Code 3.1.0），
 * 关键点：*只能靠结构断言保护*（真机 DOM 无法在单测里复现），所以这里断言的是
 * 「选择器是否指向正确的结构特征」以及「表达式是否内嵌了必要的归属/可见性判据」。
 */
describe("MiniMax Code 选择器表", () => {
  it("主窗口关键键都存在且指向实测 testid", () => {
    expect(MM_MAIN_SELECTORS.newTask.primary).toContain("sidebar-shortcut-task.new");
    expect(MM_MAIN_SELECTORS.chatInput.primary).toContain("message-textarea");
    expect(MM_MAIN_SELECTORS.sendButton.primary).toContain("send-button");
    expect(MM_MAIN_SELECTORS.stopButton.primary).toContain("stop-button");
    expect(MM_MAIN_SELECTORS.modelTrigger.primary).toContain("model-selector-trigger");
    expect(MM_MAIN_SELECTORS.permissionLabel.primary).toContain("permission-mode-label");
    expect(MM_MAIN_SELECTORS.projectTrigger.primary).toContain("project-selector-trigger");
    expect(MM_MAIN_SELECTORS.sessionGroup.primary).toContain("sidebar-session-group");
  });

  it("弹层关键键指向真机实测结构（二级子菜单 + sr-only 名 + 上下文窗口组）", () => {
    // 模型项必须要求 aria-haspopup=menu：只有这些项能展开子菜单
    expect(MM_MENU_SELECTORS.modelOption.primary).toContain('aria-haspopup="menu"');
    // 模型名必须取 sr-only（innerText 是省略号分段的重复拼接）
    expect(MM_MENU_SELECTORS.modelName.primary).toContain("span.sr-only");
    // 推理等级组按 aria-label 匹配
    expect(MM_MENU_SELECTORS.effortGroup.primary).toContain("推理等级");
    // 上下文窗口组按 testid 匹配，且 aria-label 含动态模型名 → 必须用 ariaPatterns
    expect(MM_MENU_SELECTORS.contextGroup.primary).toContain("model-context-control");
    expect(MM_MENU_SELECTORS.contextGroup.ariaPatterns).toContain("上下文窗口");
    // 子菜单根用 :not() 排除顶层，而不是「取最后一个」
    expect(MM_MENU_SELECTORS.submenuRoot.primary).toContain(':not([aria-label="选择模型"])');
  });

  it("默认禁用的键必须留空（绝不内置猜测型选择器）", () => {
    expect(MM_MAIN_SELECTORS.userGate.primary).toBe("");
    expect(MM_MAIN_SELECTORS.errorRetryButton.primary).toBe("");
  });

  it("cssCandidates：profile 覆盖优先且去重", () => {
    const spec = MM_MAIN_SELECTORS.chatInput;
    const out = cssCandidates(spec, { chatInput: "#custom" }, "chatInput");
    expect(out[0]).toBe("#custom");
    expect(out).toContain(spec.primary);
    expect(new Set(out).size).toBe(out.length);
  });

  it("mainSpec / menuSpec：输出可直接内嵌的 JSON 参数数组", () => {
    const main = JSON.parse(mainSpec("sendButton")) as unknown[];
    expect(Array.isArray(main)).toBe(true);
    expect((main[0] as string[])[0]).toContain("send-button");
    // menu 键带前缀，避免与主窗口同名键冲突
    const menu = JSON.parse(menuSpec("contextOption")) as unknown[];
    expect((menu[0] as string[])[0]).toContain("model-context-control");
  });

  it("resolveFnSource：导出页面内解析函数（含 NFKC 归一与 scope 支持）", () => {
    const src = resolveFnSource();
    expect(src).toContain("function __minimaxResolve");
    expect(src).toContain("normalize('NFKC')");
    expect(src).toContain("scopeSel");
  });
});

describe("MiniMax Code 页面内表达式（结构契约）", () => {
  it("newTaskPoint：必须命中祖先 button（testid 挂在 kbd 上，直点无效）", () => {
    const expr = newTaskPointExpression();
    expect(expr).toContain("closest('button')");
    expect(expr).toContain("mm:new-task-point");
  });

  it("sendButtonPoint：必须用 aria-disabled 判可用（发送按钮是 DIV，没有 disabled 属性）", () => {
    const expr = sendButtonPointExpression();
    expect(expr).toContain("aria-disabled");
    expect(expr).toContain("elementFromPoint");
  });

  it("submenuOpen：判据含**归属**（aria-label === 目标模型名）与内容两项", () => {
    const expr = submenuOpenExpression("M3");
    expect(expr).toContain('"M3"');
    expect(expr).toContain("model-context-control");
    // 归属不匹配时必须返回 false（否则会读到上个模型的残留 DOM）
    expect(expr).toContain("!== 1) return false");
  });

  it("submenuOwner：排除顶层「选择模型」，返回子菜单归属模型名", () => {
    const expr = submenuOwnerExpression();
    expect(expr).toContain("选择模型");
    expect(expr).toContain("aria-label");
  });

  it("effortOptions / contextOptions：限定在目标模型的子菜单内（防跨模型串档位）", () => {
    for (const expr of [effortOptionsExpression("M3"), contextOptionsExpression("M3")]) {
      expect(expr).toContain('"M3"');
      expect(expr).toContain("roots[0].contains(e)");
      expect(expr).toContain("!== 1) return []");
    }
  });

  it("contextOptions：带「用量较高」标记（诊断用，不参与选择）", () => {
    expect(contextOptionsExpression("M3")).toContain("higherUsage");
    expect(contextOptionsExpression("M3")).toContain("model-context-higher-usage-tag");
  });

  it("hoverPoint：按归一名精确匹配（前缀不得命中 M3 vs M3.1-Flash-Preview）", () => {
    const expr = hoverPointExpression("M3");
    expect(expr).toContain("mmNorm(mmLabel(e)) === target");
  });

  it("poll：一次求值给出全部信号，且失败文案正则可捕获真实失败形态", () => {
    const expr = pollExpression();
    expect(expr).toContain("stopVisible");
    expect(expr).toContain("sendDisabled");
    expect(expr).toContain("errorText");
    expect(expr).toContain("pageHidden");
    // 失败文案：只匹配「界面上的失败提示」，且不得把正常回复误判（不能裸匹配「失败」）
    expect(expr).toContain("请求失败");
    expect(expr).not.toMatch(/\/失败\//);
  });
});

describe("MiniMax Code CDP 目标排序与重试", () => {
  it("mainTargetRank：title 恰为 MiniMax Code 者优先，弹层与截图页排后", () => {
    expect(minimaxMainTargetRank({ title: "MiniMax Code", url: "app://./archon" })).toBe(0);
    expect(minimaxMainTargetRank({ title: "", url: "app://./other" })).toBe(1);
    expect(
      minimaxMainTargetRank({
        title: "",
        url: "file:///.../dist/model-menu/index.html",
      }),
    ).toBe(100);
    expect(
      minimaxMainTargetRank({ title: "Rsbuild App", url: "file:///.../react-screenshots/electron.html" }),
    ).toBe(100);
  });

  it("menuTargetRank：只认 dist/model-menu 页面", () => {
    expect(
      minimaxMenuTargetRank({ url: "file:///D:/x/resources/app.asar/dist/model-menu/index.html" }),
    ).toBe(0);
    expect(minimaxMenuTargetRank({ url: "app://./archon" })).toBe(100);
  });

  it("retryMinimaxEvaluation：瞬态不可用重试一次；断开不重试", async () => {
    let calls = 0;
    const out = await retryMinimaxEvaluation(async () => {
      calls += 1;
      if (calls === 1) throw new CdpUnavailableError("busy");
      return "ok";
    });
    expect(out).toBe("ok");
    expect(calls).toBe(2);

    let disconnectCalls = 0;
    await expect(
      retryMinimaxEvaluation(async () => {
        disconnectCalls += 1;
        throw new CdpUnavailableError("disconnected");
      }),
    ).rejects.toThrow();
    // CdpUnavailableError 是基类；重试仅对「非断开」的瞬态错误生效
    expect(disconnectCalls).toBeLessThanOrEqual(2);
  });
});
