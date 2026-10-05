import path from "node:path";

/**
 * 侧栏项目分组里的一项（`[data-testid="sidebar-session-group"]`）。
 *
 * 真机实测（2026-10-05，MiniMax Code 3.1.0）：分组元素带
 * `data-workspace-dir="D:\Trae项目\tianshu-mcp"` 与 `data-project-key="workspace:D:\Trae项目\tianshu-mcp"`。
 * **`data-workspace-dir` 就是完整绝对路径**——这是本适配器项目绑定的权威判据，
 * 比名称匹配可靠得多（同名不同目录不会混淆）。
 */
export interface MinimaxProjectGroup {
  /** `data-workspace-dir` 回读的完整路径 */
  dir: string;
  /** `data-project-key`（形如 `workspace:<dir>`） */
  key: string;
  /** 分组头部 aria-label（实测形如 `<名称>, <路径>`） */
  title: string;
  active: boolean;
}

/**
 * 项目路径归一：盘符大写 + 反斜杠统一 + 去尾部分隔符 + Windows 大小写不敏感。
 *
 * 实测（2026-10-05）：侧栏 `data-workspace-dir` 回读原生形式（`D:\Trae项目\tianshu-mcp`），
 * 而任务上下文里的 projectPath 可能来自 normPath（正斜杠 + 小写盘符）。
 * 绑定判据必须比较**归一化后的完整路径**，比字面量会把同一目录判成两个。
 *
 * 刻意不做 realpath：这里要保证「侧栏回读值」与「任务上下文」两段字符串可确定性对齐，
 * 纯词法函数在单测与运行期行为一致。
 */
export function normalizeProjectPath(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!value) return "";
  if (platform === "win32") {
    let out = path.win32.normalize(value).replace(/[\\/]+$/, "");
    // win32.normalize 会把「仅盘符」补成 `d:.`；盘根本身要记成 `d:\`，否则会与相对路径混淆。
    if (/^[a-zA-Z]:\.$/.test(out)) out = `${out.slice(0, 2)}\\`;
    if (/^[a-zA-Z]:$/.test(out)) out = `${out}\\`;
    // 大小写不敏感比较：先整体小写，再把盘符恢复成大写（界面回读形式为 D:\...）。
    return out
      .toLocaleLowerCase()
      .replace(/^([a-z]):/, (_match, drive: string) => `${drive.toUpperCase()}:`);
  }
  const out = path.posix.normalize(value);
  return out === "/" ? out : out.replace(/\/+$/, "");
}

/** 项目显示名归一：NFKC（全半角）+ 折叠空白 + trim + 大小写不敏感 */
export function normalizeProjectName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function identity(item: MinimaxProjectGroup): string {
  return item.dir || item.title;
}

/**
 * 定位目标项目：**优先完整路径匹配**（`data-workspace-dir`）；
 * 路径不可用时才回退名称匹配（从 title 里取逗号前的名称段）。
 * 多命中即 ambiguous（同名不同目录绝不能猜一个点，会把任务派到错误目录）。
 */
export function matchMinimaxProject(
  items: MinimaxProjectGroup[],
  projectPath: string,
  platform: NodeJS.Platform = process.platform,
): { item?: MinimaxProjectGroup; ambiguous: boolean; candidates: string[] } {
  const target = normalizeProjectPath(projectPath, platform);
  if (target) {
    const exact = items.filter(
      (item) => item.dir && normalizeProjectPath(item.dir, platform) === target,
    );
    if (exact.length === 1)
      return { item: exact[0], ambiguous: false, candidates: [identity(exact[0]!)] };
    if (exact.length > 1) return { ambiguous: true, candidates: exact.map(identity) };
  }
  const api = platform === "win32" ? path.win32 : path.posix;
  const wanted = normalizeProjectName(api.basename(projectPath));
  if (!wanted) return { ambiguous: false, candidates: [] };
  const byName = items.filter((item) => {
    // title 形如 `<名称>, <路径>`：取逗号前的名称段比较；没有逗号时整串比较。
    const name = item.title.split(",")[0]?.trim() ?? "";
    return normalizeProjectName(name) === wanted;
  });
  if (byName.length === 1)
    return { item: byName[0], ambiguous: false, candidates: [identity(byName[0]!)] };
  if (byName.length > 1) return { ambiguous: true, candidates: byName.map(identity) };
  return { ambiguous: false, candidates: [] };
}
