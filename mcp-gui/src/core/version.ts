/**
 * 版本号解析与比较——「更新日志面板」的忽略判定用。
 *
 * 只实现本项目需要的那部分 semver 语义（不引入第三方依赖）：
 * - 支持 `1.2.3` / `1.2` / `v1.2.3` / `1.2.3-beta.9`；不可解析一律返回 `null`（不抛错）；
 * - 同号**正式版高于预发布版**（`0.1.0` > `0.1.0-beta.9`）——这是「beta 用户能升级到正式版」的前提；
 * - 预发布段逐段比较：数字段按数值比（`beta.10` > `beta.9`），非数字段按字典序（`alpha` < `beta`）。
 *
 * 与自动更新的关系：Tauri updater 与 `update/gui/latest*.json` 都按语义版本比大小、
 * **不看正式 / 预发布标记**，因此这里的比较结果直接决定「有没有新版本」与「要不要弹窗」。
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** 预发布段（`0.1.0-beta.9` → `["beta", "9"]`）；正式版为空数组 */
  prerelease: string[];
}

const VERSION_RE = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/;

/** 解析版本号；`null` / 空串 / 非法写法一律返回 `null` */
export function parseVersion(input: string | null | undefined): ParsedVersion | null {
  if (!input) return null;
  const m = VERSION_RE.exec(input.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: m[3] === undefined ? 0 : Number(m[3]),
    prerelease: m[4] === undefined ? [] : m[4].split("."),
  };
}

function compareNumber(a: number, b: number): number {
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

/** 单段比较：数字段按数值（且低于非数字段），非数字段按字典序 */
function comparePrereleaseSegment(a: string, b: string): number {
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  if (na && nb) return compareNumber(Number(a), Number(b));
  if (na) return -1;
  if (nb) return 1;
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

/**
 * 比较两个版本号：`a > b` 返回 `1`，`a < b` 返回 `-1`，相等返回 `0`。
 *
 * 传入无法解析的版本号时**抛错**（调用方应先用 `parseVersion` 判定；
 * 静默返回 0 会让「有没有新版本」的判断无声出错）。
 */
export function compareVersion(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`无法解析版本号：${!pa ? a : b}`);

  const byMajor = compareNumber(pa.major, pb.major);
  if (byMajor !== 0) return byMajor;
  const byMinor = compareNumber(pa.minor, pb.minor);
  if (byMinor !== 0) return byMinor;
  const byPatch = compareNumber(pa.patch, pb.patch);
  if (byPatch !== 0) return byPatch;

  // 核心号相同：无预发布段的一方更高（0.1.0 > 0.1.0-rc.1）
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;

  const len = Math.min(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i += 1) {
    const cmp = comparePrereleaseSegment(pa.prerelease[i]!, pb.prerelease[i]!);
    if (cmp !== 0) return cmp;
  }
  // 前缀相同：段数多的一方更高（1.0.0-alpha < 1.0.0-alpha.1）
  return compareNumber(pa.prerelease.length, pb.prerelease.length);
}

/**
 * 是否应当**自动**提示该版本（启动静默检查用）。
 *
 * 语义（用户确认的「忽略」定义）：
 * - 无可用版本 / 可用版本不可解析 → 不提示（避免弹出空窗口）；
 * - 没有忽略记录，或忽略记录不可解析 → 提示（宁可提示，不静默吞掉更新）；
 * - 忽略的是**更高**版本或同一版本 → 不提示；
 * - 出现更高版本 → 重新提示。
 *
 * 手动点「检查更新」不走这里——手动结果一律展示（忽略只压自动提示）。
 */
export function shouldPrompt(
  available: string | null | undefined,
  ignored: string | null | undefined,
): boolean {
  if (!parseVersion(available)) return false;
  if (!parseVersion(ignored)) return true;
  return compareVersion(available as string, ignored as string) > 0;
}
