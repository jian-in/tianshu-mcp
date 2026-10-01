/**
 * 全局快捷键匹配（纯函数，可单测）。
 *
 * 只在 `App.vue` 的 window 监听里调用一次；`matchHotkey` 不碰 DOM、不执行动作，
 * 只回答「这次按键对应哪个动作」——便于用普通对象做单测。
 */

/** 一次按键事件里本函数关心的字段（`KeyboardEvent` 结构子集） */
export interface HotkeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type HotkeyAction =
  /** 打开命令面板（`Ctrl/Cmd + K`） */
  | "paletteToggle"
  /** 关闭命令面板（`Esc`，或面板打开时再按一次 `Ctrl/Cmd + K`） */
  | "paletteClose"
  /** 刷新任务列表（`Ctrl/Cmd + R`） */
  | "refresh";

/** 平台修饰键：Windows / Linux 用 `Ctrl`，macOS 用 `Cmd` */
export function hasPrimaryModifier(event: HotkeyEventLike): boolean {
  return event.ctrlKey || event.metaKey;
}

/**
 * 匹配快捷键。`paletteOpen` 为真时**只认面板自身的键**（`Esc` 与 `Ctrl/Cmd + K` 均关闭），
 * 其余组合一律返回 `null`——面板打开时不应在背后触发刷新等全局动作。
 *
 * 带 `Alt` / `Shift` 的组合一律不认（避免劫持 `Ctrl+Shift+R` 这类浏览器 / 输入法组合）。
 */
export function matchHotkey(event: HotkeyEventLike, paletteOpen: boolean): HotkeyAction | null {
  if (event.altKey || event.shiftKey) return null;
  const mod = hasPrimaryModifier(event);
  const key = event.key.toLowerCase();

  if (paletteOpen) {
    if (!mod && event.key === "Escape") return "paletteClose";
    if (mod && key === "k") return "paletteClose";
    return null;
  }

  if (mod && key === "k") return "paletteToggle";
  if (mod && key === "r") return "refresh";
  return null;
}