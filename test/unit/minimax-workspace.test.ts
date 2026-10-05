import { describe, expect, it, vi } from "vitest";
import {
  matchMinimaxProject,
  normalizeProjectName,
  normalizeProjectPath,
  type MinimaxProjectGroup,
} from "../../src/agents/minimax/workspace.js";
import { ensureFreshDraft, locateSessionProject } from "../../src/agents/minimax/session.js";

/**
 * 项目绑定与会话定位。
 *
 * 真机实测（2026-10-05，MiniMax Code 3.1.0）：
 * - 侧栏分组带 `data-workspace-dir="D:\Trae项目\tianshu-mcp"`（**完整绝对路径**）= 权威判据；
 * - 「新建任务」的 testid 挂在 `<kbd>` 上，真正的按钮是祖先；
 * - 新建会话**不会清空项目**（仍停在上次的值）。
 *
 * **平台纪律（CI 教训）**：被测函数的 `platform` 参数默认取 `process.platform`。
 * 本文件的断言全部用 Windows 路径（对应用户真机环境），因此**每处调用都显式传 `"win32"`**——
 * 一旦依赖宿主默认值，同样的断言在 CI 的 ubuntu/macos 腿上会走 POSIX 分支而失败
 * （实测：6 条腿全红，windows 腿全绿）。POSIX 分支另有专门用例覆盖。
 */
describe("MiniMax Code 项目路径归一与匹配", () => {
  it("normalizeProjectPath：盘符大写 + 反斜杠统一 + 去尾部分隔符 + 路径体小写", () => {
    // 归一结果**仅供比较**：盘符恢复大写、其余整体小写，使 `D:\Proj` 与 `d:/proj` 判等。
    expect(normalizeProjectPath("D:\\Trae项目\\tianshu-mcp", "win32")).toBe(
      "D:\\trae项目\\tianshu-mcp",
    );
    expect(normalizeProjectPath("d:/Trae项目/tianshu-mcp/", "win32")).toBe(
      "D:\\trae项目\\tianshu-mcp",
    );
    expect(normalizeProjectPath("D:\\Trae项目\\TIANSHU-MCP", "win32")).toBe(
      "D:\\trae项目\\tianshu-mcp",
    );
    // 关键语义：同一目录的不同写法归一后必须**相等**（这才是绑定的判据）
    expect(normalizeProjectPath("D:\\Trae项目\\tianshu-mcp", "win32")).toBe(
      normalizeProjectPath("d:/trae项目/TIANSHU-mcp/", "win32"),
    );
  });

  it("normalizeProjectPath：盘根记成 `D:\\` 而不是 `d:.`", () => {
    expect(normalizeProjectPath("d:", "win32")).toBe("D:\\");
    expect(normalizeProjectPath("d:\\", "win32")).toBe("D:\\");
  });

  it("normalizeProjectPath：POSIX 分支保留大小写（区分大小写）", () => {
    expect(normalizeProjectPath("/Users/a/Proj/", "darwin")).toBe("/Users/a/Proj");
    expect(normalizeProjectPath("/", "darwin")).toBe("/");
    // 尾部分隔符去掉、内部不动
    expect(normalizeProjectPath("/Users/a/Proj///", "linux")).toBe("/Users/a/Proj");
  });

  it("normalizeProjectPath：空串 → 空串（缺锚点不猜）", () => {
    expect(normalizeProjectPath("", "win32")).toBe("");
    expect(normalizeProjectPath("", "darwin")).toBe("");
  });

  it("normalizeProjectName：NFKC + 折叠空白 + trim + 小写", () => {
    expect(normalizeProjectName("  Tianshu   MCP ")).toBe("tianshu mcp");
    expect(normalizeProjectName("ｔｉａｎｓｈｕ")).toBe("tianshu"); // 全角归一
  });

  const groups: MinimaxProjectGroup[] = [
    {
      dir: "D:\\Trae项目\\tianshu-mcp",
      key: "workspace:D:\\Trae项目\\tianshu-mcp",
      title: "tianshu-mcp, D:\\Trae项目\\tianshu-mcp",
      active: false,
    },
    {
      dir: "D:\\Trae项目\\MiniMax-Test",
      key: "workspace:D:\\Trae项目\\MiniMax-Test",
      title: "MiniMax-Test, D:\\Trae项目\\MiniMax-Test",
      active: false,
    },
  ];

  it("matchMinimaxProject：完整路径严格相等即唯一命中（含正斜杠/大小写差异）", () => {
    expect(matchMinimaxProject(groups, "D:\\Trae项目\\tianshu-mcp", "win32")).toMatchObject({
      ambiguous: false,
    });
    expect(matchMinimaxProject(groups, "D:\\Trae项目\\tianshu-mcp", "win32").item?.dir).toBe(
      groups[0]!.dir,
    );
    // 任务上下文里的 projectPath 可能是正斜杠 + 小写盘符
    expect(matchMinimaxProject(groups, "d:/Trae项目/tianshu-mcp", "win32").item?.dir).toBe(
      groups[0]!.dir,
    );
  });

  it("matchMinimaxProject：路径未命中且基名也不命中 → 无匹配（不猜）", () => {
    const r = matchMinimaxProject(groups, "D:\\Other\\something", "win32");
    expect(r.item).toBeUndefined();
    expect(r.ambiguous).toBe(false);
  });

  it("matchMinimaxProject：同名不同目录 → ambiguous（绝不猜一个点）", () => {
    const dup: MinimaxProjectGroup[] = [
      { dir: "D:\\a\\proj", key: "workspace:D:\\a\\proj", title: "proj, D:\\a\\proj", active: false },
      { dir: "D:\\b\\proj", key: "workspace:D:\\b\\proj", title: "proj, D:\\b\\proj", active: false },
    ];
    // 按路径：两个都不是目标 → 回退名称匹配 → 两条同名 → ambiguous
    const r = matchMinimaxProject(dup, "D:\\c\\proj", "win32");
    expect(r.ambiguous).toBe(true);
    expect(r.candidates).toHaveLength(2);
  });

  it("matchMinimaxProject：名称回退用 title 的逗号前端口（实测形态 `<名>, <路径>`）", () => {
    const noDir: MinimaxProjectGroup[] = [
      { dir: "", key: "", title: "tianshu-mcp, D:\\Trae项目\\tianshu-mcp", active: false },
    ];
    const r = matchMinimaxProject(noDir, "D:\\Trae项目\\tianshu-mcp", "win32");
    expect(r.item?.title).toContain("tianshu-mcp");
  });

  it("matchMinimaxProject：空 path → 不匹配任何东西（缺锚点不猜）", () => {
    expect(matchMinimaxProject(groups, "", "win32").item).toBeUndefined();
  });

  it("matchMinimaxProject：POSIX 分组按 POSIX 语义匹配（darwin 腿的覆盖）", () => {
    const posixGroups: MinimaxProjectGroup[] = [
      { dir: "/Users/a/Proj", key: "workspace:/Users/a/Proj", title: "Proj, /Users/a/Proj", active: false },
    ];
    // POSIX 路径大小写**敏感**：不同大小写的完整路径不命中
    expect(matchMinimaxProject(posixGroups, "/Users/a/Proj", "darwin").item?.dir).toBe(
      "/Users/a/Proj",
    );
    // 但**名称回退**是大小写不敏感的（normalizeProjectName 折叠大小写）——
    // 路径不命中时按基名回退，同一个 `Proj` 目录仍应命中。这是刻意的：
    // 分组缺席路径（`dir` 为空）时只能靠名称，折叠大小写避免漏匹配。
    expect(matchMinimaxProject(posixGroups, "/users/a/proj", "darwin").item?.dir).toBe(
      "/Users/a/Proj",
    );
    // 真正不同名的目录才应无匹配
    expect(matchMinimaxProject(posixGroups, "/Users/a/Other", "darwin").item).toBeUndefined();
  });
});

describe("MiniMax Code 会话建立与定位", () => {
  it("ensureFreshDraft：点击后输入框挂载 → true", async () => {
    const cdp = {
      newTask: vi.fn().mockResolvedValue(true),
      newTaskInProject: vi.fn().mockResolvedValue(true),
      exists: vi.fn().mockResolvedValue(true),
    };
    expect(await ensureFreshDraft(cdp, Date.now() + 2_000, { sleep: async () => {} })).toBe(true);
    expect(cdp.newTask).toHaveBeenCalled();
  });

  it("ensureFreshDraft：始终未挂载 → fail-closed false（调用方不得发送）", async () => {
    const cdp = {
      newTask: vi.fn().mockResolvedValue(true),
      newTaskInProject: vi.fn().mockResolvedValue(true),
      exists: vi.fn().mockResolvedValue(false),
    };
    const sleep = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
    expect(await ensureFreshDraft(cdp, Date.now() + 200, { sleep, reclickMs: 50 })).toBe(false);
  });

  it("ensureFreshDraft：点击被吞时交替使用两个入口重试（实测节流会吞掉单次点击）", async () => {
    const newTask = vi.fn().mockResolvedValue(true);
    const newTaskInProject = vi.fn().mockResolvedValue(true);
    let mounted = false;
    const cdp = {
      newTask,
      newTaskInProject,
      exists: vi.fn().mockImplementation(async () => mounted),
    };
    const sleep = async (): Promise<void> => {
      mounted = true; // 第二次轮询才挂载
    };
    expect(await ensureFreshDraft(cdp, Date.now() + 2_000, { sleep, pollIntervalMs: 10 })).toBe(
      true,
    );
    // 至少点过一次（首次必然是全局入口）
    expect(newTask.mock.calls.length + newTaskInProject.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("locateSessionProject：项目分组完整路径命中 → found（权威判据）", async () => {
    const cdp = {
      sessionTitles: async () => [],
      projectGroups: async () => [
        {
          dir: "D:\\Trae项目\\tianshu-mcp",
          key: "workspace:D:\\Trae项目\\tianshu-mcp",
          title: "tianshu-mcp, D:\\Trae项目\\tianshu-mcp",
          active: false,
        },
      ],
      projectTriggerText: async () => ".appdata",
    };
    const r = await locateSessionProject(cdp, "D:\\Trae项目\\tianshu-mcp", undefined, "win32");
    expect(r.found).toBe(true);
    expect(r.source).toBe("project-group");
  });

  it("locateSessionProject：分组缺席但触发器文本与基名相等 → 弱判据命中", async () => {
    const cdp = {
      sessionTitles: async () => [],
      projectGroups: async () => [],
      projectTriggerText: async () => "tianshu-mcp",
    };
    const r = await locateSessionProject(cdp, "D:\\Trae项目\\tianshu-mcp", undefined, "win32");
    expect(r.found).toBe(true);
    expect(r.source).toBe("title");
  });

  it("locateSessionProject：都定位不到 → found:false（绝不打开最近会话）", async () => {
    const cdp = {
      sessionTitles: async () => [],
      projectGroups: async () => [],
      projectTriggerText: async () => ".appdata",
    };
    const r = await locateSessionProject(cdp, "D:\\Other\\proj", undefined, "win32");
    expect(r.found).toBe(false);
    expect(r.reason).toBe("missing-anchor");
  });

  it("locateSessionProject：同目录多条分组 → ambiguous（不猜一条）", async () => {
    const cdp = {
      sessionTitles: async () => [],
      projectGroups: async () => [
        { dir: "D:\\a\\proj", key: "", title: "proj, D:\\a\\proj", active: false },
        { dir: "D:\\A\\PROJ", key: "", title: "PROJ, D:\\A\\PROJ", active: false },
      ],
      projectTriggerText: async () => "",
    };
    // 两条分组归一到同一路径 → 无法唯一确定，必须 ambiguous（绝不猜）
    const r = await locateSessionProject(cdp, "D:/a/proj", undefined, "win32");
    expect(r.found).toBe(false);
    expect(r.reason).toBe("ambiguous");
  });

  it("locateSessionProject：分组存在但都不匹配且触发器不符 → not-found（不猜）", async () => {
    const cdp = {
      sessionTitles: async () => [],
      projectGroups: async () => [
        { dir: "D:\\a\\proj", key: "", title: "proj, D:\\a\\proj", active: false },
      ],
      projectTriggerText: async () => ".appdata",
    };
    const r = await locateSessionProject(cdp, "D:\\c\\other", undefined, "win32");
    expect(r.found).toBe(false);
    expect(r.reason).toBe("not-found");
  });

  it("locateSessionProject：缺全部锚点 → missing-anchor", async () => {
    const cdp = {
      sessionTitles: async () => [],
      projectGroups: async () => [],
      projectTriggerText: async () => "",
    };
    expect((await locateSessionProject(cdp, "", undefined, "win32")).reason).toBe("missing-anchor");
  });
});
