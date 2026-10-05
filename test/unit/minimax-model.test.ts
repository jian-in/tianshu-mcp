import { describe, expect, it } from "vitest";
import {
  assertContextWindowSupported,
  assertLevelSupported,
  describeLevelValueError,
  exactUiName,
  levelOfToken,
  normalizeReasoningLevel,
  optionMatches,
  parseMinimaxModel,
  parseTriggerValue,
  tierLabels,
  tierSetOf,
} from "../../src/agents/minimax/model.js";

/**
 * MiniMax Code 模型/推理等级/上下文窗口。
 *
 * 全部判据来自真机实测（2026-10-05，MiniMax Code 3.1.0）：
 * - 档位集合随模型变化（M3.1-Flash-Preview 六档 / M3 无档位 / deepseek 三档）；
 * - 上下文窗口同样随模型变化（M3.1 有 512K+1M / M3 有 / deepseek 无）；
 * - 触发器文本形态：单行模型名，或「模型名\n档位」两行。
 */
describe("MiniMax Code 模型参数解析", () => {
  it("parseTriggerValue：单行 = 模型名（无档位后缀）", () => {
    expect(parseTriggerValue("M2.7-highspeed")).toEqual({ model: "M2.7-highspeed" });
    expect(parseTriggerValue("M3.1-Flash-Preview")).toEqual({ model: "M3.1-Flash-Preview" });
  });

  it("parseTriggerValue：两行 = 模型名 + 档位（真机实测形态）", () => {
    expect(parseTriggerValue("M3.1-Flash-Preview\ndefault")).toEqual({
      model: "M3.1-Flash-Preview",
      levelToken: "default",
    });
    expect(parseTriggerValue("M3\nxhigh")).toEqual({ model: "M3", levelToken: "xhigh" });
  });

  it("parseTriggerValue：兼容 CRLF 与首尾空白", () => {
    expect(parseTriggerValue("  M3\r\nmax  ")).toEqual({ model: "M3", levelToken: "max" });
  });

  it("parseTriggerValue：第二行不是档位 token 时整串当模型名（不猜）", () => {
    // 理论上不出现；若出现说明 UI 结构漂移，宁可整串当模型名（必然匹配失败 → 报错可诊断）
    expect(parseTriggerValue("M3\nunknown-thing")).toEqual({ model: "M3 unknown-thing" });
  });

  it("parseTriggerValue：只剩档位 token 的单行 → 模型名为空（交给调用方报错）", () => {
    expect(parseTriggerValue("default")).toEqual({ model: "" });
  });

  it("parseMinimaxModel：model 必填", () => {
    expect(() => parseMinimaxModel(undefined, undefined)).toThrow(/必须指定 model/);
    expect(() => parseMinimaxModel("   ", undefined)).toThrow(/必须指定 model/);
  });

  it("parseMinimaxModel：中英档位别名都归一", () => {
    expect(parseMinimaxModel("M3", "低").level).toBe("low");
    expect(parseMinimaxModel("M3", "中").level).toBe("medium");
    expect(parseMinimaxModel("M3", "极高").level).toBe("xhigh");
    expect(parseMinimaxModel("M3", "最大").level).toBe("max");
    expect(parseMinimaxModel("M3", "DEFAULT").level).toBe("default");
    // 空格与全角也要归一
    expect(parseMinimaxModel("M3", " high ").level).toBe("high");
  });

  it("parseMinimaxModel：不支持的档位原样进 unsupported，绝不静默丢弃", () => {
    const spec = parseMinimaxModel("M3", "关闭思考");
    expect(spec.level).toBeUndefined();
    expect(spec.unsupported).toBe("关闭思考");
    expect(describeLevelValueError(spec)).toMatch(/不支持「关闭思考」/);
  });

  it("normalizeReasoningLevel：空值返回空对象（不指定 ≠ 报错）", () => {
    expect(normalizeReasoningLevel(undefined)).toEqual({});
    expect(normalizeReasoningLevel("  ")).toEqual({});
  });

  it("normalizeReasoningLevel：medium 是**合法**档位（本产品与 Kimi Code 的关键差异）", () => {
    expect(normalizeReasoningLevel("medium")).toEqual({ level: "medium" });
    expect(normalizeReasoningLevel("中")).toEqual({ level: "medium" });
  });

  it("levelOfToken：精确识别六档，其他一律 undefined", () => {
    for (const t of ["default", "low", "medium", "high", "xhigh", "max"])
      expect(levelOfToken(t)).toBe(t);
    expect(levelOfToken("思考")).toBeUndefined();
    expect(levelOfToken("Higher")).toBeUndefined();
    expect(levelOfToken("")).toBeUndefined();
  });

  it("exactUiName / optionMatches：NFKC + 折叠空白 + 大小写不敏感", () => {
    expect(exactUiName("512K", "512k")).toBe(true);
    expect(exactUiName(" 1M ", "1M")).toBe(true);
    expect(optionMatches("xhigh", "XHIGH")).toBe(true);
    // 前缀不得命中：这是「M3 与 M3.1-Flash-Preview 并存」的硬要求
    expect(exactUiName("M3", "M3.1-Flash-Preview")).toBe(false);
    expect(exactUiName("512K", "512")).toBe(false);
  });
});

describe("MiniMax Code 档位/窗口集合校验（fail-closed）", () => {
  it("tierSetOf：真机实测三种形态", () => {
    // M3.1-Flash-Preview：六档
    const full = tierSetOf(["default", "low", "medium", "high", "xhigh", "max"]);
    expect(full.kind).toBe("known");
    expect(tierLabels(full)).toBe("default/low/medium/high/xhigh/max");
    // deepseek-v4.1-flash：三档
    const three = tierSetOf(["low", "high", "max"]);
    expect(three.tiers).toEqual(["low", "high", "max"]);
    // M3：无档位组 → unknown
    expect(tierSetOf([]).kind).toBe("unknown");
    expect(tierSetOf(["无法识别"]).kind).toBe("unknown");
  });

  it("assertLevelSupported：档位落在集合内 → 通过", () => {
    const tiers = tierSetOf(["default", "low", "medium", "high", "xhigh", "max"]);
    expect(() => assertLevelSupported({ model: "M3.1-Flash-Preview", level: "medium" }, tiers)).not.toThrow();
  });

  it("assertLevelSupported：档位不在集合内 → 报错并列出支持的档位", () => {
    const tiers = tierSetOf(["low", "high", "max"]);
    expect(() => assertLevelSupported({ model: "deepseek-v4.1-flash", level: "default" }, tiers)).toThrow(
      /仅支持 low\/high\/max/,
    );
  });

  it("assertLevelSupported：读不到档位（unknown）→ fail-closed，绝不按内置名单猜", () => {
    expect(() =>
      assertLevelSupported({ model: "M3", level: "high" }, tierSetOf([])),
    ).toThrow(/拒绝猜测档位/);
  });

  it("assertLevelSupported：unsupported 优先报出（原始取值错误优先于集合判断）", () => {
    const tiers = tierSetOf(["low", "high", "max"]);
    // 文案形态（实测输出）：`模型 M3 的推理等级仅支持 low/high/max，收到「极高」（xhigh）`
    expect(() =>
      assertLevelSupported({ model: "M3", unsupported: "xhigh" }, tiers),
    ).toThrow(/推理等级仅支持 low\/high\/max，收到「极高」（xhigh）/);
  });

  it("assertContextWindowSupported：未指定 → 不校验（不切换）", () => {
    expect(() => assertContextWindowSupported({ model: "M3" }, [])).not.toThrow();
  });

  it("assertContextWindowSupported：候选命中（大小写不敏感）→ 通过", () => {
    expect(() =>
      assertContextWindowSupported({ model: "M3", contextWindow: "512k" }, ["512K", "1M"]),
    ).not.toThrow();
  });

  it("assertContextWindowSupported：候选为空 → fail-closed（绝不静默沿用当前窗口）", () => {
    expect(() =>
      assertContextWindowSupported({ model: "M3", contextWindow: "1M" }, []),
    ).toThrow(/拒绝猜测/);
  });

  it("assertContextWindowSupported：候选不含目标值 → 报错并列出候选", () => {
    expect(() =>
      assertContextWindowSupported({ model: "M3", contextWindow: "1M" }, ["512K"]),
    ).toThrow(/仅支持 512K，收到「1M」/);
  });
});
