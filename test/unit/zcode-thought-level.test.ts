import { describe, expect, it } from "vitest";
import {
  assertZcodeLevelSupported,
  parseZcodeModel,
  thoughtLevelOfToken,
  thoughtTierSetOf,
  thoughtTierLabels,
  ZcodeReasoningLevelError,
} from "../../src/agents/zcode/model.js";

/**
 * issue #27 问题三：ZCode 的思考档位长期没有实现（`reasoningLevel` 在 SKILL.md 里标 ✗）。
 *
 * 档位集合的唯一判据是「界面实际渲染出来的选项」——真机实测（2026-09-30，ZCode 3.14.3-Windows）
 * 当前模型 step-plan/step-5-preview 的档位是二值：
 *   `chat-thought-level-select-item-disabled`（关闭） / `chat-thought-level-select-item-enabled`（开启）
 * 因此这里刻意不内置模型名单；越权档位在**发送前**响亮报错，绝不静默沿用界面当前值。
 */
describe("ZCode 思考档位（issue #27）", () => {
  it("把界面 token（testid 后缀或可见文本）归一为规范档位", () => {
    expect(thoughtLevelOfToken("enabled")).toBe("on");
    expect(thoughtLevelOfToken("disabled")).toBe("off");
    expect(thoughtLevelOfToken("开启")).toBe("on");
    expect(thoughtLevelOfToken("关闭")).toBe("off");
    expect(thoughtLevelOfToken("高")).toBe("high");
    expect(thoughtLevelOfToken("max")).toBe("max");
    // 无法识别的 token 不猜：返回 undefined，由上层 fail-closed。
    expect(thoughtLevelOfToken("思考")).toBeUndefined();
    expect(thoughtLevelOfToken("")).toBeUndefined();
  });

  it("由界面实际档位标签集合归类：on/off 是二值、含 max 是官方多档、读不到是 unknown", () => {
    expect(thoughtTierSetOf(["disabled", "enabled"])).toEqual({
      tiers: ["off", "on"],
      kind: "onoff",
    });
    expect(thoughtTierSetOf(["低", "高", "max"])).toEqual({
      tiers: ["low", "high", "max"],
      kind: "multi",
    });
    expect(thoughtTierSetOf(["思考"])).toEqual({ tiers: [], kind: "unknown" });
    expect(thoughtTierSetOf([])).toEqual({ tiers: [], kind: "unknown" });
  });

  it("档位集合的界面写法用于错误文案", () => {
    expect(thoughtTierLabels({ tiers: ["off", "on"], kind: "onoff" })).toBe("Off/On");
    expect(thoughtTierLabels({ tiers: [], kind: "unknown" })).toBe("（空）");
  });

  it("越权档位在发送前报错：二值模型收到 high 必须失败", () => {
    const spec = parseZcodeModel("step-plan/step-5-preview", "high");
    expect(spec.level).toBe("high");
    expect(() => assertZcodeLevelSupported(spec, thoughtTierSetOf(["disabled", "enabled"]))).toThrow(
      /仅支持 Off\/On/,
    );
  });

  it("档位集合读不到时一律 fail-closed，不按内置名单猜", () => {
    const spec = parseZcodeModel("unknown/model", "on");
    expect(() => assertZcodeLevelSupported(spec, thoughtTierSetOf(["思考"]))).toThrow(
      ZcodeReasoningLevelError,
    );
    expect(() => assertZcodeLevelSupported(spec, thoughtTierSetOf(["思考"]))).toThrow(/拒绝猜测档位/);
  });

  it("落在界面集合内的档位通过校验", () => {
    const spec = parseZcodeModel("step-plan/step-5-preview", "on");
    expect(() =>
      assertZcodeLevelSupported(spec, thoughtTierSetOf(["disabled", "enabled"])),
    ).not.toThrow();
  });

  it("取值域之外的值不静默丢弃，原样留在 unsupportedLevel 里供报错", () => {
    const spec = parseZcodeModel("A/B", "超高");
    expect(spec.level).toBeUndefined();
    expect(spec.unsupportedLevel).toBe("超高");
    expect(() =>
      assertZcodeLevelSupported(spec, thoughtTierSetOf(["disabled", "enabled"])),
    ).toThrow(/超高/);
  });

  it("未指定档位时不切换（沿用界面当前值）", () => {
    const spec = parseZcodeModel("A/B");
    expect(spec.level).toBeUndefined();
    expect(spec.unsupportedLevel).toBeUndefined();
    expect(() =>
      assertZcodeLevelSupported(spec, thoughtTierSetOf(["disabled", "enabled"])),
    ).not.toThrow();
  });
});
