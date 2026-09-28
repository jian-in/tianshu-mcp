/**
 * Open Design「导出」段的单元测试（计划：导出 → 视觉验收）。
 *
 * 为什么需要这一步：适配器此前跑到「任务完成」就交验收，但 Open Design 的产物**不会自动落到
 * 项目目录** —— 必须在界面里点「导出」并处理弹出的**原生保存对话框**（真机取证 2026-09-28：
 * 默认落在「下载」，用户需在地址栏输入项目任务文件夹）。少了这一步，`visual.ts` 永远报
 * 「未在项目内找到设计稿入口」，视觉验收整段空转。
 *
 * 本文件只测**可测的判据层**（菜单文本映射、路径/文件名推导、解压命令、产物定位），
 * 真实点击与原生对话框由真机冒烟覆盖。
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addressBarMatches,
  artifactEntryFromJson,
  artifactProjectDir,
  chooseExportKind,
  exportItemText,
  exportedArtifactName,
  exportedFileNameFor,
  isArtifactReady,
  normalizeExportKind,
  pickExportedArtifact,
  projectIdFromUrl,
  saveDialogScriptSource,
  zipExtractCommand,
} from "../../src/agents/opendesign/export.js";

describe("导出：方式归一与菜单文本", () => {
  it("归一导出方式：zip / html 两种，非法值拒绝", () => {
    expect(normalizeExportKind("zip")).toBe("zip");
    expect(normalizeExportKind("html")).toBe("html");
    expect(normalizeExportKind("ZIP")).toBe("zip");
    expect(normalizeExportKind("独立 HTML")).toBe("html");
    expect(normalizeExportKind("pdf")).toBeNull();
    expect(normalizeExportKind("png")).toBeNull();
    expect(normalizeExportKind("")).toBeNull();
  });

  it("方式 → 菜单项文本（真机取证的四项文案，只支持其中两项）", () => {
    // 真机菜单：导出为 PDF / 导出为图片 / 下载为 .zip / 导出为独立 HTML
    expect(exportItemText("zip")).toBe("下载为 .zip");
    expect(exportItemText("html")).toBe("导出为独立 HTML");
  });

  it("chooseExportKind：默认 html（免解压、可直接静态服务），可显式指定", () => {
    expect(chooseExportKind(undefined)).toBe("html");
    expect(chooseExportKind("")).toBe("html");
    expect(chooseExportKind("zip")).toBe("zip");
    expect(chooseExportKind("html")).toBe("html");
  });

  it("非法方式回退到默认 html（而不是抛错阻断整条链路）", () => {
    expect(chooseExportKind("pdf")).toBe("html");
    expect(chooseExportKind("excel")).toBe("html");
  });
});

describe("导出：文件名与产物定位", () => {
  it("文件名从产物名推导；html 保留原扩展名，zip 换成 .zip", () => {
    expect(exportedFileNameFor("html", "onboarding-guide.html")).toBe("onboarding-guide.html");
    expect(exportedFileNameFor("zip", "onboarding-guide.html")).toBe("onboarding-guide.zip");
    // 产物名缺失时给稳定兜底名（保存对话框不能为空）
    expect(exportedFileNameFor("html", "")).toBe("opendesign-export.html");
    expect(exportedFileNameFor("html", "   ")).toBe("opendesign-export.html");
  });

  it("产物名兜底：从 od:// 文件 URL 里取最后一段", () => {
    expect(
      exportedArtifactName(
        "od://app/projects/b05eef18/conversations/72b444b5/files/onboarding-guide.html",
      ),
    ).toBe("onboarding-guide.html");
    expect(exportedArtifactName("od://app/")).toBe("");
    expect(exportedArtifactName("")).toBe("");
    // 带查询串/锚点也要剥掉
    expect(exportedArtifactName("od://app/x/files/guide.html?v=2")).toBe("guide.html");
  });

  it("pickExportedArtifact：在导出目录里挑出本次产物，跳过临时文件", () => {
    const files = [
      { name: "onboarding-guide.html", size: 42_000, mtimeMs: 100 },
      { name: "onboarding-guide.html.crdownload", size: 100, mtimeMs: 200 },
      { name: "notes.txt", size: 10, mtimeMs: 300 },
    ];
    expect(pickExportedArtifact("html", files)).toBe("onboarding-guide.html");
    // zip 方式：挑 .zip 且排除未完成的临时下载
    const zips = [
      { name: "onboarding-guide.zip.crdownload", size: 10, mtimeMs: 10 },
      { name: "onboarding-guide.zip", size: 5_000, mtimeMs: 20 },
    ];
    expect(pickExportedArtifact("zip", zips)).toBe("onboarding-guide.zip");
    // 没有匹配就返回 null（调用方据此转 needs_user / 如实报告）
    expect(pickExportedArtifact("zip", files)).toBeNull();
    expect(pickExportedArtifact("html", [])).toBeNull();
    // 多个 html 时取最新修改的那个（用户可能反复导出）
    const many = [
      { name: "a.html", size: 1, mtimeMs: 100 },
      { name: "b.html", size: 1, mtimeMs: 900 },
    ];
    expect(pickExportedArtifact("html", many)).toBe("b.html");
  });
});

describe("导出：解压命令", () => {  it("zip 用 PowerShell Expand-Archive（Windows 内置，不引入新依赖）", () => {
    const cmd = zipExtractCommand("C:\\proj\\out.zip", "C:\\proj");
    expect(cmd.file).toBe("powershell.exe");
    expect(cmd.args.join(" ")).toContain("Expand-Archive");
    expect(cmd.args.join(" ")).toContain("C:\\proj\\out.zip");
    expect(cmd.args.join(" ")).toContain("C:\\proj");
    // -Force 覆盖已有内容，避免第二次导出因目录非空而失败
    expect(cmd.args.join(" ")).toContain("-Force");
  });

  it("路径含空格与中文时仍作为独立参数传递（不做字符串拼接）", () => {
    const cmd = zipExtractCommand("D:\\Trae项目\\AI游戏\\test\\导出 包.zip", "D:\\Trae项目\\AI游戏\\test");
    expect(cmd.args.some((a) => a.includes("导出 包.zip"))).toBe(true);
    expect(cmd.args.some((a) => a === "D:\\Trae项目\\AI游戏\\test")).toBe(true);
  });
});

describe("导出：保存对话框的地址栏导航（真机卡点）", () => {
  it("地址栏显示值与目标目录的匹配判据（真机形态）", () => {
    const target = "D:\\Trae项目\\AI游戏\\test";
    // 真机取证（2026-09-28）：对话框默认停在「此电脑 > 下载」，此时**绝不能**当作已导航
    expect(addressBarMatches("此电脑 > 下载", target)).toBe(false);
    expect(addressBarMatches("下载", target)).toBe(false);
    expect(addressBarMatches("", target)).toBe(false);
    expect(addressBarMatches(undefined, target)).toBe(false);
    // 已导航到目标目录：面包屑形态与纯路径形态都要认
    expect(addressBarMatches("D:\\Trae项目\\AI游戏\\test", target)).toBe(true);
    expect(addressBarMatches("此电脑 > 软件(D:) > Trae项目 > AI游戏 > test", target)).toBe(true);
    // 反斜杠/正斜杠、大小写、尾斜杠都要归一
    expect(addressBarMatches("d:/Trae项目/AI游戏/test/", target)).toBe(true);
    // 只是目标目录的**父级**不算到达（导航到父级仍会存错地方）
    expect(addressBarMatches("D:\\Trae项目\\AI游戏", target)).toBe(false);
  });

  it("保存脚本必须用 UIA 设地址栏，且**不得**依赖前台 SendKeys（真机教训）", () => {
    // 只看**可执行行**：PowerShell 注释里提到这些词是说明性的，不算违规
    const code = saveDialogScriptSource()
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    // 地址栏是 ToolbarWindow32 内的控件，WM_SETTEXT 对它无效 → 必须走 UIA 的 ValuePattern
    expect(code).toContain("UIAutomation");
    expect(code).toContain("SetValue");
    // 后台 MCP 子进程调 SetForegroundWindow 会被 Windows 拒绝，
    // SendKeys 因此永远打不到地址栏（跨会话实测：地址栏 Edit 永不出现、空转到 deadline）
    expect(code).not.toContain("SendKeys");
    expect(code).not.toContain("SetForegroundWindow");
  });

  it("保存脚本必须回读地址栏确认已导航（只设值不算到达）", () => {
    const src = saveDialogScriptSource();
    expect(src).toContain("save:address-readback");
  });
});

describe("导出：从产物存储取回（绕开原生保存对话框的正确路径）", () => {
  it("从产物 URL 解析 projectId（真机 URL 形态）", () => {
    // 真机：od://app/projects/b05eef18-5d01-476f-a9bf-2b1facbd9842/conversations/<id>/files/onboarding-guide.html
    expect(
      projectIdFromUrl(
        "od://app/projects/b05eef18-5d01-476f-a9bf-2b1facbd9842/conversations/72b444b5-b5a4-449d-8848-fcd2ab272094/files/onboarding-guide.html",
      ),
    ).toBe("b05eef18-5d01-476f-a9bf-2b1facbd9842");
    // 会话页/项目根等其它形态
    expect(projectIdFromUrl("od://app/projects/abc-123")).toBe("abc-123");
    expect(projectIdFromUrl("od://app/")).toBeNull();
    expect(projectIdFromUrl("")).toBeNull();
    expect(projectIdFromUrl("https://example.com/projects/x")).toBeNull();
  });

  it("从 artifact.json 读 entry 与 status（比猜文件名可靠）", () => {
    expect(
      artifactEntryFromJson({
        version: 1,
        kind: "html",
        entry: "onboarding-guide.html",
        status: "complete",
      }),
    ).toEqual({ entry: "onboarding-guide.html", status: "complete" });
    // 缺 entry / 非对象 / 数组 一律 null（不猜）
    expect(artifactEntryFromJson({ status: "complete" })).toBeNull();
    expect(artifactEntryFromJson(null)).toBeNull();
    expect(artifactEntryFromJson([])).toBeNull();
    expect(artifactEntryFromJson("x")).toBeNull();
  });

  it("产物就绪判据：status=complete 且 entry 非空才算可用", () => {
    expect(isArtifactReady({ entry: "a.html", status: "complete" })).toBe(true);
    expect(isArtifactReady({ entry: "a.html", status: "generating" })).toBe(false);
    expect(isArtifactReady({ entry: "", status: "complete" })).toBe(false);
    expect(isArtifactReady(null)).toBe(false);
  });

  it("产物目录：<dataRoot>/projects/<projectId>（断言与宿主平台无关）", () => {
    // 跨平台教训（同族缺陷已在 CI 上红过）：不要写死分隔符或期望值字面量，
    // 否则这条用例只在某一类宿主上通过。用 path.join 造期望，与生产同源。
    expect(artifactProjectDir("C:\\data", "abc-123")).toBe(
      path.join("C:\\data", "projects", "abc-123"),
    );
    expect(artifactProjectDir("/data", "abc-123")).toBe(path.join("/data", "projects", "abc-123"));
    // 不变量：末段恒为 projects/<id>（与宿主无关）
    expect(artifactProjectDir("/data", "abc-123").endsWith(path.join("projects", "abc-123"))).toBe(
      true,
    );
  });
});
