import { describe, expect, it } from "vitest";
import { compareVersion, parseVersion, shouldPrompt } from "@/core/version";

/**
 * 版本比较与「是否提示更新」的判定。
 *
 * 业务背景（更新日志面板）：
 * - 自动更新按语义版本号比大小，**不分正式 / 预发布**（0.1.1-beta.1 > 0.1.0）；
 * - 「忽略此版本」只压自动提示，手动检查仍要看到；出现**更高**版本时重新提示。
 */
describe("parseVersion", () => {
  it("拆出 major / minor / patch 与预发布段", () => {
    expect(parseVersion("0.1.0-beta.9")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: ["beta", "9"],
    });
    expect(parseVersion("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
  });

  it("容忍前导 v 与段数不足的写法", () => {
    expect(parseVersion("v0.2.0")).toEqual({ major: 0, minor: 2, patch: 0, prerelease: [] });
    expect(parseVersion("1.2")).toEqual({ major: 1, minor: 2, patch: 0, prerelease: [] });
  });

  it("不可解析时返回 null，不抛错", () => {
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("abc")).toBeNull();
  });
});

describe("compareVersion", () => {
  it("主次修订依次比较", () => {
    expect(compareVersion("0.2.0", "0.1.0")).toBe(1);
    expect(compareVersion("0.1.0", "0.2.0")).toBe(-1);
    expect(compareVersion("0.1.0", "0.1.0")).toBe(0);
  });

  it("数字段按数值比较，而非字典序", () => {
    expect(compareVersion("1.0.0", "0.9.9")).toBe(1);
    expect(compareVersion("0.1.10", "0.1.9")).toBe(1);
  });

  it("同号正式版高于预发布版（beta.9 → 0.1.0 是一次升级）", () => {
    expect(compareVersion("0.1.0", "0.1.0-beta.9")).toBe(1);
    expect(compareVersion("0.1.0-beta.9", "0.1.0")).toBe(-1);
  });

  it("修订号更大的预发布版高于低号正式版（0.1.1-beta.1 > 0.1.0）", () => {
    expect(compareVersion("0.1.1-beta.1", "0.1.0")).toBe(1);
  });

  it("预发布段按段比较，数字段按数值比较", () => {
    expect(compareVersion("0.1.0-beta.10", "0.1.0-beta.9")).toBe(1);
    expect(compareVersion("0.1.0-beta.2", "0.1.0-beta.10")).toBe(-1);
    expect(compareVersion("0.1.0-alpha.1", "0.1.0-beta.1")).toBe(-1);
  });

  it("正式版与更长的预发布段：正式版胜出", () => {
    expect(compareVersion("0.1.0", "0.1.0-rc.1")).toBe(1);
  });
});

describe("shouldPrompt（是否自动提示该版本）", () => {
  it("没有可用版本时不提示", () => {
    expect(shouldPrompt(null, null)).toBe(false);
    expect(shouldPrompt("", null)).toBe(false);
  });

  it("没有忽略记录时提示", () => {
    expect(shouldPrompt("0.1.0", null)).toBe(true);
  });

  it("忽略的是同一版本 → 不再自动提示", () => {
    expect(shouldPrompt("0.1.0", "0.1.0")).toBe(false);
  });

  it("出现更高版本 → 重新提示", () => {
    expect(shouldPrompt("0.1.1", "0.1.0")).toBe(true);
    expect(shouldPrompt("0.1.1-beta.1", "0.1.0")).toBe(true);
  });

  it("忽略的版本更高时不提示（不做降级提示）", () => {
    expect(shouldPrompt("0.1.0", "0.1.1")).toBe(false);
  });

  it("忽略记录不可解析时按未忽略处理（宁可提示，不静默吞掉更新）", () => {
    expect(shouldPrompt("0.1.0", "not-a-version")).toBe(true);
  });

  it("可用版本不可解析时不提示（避免误弹空窗口）", () => {
    expect(shouldPrompt("not-a-version", null)).toBe(false);
  });
});
