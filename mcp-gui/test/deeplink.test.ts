import { describe, expect, it } from "vitest";
import { DEEPLINK_EVENT, DEEPLINK_SCHEME, firstDeepLinkTarget, parseDeepLink } from "@/core/deeplink";

describe("A8b 深链解析", () => {
  it("接受 tianshu://task/<任务ID>（含查询串 / 片段 / 末尾斜杠）", () => {
    expect(parseDeepLink("tianshu://task/tsk_20260926135200_d4e5f6")).toEqual({
      view: "task",
      taskId: "tsk_20260926135200_d4e5f6",
    });
    expect(parseDeepLink("tianshu://task/tsk_1/")).toEqual({ view: "task", taskId: "tsk_1" });
    expect(parseDeepLink("tianshu://task/tsk_1?source=cli#x")).toEqual({
      view: "task",
      taskId: "tsk_1",
    });
    // 大小写不敏感（URL 会把 scheme / host 小写化）
    expect(parseDeepLink("TIANSHU://TASK/tsk_1")).toEqual({ view: "task", taskId: "tsk_1" });
  });

  it("拒绝其它 scheme / 其它 host / 缺 ID / 多段路径", () => {
    for (const bad of [
      "",
      "   ",
      "not-a-url",
      "https://task/tsk_1",
      "tianshu://insights",
      "tianshu://task",
      "tianshu://task/",
      "tianshu://task/tsk_1/extra",
      "tianshu://task/tsk_1/other/",
    ]) {
      expect(parseDeepLink(bad), bad).toBeNull();
    }
  });

  it("任务 ID 走字符白名单，挡住路径穿越（深链是外部输入，ID 会拼进文件路径）", () => {
    for (const bad of [
      "tianshu://task/..",
      "tianshu://task/../secrets",
      "tianshu://task/a%2Fb",
      "tianshu://task/tsk%5C1",
      "tianshu://task/tsk 1",
      "tianshu://task/tsk.1",
    ]) {
      expect(parseDeepLink(bad), bad).toBeNull();
    }
    // 合法字符集（字母 / 数字 / 下划线 / 连字符）
    expect(parseDeepLink("tianshu://task/vfy_2026-09-26_x1")?.taskId).toBe("vfy_2026-09-26_x1");
  });

  it("firstDeepLinkTarget：取第一条可识别的，全不可识别为 null", () => {
    expect(firstDeepLinkTarget(["tianshu://task/tsk_1", "tianshu://task/tsk_2"])?.taskId).toBe("tsk_1");
    expect(firstDeepLinkTarget(["bad", "tianshu://task/tsk_2"])?.taskId).toBe("tsk_2");
    expect(firstDeepLinkTarget(["bad", ""])).toBeNull();
    expect(firstDeepLinkTarget([])).toBeNull();
  });

  it("事件名与协议名与 Rust / tauri.conf 约定一致", () => {
    expect(DEEPLINK_EVENT).toBe("gui://deeplink");
    expect(DEEPLINK_SCHEME).toBe("tianshu");
  });
});
