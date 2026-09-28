import { describe, expect, it } from "vitest";
import { fetchArtifactFromStore } from "../../src/agents/opendesign/artifact.js";


describe("从产物存储取回：判据与失败路径（真机已验通的路径）", () => {
  const DATA_ROOT = "C:\\data";
  const TARGET = "C:\\proj";
  const PROJECT_ID = "b05eef18-5d01-476f-a9bf-2b1facbd9842";
  const URL = `od://app/projects/${PROJECT_ID}/conversations/x/files/onboarding-guide.html`;

  const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

  /** 内存 deps：把磁盘换成可控的 map，便于断言失败路径 */
  function deps(opts: {
    files: string[];
    meta?: unknown;
    metaThrows?: boolean;
    copyThrows?: boolean;
  }) {
    const copied: Array<[string, string]> = [];
    return {
      copied,
      d: {
        listDir: () => opts.files,
        readJson: () => {
          if (opts.metaThrows) throw new Error("bad json");
          return opts.meta;
        },
        exists: () => true,
        copyArtifact: (from: string, to: string) => {
          if (opts.copyThrows) throw new Error("disk full");
          copied.push([from, to]);
        },
      },
    };
  }

  const page = (url: string) => ({ currentUrl: async () => url });

  it("URL 无 projectId → 如实失败，不猜目录", async () => {
    const { d } = deps({ files: ["a.artifact.json"] });
    const res = await fetchArtifactFromStore({
      page: page("od://app/"),
      dataRoot: DATA_ROOT,
      targetDir: TARGET,
      logger: quiet,
      deps: d,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("projects");
  });

  it("产物目录里没有 .artifact.json → 失败（不猜入口名）", async () => {
    const { d } = deps({ files: ["other.txt"] });
    const res = await fetchArtifactFromStore({
      page: page(URL),
      dataRoot: DATA_ROOT,
      targetDir: TARGET,
      logger: quiet,
      deps: d,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain(".artifact.json");
  });

  it("多个 .artifact.json → 歧义失败（绝不猜一个）", async () => {
    const { d } = deps({ files: ["a.artifact.json", "b.artifact.json"] });
    const res = await fetchArtifactFromStore({
      page: page(URL),
      dataRoot: DATA_ROOT,
      targetDir: TARGET,
      logger: quiet,
      deps: d,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("多个");
  });

  it("status 不是 complete → 失败（未就绪的产物不能拿去验收）", async () => {
    const { d } = deps({
      files: ["x.artifact.json"],
      meta: { entry: "a.html", status: "generating" },
    });
    const res = await fetchArtifactFromStore({
      page: page(URL),
      dataRoot: DATA_ROOT,
      targetDir: TARGET,
      logger: quiet,
      deps: d,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("尚未就绪");
  });

  it("复制失败 → 如实回报原因（不吞异常）", async () => {
    const { d } = deps({
      files: ["x.artifact.json"],
      meta: { entry: "onboarding-guide.html", status: "complete" },
      copyThrows: true,
    });
    const res = await fetchArtifactFromStore({
      page: page(URL),
      dataRoot: DATA_ROOT,
      targetDir: TARGET,
      logger: quiet,
      deps: d,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("复制");
  });
});
