import fs from "node:fs";
import path from "node:path";
import type { AgentRunLogger } from "../adapter.js";
import {
  artifactEntryFromJson,
  artifactProjectDir,
  isArtifactReady,
  projectIdFromUrl,
  type ArtifactMeta,
} from "./export.js";

/* ------------------------------------------------------------------ *
 * 从产物存储取回（**绕开原生保存对话框的正确路径**）
 *
 * 真机取证（2026-09-28）：Open Design 的设计产物本来就写在
 *   `<dataRoot>/projects/<projectId>/<entry>`
 * （`dataRoot` = `%APPDATA%\Open Design\namespaces\<namespace>\data`，
 *  `projectId` 就在产物 URL `od://app/projects/<id>/...` 里，
 *   `entry` 与 `status` 由同目录的 `<entry>.artifact.json` 给出）。
 *
 * 为什么不用「导出」菜单 + 原生保存对话框：
 *  1. 该对话框的默认目录是「下载」，必须在**地址栏**（ToolbarWindow32，非 Edit）导航到目标目录；
 *  2. 后台 MCP 子进程调 SetForegroundWindow 会被 Windows 拒绝，SendKeys 打不到地址栏
 *     （跨会话实测：地址栏 Edit 永不出现、空转到 deadline）；
 *  3. CDP 合成点击触发时，产品主进程接管下载（`Browser.downloadWillBegin` → `canceled`），
 *     保存对话框与手动点击的行为不一致，判据不稳。
 * 而直接从产物存储复制是**纯文件操作**：无窗口、无前台、无对话框，可单测、可复现。
 * ------------------------------------------------------------------ */

export interface FetchArtifactInput {
  /** 只用到 currentUrl：产物 URL 里含 projectId */
  page: { currentUrl(): Promise<string> };
  /** 产物数据根：`<namespaceRoot>/data` */
  dataRoot: string;
  /** 目标目录（项目根）：把产物复制到这里供视觉验收 */
  targetDir: string;
  logger: AgentRunLogger;
  deps?: Partial<FetchArtifactDeps>;
}

export interface FetchArtifactDeps {
  listDir(dir: string): string[];
  readJson(file: string): unknown;
  exists(file: string): boolean;
  copyArtifact(from: string, to: string): void;
}

const DEFAULT_FETCH_DEPS: FetchArtifactDeps = {
  listDir: (dir) => {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  },
  readJson: (file) => JSON.parse(fs.readFileSync(file, "utf8")),
  exists: (file) => fs.existsSync(file),
  copyArtifact: (from, to) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  },
};

export interface FetchArtifactOutcome {
  ok: boolean;
  /** 复制到目标目录的产物文件名 */
  entry?: string;
  /** 复制后的绝对路径（视觉验收据此起静态服务） */
  targetPath?: string;
  message?: string;
}

/**
 * 把当前产出的设计稿从产品存储复制到项目目录。
 *
 * 判据（每一步缺失都如实失败，不猜）：
 * - URL 里必须有 `projects/<id>`；
 * - 项目目录里必须有且仅有一个 `*.artifact.json`（多个即歧义，不猜）；
 * - `status` 必须是 `complete`（未完成的产物不能拿去验收）；
 * - `entry` 指向的文件必须真实存在。
 */
export async function fetchArtifactFromStore(
  input: FetchArtifactInput,
): Promise<FetchArtifactOutcome> {
  const deps: FetchArtifactDeps = { ...DEFAULT_FETCH_DEPS, ...input.deps };
  const url = await input.page.currentUrl().catch(() => "");
  const projectId = projectIdFromUrl(url);
  if (!projectId)
    return {
      ok: false,
      message: `当前页面不是设计文件页（URL 里没有 projects/<id>）：${url || "(空)"}`,
    };

  const dir = artifactProjectDir(input.dataRoot, projectId);
  const metas = deps.listDir(dir).filter((f) => f.endsWith(".artifact.json"));
  if (metas.length !== 1)
    return {
      ok: false,
      message:
        metas.length === 0
          ? `产物目录里没有 .artifact.json：${dir}`
          : `产物目录里有多个 .artifact.json（无法消歧，绝不猜一个）：${metas.join("、")}`,
    };

  let meta: ArtifactMeta | null;
  try {
    meta = artifactEntryFromJson(deps.readJson(path.join(dir, metas[0]!)));
  } catch (error) {
    return {
      ok: false,
      message: `读取 ${metas[0]} 失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!isArtifactReady(meta))
    return {
      ok: false,
      message: `产物尚未就绪（status=${meta?.status ?? "?"}，entry=${meta?.entry ?? "?"}）`,
    };

  const from = path.join(dir, meta!.entry);
  if (!deps.exists(from)) return { ok: false, message: `产物文件不存在：${from}` };

  const to = path.join(input.targetDir, meta!.entry);
  try {
    deps.copyArtifact(from, to);
  } catch (error) {
    return {
      ok: false,
      message: `复制产物到项目目录失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  input.logger.info(`[opendesign] 已从产物存储取回设计稿：${to}`);
  return { ok: true, entry: meta!.entry, targetPath: to };
}

/**
 * 任务终态后的「取回产物」薄封装：**永不抛错、永不改变终态**。
 *
 * 取回是**增值步骤**（供视觉验收用），不是任务成败的判据：失败时只把原因写进
 * `progressSummary` 让调用方看得见，不把「已完成」翻成失败——那会把产品侧的可恢复问题
 * 误报成适配器失败。返回一句可直接拼进 summary 的说明（空串 = 成功或无需取回）。
 */
export async function fetchArtifactForSummary(input: {
  page: { currentUrl(): Promise<string> };
  dataRoot: string | null;
  targetDir: string;
  logger: AgentRunLogger;
  deps?: Partial<FetchArtifactDeps>;
}): Promise<string> {
  if (!input.dataRoot) return "（未定位到产物数据目录，未取回设计稿）";
  if (!input.targetDir.trim()) return "";
  try {
    const res = await fetchArtifactFromStore({
      page: input.page,
      dataRoot: input.dataRoot,
      targetDir: input.targetDir,
      logger: input.logger,
      deps: input.deps,
    });
    if (res.ok) return `；设计稿已取回 \`${res.entry}\``;
    input.logger.warn(`[opendesign] 取回设计稿失败（不影响本轮终态）：${res.message ?? "未知原因"}`);
    return `；设计稿未取回（${res.message ?? "未知原因"}）`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    input.logger.warn(`[opendesign] 取回设计稿异常（不影响本轮终态）：${msg}`);
    return `；设计稿未取回（${msg}）`;
  }
}
