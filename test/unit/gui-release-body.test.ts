import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// @ts-expect-error -- scripts/*.mjs 不维护类型声明（仓库没有为 scripts 生成 .d.mts 的惯例）
import { composeGuiReleaseBody, readGuiReleaseDoc } from "../../scripts/gui-release-body.mjs";

const VERSION = "9.9.9";
const createdRoots: string[] = [];

/** 造一个临时「仓库根」（只含 docs/），用于脱离真实文档驱动合成逻辑 */
function makeRoot(docs: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-release-body-"));
  createdRoots.push(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  for (const [name, text] of Object.entries(docs)) {
    fs.writeFileSync(path.join(root, "docs", name), text, "utf8");
  }
  return root;
}

afterEach(() => {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("GUI 发行版正文合成", () => {
  it("缺文档时明确报错，不生成空壳正文", () => {
    const root = makeRoot({});
    expect(() =>
      composeGuiReleaseBody({ version: VERSION, host: "github", ownerRepo: "o/r", root }),
    ).toThrow(/release-gui-v9\.9\.9/);
  });

  it("合成正文并把相对链接绝对化到该 tag", () => {
    const root = makeRoot({
      [`release-gui-v${VERSION}.md`]: [
        "# 日志台 9.9.9",
        "",
        "详见 [CHANGELOG](../CHANGELOG.md)。",
      ].join("\n"),
    });
    const body = composeGuiReleaseBody({
      version: VERSION,
      host: "github",
      ownerRepo: "lanlan0811/tianshu-mcp",
      root,
    });
    expect(body).toContain("# 日志台 9.9.9");
    expect(body).toContain(
      "https://github.com/lanlan0811/tianshu-mcp/blob/gui-v9.9.9/docs/../CHANGELOG.md",
    );
    expect(body).toContain("https://github.com/lanlan0811/tianshu-mcp/releases/tag/gui-v9.9.9");
  });

  it("中英双语按「中文 → 分节线 → 英文」拼接", () => {
    const root = makeRoot({
      [`release-gui-v${VERSION}.md`]: "# 中文标题",
      [`release-gui-v${VERSION}.en.md`]: "# English title",
    });
    const body = composeGuiReleaseBody({ version: VERSION, host: "github", ownerRepo: "o/r", root });
    expect(body.indexOf("# 中文标题")).toBeLessThan(body.indexOf("# English title"));
    expect(body).toContain("\n\n---\n\n");
  });

  it("Gitee 宿主下页脚指向 gitee.com", () => {
    const root = makeRoot({ [`release-gui-v${VERSION}.md`]: "# 标题" });
    const body = composeGuiReleaseBody({
      version: VERSION,
      host: "gitee",
      ownerRepo: "Lan0811/tianshu-mcp",
      root,
    });
    expect(body).toContain("https://gitee.com/Lan0811/tianshu-mcp/releases/tag/gui-v9.9.9");
  });

  it("不输出 npm registry 行（GUI 不发 npm）", () => {
    const root = makeRoot({ [`release-gui-v${VERSION}.md`]: "# 标题" });
    const body = composeGuiReleaseBody({ version: VERSION, host: "github", ownerRepo: "o/r", root });
    expect(body).not.toContain("npmjs.com");
    expect(body.toLowerCase()).not.toContain("npm registry");
  });

  it("版本号前缀容忍 v / gui-v", () => {
    const root = makeRoot({ [`release-gui-v${VERSION}.md`]: "# 标题" });
    for (const v of [VERSION, `v${VERSION}`, `gui-v${VERSION}`]) {
      const body = composeGuiReleaseBody({ version: v, host: "github", ownerRepo: "o/r", root });
      expect(body).toContain("releases/tag/gui-v9.9.9");
    }
  });

  it("readGuiReleaseDoc：有文件返回去首尾空白的内容，缺文件返回 null", () => {
    const root = makeRoot({ [`release-gui-v${VERSION}.md`]: "  # 标题  \n" });
    expect(readGuiReleaseDoc(VERSION, "zh", root)).toBe("# 标题");
    expect(readGuiReleaseDoc(VERSION, "en", root)).toBeNull();
  });
});
