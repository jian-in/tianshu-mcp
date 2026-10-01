import { describe, expect, it } from "vitest";
import { matchHotkey, type HotkeyEventLike } from "@/core/hotkeys";

function key(patch: Partial<HotkeyEventLike> & { key: string }): HotkeyEventLike {
  return { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...patch };
}

describe("全局快捷键匹配（A8a）", () => {
  it("Ctrl/Cmd + K 开面板（面板未打开时）", () => {
    expect(matchHotkey(key({ key: "k", ctrlKey: true }), false)).toBe("paletteToggle");
    expect(matchHotkey(key({ key: "K", metaKey: true }), false)).toBe("paletteToggle");
  });

  it("Ctrl/Cmd + R 刷新", () => {
    expect(matchHotkey(key({ key: "r", ctrlKey: true }), false)).toBe("refresh");
    expect(matchHotkey(key({ key: "R", metaKey: true }), false)).toBe("refresh");
  });

  it("面板打开时：Esc 与 Ctrl/Cmd + K 都关闭，刷新等全局键一律不触发", () => {
    expect(matchHotkey(key({ key: "Escape" }), true)).toBe("paletteClose");
    expect(matchHotkey(key({ key: "k", ctrlKey: true }), true)).toBe("paletteClose");
    expect(matchHotkey(key({ key: "r", ctrlKey: true }), true)).toBeNull();
  });

  it("不带修饰键的普通按键不拦截（含单独 Esc / k / r）", () => {
    for (const k of ["Escape", "k", "r", "Enter", "a"]) {
      expect(matchHotkey(key({ key: k }), false), k).toBeNull();
    }
  });

  it("带 Alt / Shift 的组合不认（避免劫持 Ctrl+Shift+R 这类组合）", () => {
    expect(matchHotkey(key({ key: "r", ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(matchHotkey(key({ key: "k", ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(matchHotkey(key({ key: "k", ctrlKey: true, altKey: true }), false)).toBeNull();
  });
});
