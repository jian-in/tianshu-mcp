import fs from "node:fs";
import path from "node:path";

export interface ZcodeProjectItem {
  name: string;
  path?: string;
  id?: string;
  /** ZCode 3.14.x 菜单项的勾选态；来自旧契约（workspace-item-*）时为 undefined。 */
  checked?: boolean;
}

export const PROJECT_PLACEHOLDER_TEXTS = [
  "选择项目",
  "select project",
  "select a project",
  "choose project",
] as const;

function normalizeDisplayName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function projectDisplayName(
  projectPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const api = platform === "win32" ? path.win32 : path.posix;
  return api.basename(projectPath).normalize("NFKC").trim();
}

export function sameDisplayName(a: string, b: string): boolean {
  return normalizeDisplayName(a) === normalizeDisplayName(b);
}

export function isUnboundTriggerText(text: string): boolean {
  const normalized = normalizeDisplayName(text);
  const compact = normalized.replace(/\s+/g, "");
  return PROJECT_PLACEHOLDER_TEXTS.some((placeholder) => {
    const normalizedPlaceholder = normalizeDisplayName(placeholder);
    return (
      normalized === normalizedPlaceholder || compact === normalizedPlaceholder.replace(/\s+/g, "")
    );
  });
}

export function normalizeProjectPath(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const api = platform === "win32" ? path.win32 : path.posix;
  let out = api.normalize(value).replace(/[\\/]+$/, "");
  if (platform === "win32") return out.replace(/\\/g, "/").toLowerCase();
  // POSIX：符号链接会让同一目录产生两个字符串（macOS /tmp→/private/tmp 实测）——
  // 词法归一不等会退化成「名称匹配 → 项目同名歧义」误判。优先 realpath，路径不存在退回词法。
  try {
    out = fs.realpathSync(out);
  } catch {
    /* 路径不存在（如单测的虚拟路径）：保持词法归一 */
  }
  return out;
}

export interface ZcodeProjectMatch {
  item?: ZcodeProjectItem;
  ambiguous: boolean;
  /** 匹配依据：path=路径精确匹配；name=显示名匹配（3.14.x 无路径渠道时）。 */
  matchedBy?: "path" | "name";
}

export function matchZcodeProject(
  items: ZcodeProjectItem[],
  target: string,
  platform: NodeJS.Platform = process.platform,
): ZcodeProjectMatch {
  const exact = items.filter(
    (item) =>
      item.path &&
      normalizeProjectPath(item.path, platform) === normalizeProjectPath(target, platform),
  );
  if (exact.length === 1) return { item: exact[0], ambiguous: false, matchedBy: "path" };
  if (exact.length > 1) return { ambiguous: true };
  const api = platform === "win32" ? path.win32 : path.posix;
  const base = api.basename(target);
  const names = items.filter((item) => exactName(item.name, base, platform));
  if (names.length > 1) return { ambiguous: true };
  if (names.length === 1) {
    const only = names[0]!;
    // 同名项带路径且与目标不符 → 列表里那个不是目标，保持 fail-closed（原语义）。
    if (
      only.path &&
      normalizeProjectPath(only.path, platform) !== normalizeProjectPath(target, platform)
    )
      return { ambiguous: true };
    // 无路径渠道（ZCode 3.14.x）：显示名是唯一可用证据，交给上层按显示名判定绑定。
    return { item: only, ambiguous: false, matchedBy: "name" };
  }
  return { ambiguous: false };
}

/** 工作区绑定回读结果中本判定需要的最小形状（与 ZcodeCdpClient.workspaceBinding 对齐）。 */
export interface ZcodeWorkspaceBindingLike {
  triggerText: string;
  projectPath: string;
  projectName?: string;
  menuChecked?: string[];
  ambiguous?: boolean;
}

export interface ZcodeBoundVerdict {
  bound: boolean;
  ambiguous: boolean;
  /** 人可读的证据说明，用于失败诊断与日志 */
  evidence: string;
}

/**
 * 判定「当前 ZCode 工作区是否绑定到 target」（issue #24）。
 *
 * 判据分层，证据等级从强到弱：
 *  1. 路径回读（`binding.projectPath`）——老版本（与未来若恢复路径渠道）的严格判等，语义不变。
 *  2. 显示名（`binding.projectName`）——3.14.x 的唯一渠道；仅在名称一致时成立，
 *     并要求项目列表未出现同名歧义。
 * 绝不把显示名当路径：路径不一致时一定判不绑定，宁可多走一轮点击也不误投。
 */
export function boundProjectVerdict(
  binding: ZcodeWorkspaceBindingLike,
  match: ZcodeProjectMatch,
  target: string,
  platform: NodeJS.Platform = process.platform,
): ZcodeBoundVerdict {
  if (binding.ambiguous)
    return { bound: false, ambiguous: true, evidence: "工作区绑定回读本身已歧义" };
  if (binding.projectPath) {
    const ok =
      normalizeProjectPath(binding.projectPath, platform) === normalizeProjectPath(target, platform);
    return { bound: ok, ambiguous: false, evidence: `路径回读=${binding.projectPath}` };
  }
  const expect = projectDisplayName(target, platform);
  const boundName = (binding.projectName || "").trim();
  if (!boundName) return { bound: false, ambiguous: false, evidence: "未能回读当前绑定的显示名" };
  if (!sameDisplayName(boundName, expect))
    return {
      bound: false,
      ambiguous: false,
      evidence: `当前绑定显示名=${boundName}，目标=${expect}`,
    };
  // 名称一致：只有列表确实可得且表明同名歧义时才拒绝（列表不可得时不能据此否定）。
  if (match.ambiguous)
    return { bound: false, ambiguous: true, evidence: "项目列表存在同名项，无法消歧" };
  if (
    match.item?.path &&
    normalizeProjectPath(match.item.path, platform) !== normalizeProjectPath(target, platform)
  )
    return {
      bound: false,
      ambiguous: false,
      evidence: `同名项目路径不符：${match.item.path}`,
    };
  return {
    bound: true,
    ambiguous: false,
    evidence: `显示名一致=${boundName}${match.matchedBy === "name" ? "（无路径渠道，按 3.14.x 契约以显示名判定）" : ""}`,
  };
}

function exactName(a: string, b: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
