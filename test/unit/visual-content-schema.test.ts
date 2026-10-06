import { describe, expect, it } from "vitest";
import { VisualConfigSchema, contentChannelUsage } from "../../src/visual/schema.js";

/** 内容校验全局声明（合法）：命令 + 占位符模板 */
const judge = {
  enabled: true,
  command: "vision-cli",
  argsTemplate: ["judge", "--image", "<image:path>", "--expect-file", "<expect:file>"],
};
/** 仅 contents 的合法启用配置（enabled 放宽为 pages/images/contents 三者之一） */
const valid = {
  enabled: true,
  content: judge,
  contents: [{ id: "logo", files: ["assets/logo.png"], expect: "Blue gear with TIANSHU text" }],
};
const staticSource = { type: "static" as const, root: "dist" };

describe("visual content schema", () => {
  it("accepts an enabled configuration with only contents", () => {
    const parsed = VisualConfigSchema.parse(valid);
    expect(parsed.content.enabled).toBe(true);
    expect(parsed.contents).toHaveLength(1);
    expect(parsed.contents[0]!.blocking).toBe(false);
  });

  it("applies centralized defaults for the content dimension", () => {
    const parsed = VisualConfigSchema.parse(valid);
    expect(parsed.content.allowRemote).toBe(false);
    expect(parsed.content.samples).toBe(3);
    expect(parsed.content.timeoutMs).toBe(90_000);
    expect(parsed.content.cache).toBe(true);
    expect(parsed.content.command).toBe("vision-cli");
    // 页面 pixel 默认 true：既有像素行为零变更
    const withPage = VisualConfigSchema.parse({
      ...valid,
      pages: [{ id: "home", source: staticSource }],
    });
    expect(withPage.pages[0]!.pixel).toBe(true);
    expect(withPage.pages[0]!.content).toBeUndefined();
  });

  it.each([
    ["rules declared but content disabled", { enabled: true, contents: valid.contents }],
    [
      "enabled without effective command",
      {
        enabled: true,
        content: { enabled: true, argsTemplate: judge.argsTemplate },
        contents: valid.contents,
      },
    ],
    [
      "enabled without effective argsTemplate (per-rule command only)",
      {
        enabled: true,
        content: { enabled: true, command: "vision-cli" },
        contents: [{ ...valid.contents[0]!, command: "vision-cli" }],
      },
    ],
    [
      "unknown placeholder token",
      {
        ...valid,
        content: { ...judge, argsTemplate: ["judge", "--image", "<image:data>"] },
      },
    ],
    [
      "base64 placeholder without allowRemote",
      {
        ...valid,
        content: { ...judge, argsTemplate: ["judge", "--b64", "<image:base64:file>"] },
      },
    ],
    [
      "base64 placeholder with per-rule allowRemote but global gate kept false",
      {
        ...valid,
        content: { ...judge, argsTemplate: ["judge", "--b64", "<image:base64:file>"] },
        contents: [{ ...valid.contents[0]!, allowRemote: false, argsTemplate: ["--b64", "<image:base64:file>"] }],
      },
    ],
    [
      "samples below lower bound",
      { ...valid, contents: [{ ...valid.contents[0]!, samples: 0 }] },
    ],
    [
      "samples above upper bound",
      { ...valid, contents: [{ ...valid.contents[0]!, samples: 10 }] },
    ],
    [
      "budget violation: default samples x 120s exceeds roundTimeoutMs",
      { ...valid, content: { ...judge, timeoutMs: 120_000 } },
    ],
    [
      "budget violation: global samples 9 x 90s exceeds roundTimeoutMs",
      { ...valid, content: { ...judge, samples: 9 } },
    ],
    [
      "pixel:false page without content",
      { enabled: true, pages: [{ id: "p", pixel: false, source: staticSource }] },
    ],
    [
      "pixel:false page with baseline",
      {
        enabled: true,
        content: judge,
        pages: [
          {
            id: "p",
            pixel: false,
            source: staticSource,
            content: { expect: "semantic only" },
            baseline: "tests/visual/baselines/p.png",
          },
        ],
      },
    ],
    [
      "pixel:false page with pixelThreshold",
      {
        enabled: true,
        content: judge,
        pages: [
          {
            id: "p",
            pixel: false,
            source: staticSource,
            content: { expect: "semantic only" },
            pixelThreshold: 0.2,
          },
        ],
      },
    ],
    [
      "derived content id collides with page id",
      {
        enabled: true,
        content: judge,
        pages: [
          { id: "home", source: staticSource, content: { expect: "hero" } },
          { id: "home-content", source: staticSource },
        ],
      },
    ],
    [
      "derived content id collides with image id (case insensitive)",
      {
        enabled: true,
        content: judge,
        pages: [{ id: "home", source: staticSource, content: { expect: "hero" } }],
        images: [{ id: "HOME-CONTENT", files: ["a.png"] }],
      },
    ],
    ["unknown key in global content block", { ...valid, content: { ...judge, typo: 1 } }],
    [
      "timeoutMs is global-only (rejected at rule level)",
      { ...valid, contents: [{ ...valid.contents[0]!, timeoutMs: 5_000 }] },
    ],
    [
      "unknown key in content rule",
      { ...valid, contents: [{ ...valid.contents[0]!, bad: true }] },
    ],
    ["expect must be non-empty", { ...valid, contents: [{ ...valid.contents[0]!, expect: "" }] }],
  ])("rejects invalid content config: %s", (_label, config) => {
    expect(VisualConfigSchema.safeParse(config).success).toBe(false);
  });

  it("accepts base64 placeholder when the rule opts into allowRemote", () => {
    const parsed = VisualConfigSchema.parse({
      ...valid,
      content: { ...judge, argsTemplate: ["judge", "--b64", "<image:base64:file>"] },
      contents: [
        {
          ...valid.contents[0]!,
          allowRemote: true,
          argsTemplate: ["judge", "--b64", "<image:base64:file>"],
        },
      ],
    });
    expect(parsed.contents[0]!.allowRemote).toBe(true);
  });

  it("accepts global allowRemote declaration for byte egress", () => {
    const parsed = VisualConfigSchema.parse({
      ...valid,
      content: { ...judge, allowRemote: true, argsTemplate: ["judge", "--b64", "<image:base64:file>"] },
    });
    expect(parsed.content.allowRemote).toBe(true);
  });

  it("accepts per-rule samples override that stays within budget", () => {
    const parsed = VisualConfigSchema.parse({
      ...valid,
      content: { ...judge, timeoutMs: 120_000 },
      contents: [{ ...valid.contents[0]!, samples: 2 }],
    });
    // 2 × 120_000 = 240_000 ≤ 默认 roundTimeoutMs 300_000
    expect(parsed.contents[0]!.samples).toBe(2);
    expect(parsed.content.timeoutMs).toBe(120_000);
  });

  it("accepts semantic-only page (pixel:false with content, no baseline)", () => {
    const parsed = VisualConfigSchema.parse({
      enabled: true,
      content: judge,
      pages: [
        {
          id: "login",
          pixel: false,
          source: staticSource,
          content: { expect: "username and password inputs with a login button", blocking: true },
        },
      ],
    });
    expect(parsed.pages[0]!.pixel).toBe(false);
    expect(parsed.pages[0]!.content?.blocking).toBe(true);
  });

  it("keeps the content master gate independent of the visual master switch", () => {
    // visual.enabled=false 是整模块的显式关闭（与 pages/images 同理，不报错），
    // 但内容规则声明后仍要求 content.enabled=true（禁止「声明了规则却静默不跑」）
    const off = VisualConfigSchema.safeParse({
      enabled: false,
      contents: valid.contents,
    });
    expect(off.success).toBe(false);
    const offButEnabled = VisualConfigSchema.safeParse({
      enabled: false,
      content: judge,
      contents: valid.contents,
    });
    expect(offButEnabled.success).toBe(true);
  });

  /**
   * issue #29：外发闸门的**通道语义**显式化。
   * 现状是有意识的取舍——allowRemote 只约束「内联字节」这一个形态；路径通道不受约束，
   * 因为命令的 cwd 就在项目内、本就能自读文件，门控 path 零收益（见计划 §2.1 探针）。
   * 这些用例把边界钉死，防止未来任一方向的无意改动。
   */
  describe("issue #29: allowRemote 的通道边界", () => {
    const withTemplate = (argsTemplate: string[]) => ({
      enabled: true,
      content: { enabled: true, command: "vision-cli", argsTemplate },
      contents: [{ id: "logo", files: ["assets/logo.png"], expect: "blue gear" }],
    });

    it("默认（allowRemote=false）拒绝内联字节通道 <image:base64:file>", () => {
      expect(
        VisualConfigSchema.safeParse(withTemplate(["judge", "--b64", "<image:base64:file>"]))
          .success,
      ).toBe(false);
    });

    it("默认（allowRemote=false）接受路径通道 <image:path>", () => {
      expect(
        VisualConfigSchema.safeParse(withTemplate(["judge", "--image", "<image:path>"])).success,
      ).toBe(true);
    });

    it("默认（allowRemote=false）接受期望文本通道 <expect:file>（不是图片外发通道）", () => {
      expect(
        VisualConfigSchema.safeParse(withTemplate(["judge", "--expect-file", "<expect:file>"]))
          .success,
      ).toBe(true);
    });

    it("contentChannelUsage 只把 base64 归入受约束通道", () => {
      expect(
        contentChannelUsage(["judge", "--image", "<image:path>", "--expect-file", "<expect:file>"]),
      ).toEqual({ egressConstrained: false, pathChannels: ["<image:path>", "<expect:file>"] });
      expect(contentChannelUsage(["judge", "--b64", "<image:base64:file>"])).toEqual({
        egressConstrained: true,
        pathChannels: [],
      });
      expect(
        contentChannelUsage(["judge", "--image", "<image:path>", "--b64", "<image:base64:file>"]),
      ).toEqual({ egressConstrained: true, pathChannels: ["<image:path>"] });
    });

    it("contentChannelUsage 去重且保留模板出现顺序", () => {
      expect(
        contentChannelUsage(["a", "<image:path>", "b", "<image:path>", "<expect:file>"]),
      ).toEqual({ egressConstrained: false, pathChannels: ["<image:path>", "<expect:file>"] });
      expect(contentChannelUsage(["judge"])).toEqual({
        egressConstrained: false,
        pathChannels: [],
      });
    });
  });
});
