/**
 * MiniMax Code 桌面实例的接管与端口探测。
 *
 * 真机事实（2026-10-05，MiniMax Code 3.1.0 / Electron 42.8.0 / Chromium 148.0.7778.280）：
 * 1) **普通 Electron 安装（非 MSIX）**：`spawn(exePath, ["--remote-debugging-port=<port>"])`
 *    可直接开启 CDP（实测：直启后 `/json/version` 返回 200）；
 * 2) 已有 MiniMax Code 进程但 argv 里没有有效调试端口 → 返回 `{ needsClose: true }`，
 *    由上层转 needs_user(close_existing_instance)。**绝不 kill 用户进程**；
 * 3) 产品校验不能只看「端口上有个 page」：必须是 MiniMax Code 自己的窗口。
 *    /json/version 的 User-Agent 含 `MiniMax/<版本>`，或页面 URL 以 `app://./archon` 开头。
 *
 * 端口基准 9999（区段 9999–10008），与既有 9222/9333/9666/9777/9889 均不重叠。
 */
import net from "node:net";
import { get as httpGet } from "node:http";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { spawn, execFile } from "node:child_process";
import path from "node:path";
import type { GuiProfile } from "../../config/schema.js";
import type { AgentRunLogger } from "../adapter.js";
import { execFileAsync } from "../../verify/exec.js";
import { TtlCache } from "../../util/ttl-cache.js";
import { guiInstanceSpawnOptions } from "../gui-instance.js";

export interface MinimaxProcess {
  pid: number;
  commandLine: string;
  executable?: string;
}

export interface MinimaxReady {
  port: number;
  title?: string;
  url?: string;
  pid?: number;
}

export interface MinimaxProbeResult {
  ready: boolean;
  /** /json/version 里的产品版本串（Browser 字段优先，缺省退回 User-Agent） */
  version?: string;
  title?: string;
  url?: string;
}

/** Windows：`pid\texe\tcommandLine`；darwin 的 ps 行在解析时补成同样形状 */
export function parseProcessRows(raw: string): MinimaxProcess[] {
  const out: MinimaxProcess[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = /^(\d+)\t(.*?)\t(.*)$/.exec(line.trim());
    if (m) out.push({ pid: Number(m[1]), executable: m[2] || undefined, commandLine: m[3] || "" });
  }
  return out;
}

/** 进程枚举短缓存（1.5s）：轮询环每 tick 复用同一快照，避免重复 powershell/pgrep 枚举 */
const processCache = new TtlCache<MinimaxProcess[]>(1_500);
const PROCESS_CACHE_KEY = "minimax-process-list";

export function listMinimaxProcesses(): Promise<MinimaxProcess[]> {
  return processCache.get(PROCESS_CACHE_KEY, enumerateMinimaxProcesses);
}

/** macOS 进程匹配模式：可执行名含空格，用 pgrep -f 匹配完整名 */
const MINIMAX_PROCESS_PATTERN = "MiniMax Code";

async function enumerateMinimaxProcesses(): Promise<MinimaxProcess[]> {
  if (process.platform === "win32") {
    // 可执行名含空格：Win32_Process 的 Name 过滤字面量必须是 'MiniMax Code.exe'。
    const script =
      'Get-CimInstance Win32_Process -Filter "Name=\'MiniMax Code.exe\'" | ForEach-Object { "$($_.ProcessId)`t$($_.ExecutablePath)`t$($_.CommandLine)" }';
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
        timeoutMs: 15_000,
      });
      if (res.status === 0) return parseProcessRows(res.stdout);
    }
    return [];
  }
  const pids = await execFileAsync("pgrep", ["-f", MINIMAX_PROCESS_PATTERN], { timeoutMs: 5_000 });
  if (pids.status !== 0) return [];
  const list = pids.stdout
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 64);
  if (!list.length) return [];
  // pgrep 只给 pid；调试端口在 argv 里，必须再取一次命令行。
  const details = await execFileAsync("ps", ["-p", list.join(","), "-o", "pid=,command="], {
    timeoutMs: 5_000,
  });
  if (details.status !== 0) return [];
  return details.stdout.split(/\r?\n/).flatMap((line) => {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), commandLine: m[2]! }] : [];
  });
}

export interface MinimaxInstanceOptions {
  signal?: AbortSignal;
  deadline?: number;
}

/** 带 signal/deadline 的进程枚举（ensureMinimaxInstance 内部用；缓存版本不感知取消） */
export async function listMinimaxProcessesAsync(
  options: MinimaxInstanceOptions = {},
): Promise<MinimaxProcess[]> {
  options.signal?.throwIfAborted();
  if (process.platform === "win32") {
    const timeout = Math.max(1, Math.min(30_000, (options.deadline ?? Infinity) - Date.now()));
    const script =
      'Get-CimInstance Win32_Process -Filter "Name=\'MiniMax Code.exe\'" | ForEach-Object { "$($_.ProcessId)`t$($_.ExecutablePath)`t$($_.CommandLine)" }';
    const { stdout } = await promisify(execFile)(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { timeout, signal: options.signal, windowsHide: true },
    );
    return parseProcessRows(stdout);
  }
  return enumerateMinimaxProcesses();
}

/**
 * 只保留 MiniMax Code 根进程：Electron 的渲染/GPU/工具子进程同样命中可执行名，
 * 它们不带（也不该带）调试端口，混进来会让「是否已存在无 CDP 实例」的判断失真。
 */
export function rootMinimaxProcesses(rows: MinimaxProcess[]): MinimaxProcess[] {
  return rows.filter(
    (p) => !/--type=|crashpad|plugin-host|cua-helper|utility-sub-type/i.test(p.commandLine),
  );
}

export function remoteDebugPort(commandLine: string): number | null {
  const m = /--remote-debugging-port(?:=|\s+)(\d+)/.exec(commandLine);
  return m ? Number(m[1]) : null;
}

function freePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

/** CDP 只读 JSON 端点读取器（单测可注入假响应） */
export type CdpJsonFetcher = (port: number, pathname: string, timeoutMs: number) => Promise<unknown>;

export const fetchCdpJson: CdpJsonFetcher = (port, pathname, timeoutMs) =>
  new Promise((resolve, reject) => {
    const req = httpGet({ host: "127.0.0.1", port, path: pathname, timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`CDP ${pathname} 响应无法解析: ${(e as Error).message}`));
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`连接 127.0.0.1:${port}${pathname} 超时`));
    });
    req.on("error", (e) => reject(e));
  });

interface CdpPageTargetLike {
  type?: string;
  title?: string;
  url?: string;
}

/**
 * 探测端口是否为「MiniMax Code 的 CDP 端口」。
 * 产品校验（二选一即可）：/json/version 的 UA 含 `MiniMax/`，
 * 或存在 URL 以 `app://./archon` 开头的页面（实测主窗口 URL）。
 * 二者都不成立即拒绝——否则会把别的 Electron 应用（同样有 page + CDP）当成本产品接管。
 */
export async function probeMinimaxPort(
  port: number,
  timeoutMs = 1_500,
  fetchJson: CdpJsonFetcher = fetchCdpJson,
): Promise<MinimaxProbeResult> {
  const version = await fetchJson(port, "/json/version", timeoutMs).catch(() => undefined);
  const targets = await fetchJson(port, "/json", timeoutMs).catch(() => undefined);
  const ua = String((version as { "User-Agent"?: unknown } | undefined)?.["User-Agent"] ?? "");
  const browser = String((version as { Browser?: unknown } | undefined)?.Browser ?? "");
  const pages = (Array.isArray(targets) ? (targets as CdpPageTargetLike[]) : []).filter(
    (t) => t.type === "page",
  );
  const productPages = pages.filter((t) => (t.url ?? "").startsWith("app://./archon"));
  if (!/minimax\//i.test(ua) && !productPages.length) return { ready: false };
  const main = productPages
    .filter((t) => !/model-menu|react-screenshots/i.test(t.url ?? ""))
    .sort((a, b) => rankOf(a) - rankOf(b))[0];
  return {
    ready: true,
    version: browser || ua || undefined,
    title: main?.title,
    url: main?.url,
  };
}

/** 主窗口优先：title 恰为 `MiniMax Code` 者优先，其余 app://./archon 页面次之 */
function rankOf(target: CdpPageTargetLike): number {
  return (target.title ?? "").trim() === "MiniMax Code" ? 0 : 1;
}

export async function ensureMinimaxInstance(
  exePath: string,
  gui: GuiProfile,
  logger: AgentRunLogger,
  options: MinimaxInstanceOptions = {},
): Promise<{ ready?: MinimaxReady; needsClose?: boolean }> {
  let roots = rootMinimaxProcesses(await listMinimaxProcessesAsync(options));
  if (!roots.length) {
    await delay(500, undefined, { signal: options.signal });
    roots = rootMinimaxProcesses(await listMinimaxProcessesAsync(options));
  }
  if (roots.length) {
    const argvPorts = roots
      .map((p) => remoteDebugPort(p.commandLine))
      .filter((value): value is number => value !== null);
    if (!argvPorts.length) return { needsClose: true };
    const reuseDeadline = Math.min(
      options.deadline ?? Infinity,
      Date.now() + gui.launchTimeoutMs,
    );
    while (Date.now() < reuseDeadline) {
      roots = rootMinimaxProcesses(await listMinimaxProcessesAsync(options));
      const recomputed = roots
        .map((p) => remoteDebugPort(p.commandLine))
        .filter((value): value is number => value !== null);
      const tickPorts = recomputed.length > 0 ? recomputed : argvPorts;
      for (const port of tickPorts) {
        const ready = await probeMinimaxPort(port);
        if (ready.ready) return { ready: { port, title: ready.title, url: ready.url } };
      }
      await delay(500, undefined, { signal: options.signal });
    }
    throw new Error(`等待既有 MiniMax Code CDP 页面就绪超时（${gui.launchTimeoutMs}ms）`);
  }
  options.signal?.throwIfAborted();
  let port = gui.cdpPort;
  if (gui.cdpPortAuto) {
    let found = false;
    for (let i = 0; i < gui.cdpPortRange; i++) {
      if (await freePort(gui.cdpPort + i)) {
        port = gui.cdpPort + i;
        found = true;
        break;
      }
    }
    if (!found)
      throw new Error(
        `MiniMax Code CDP 端口范围不可用：${gui.cdpPort}-${gui.cdpPort + gui.cdpPortRange - 1}`,
      );
  } else if (!(await freePort(port))) throw new Error(`MiniMax Code CDP 端口 ${port} 已被占用`);
  const args = gui.exeArgs.map((arg) => arg.replaceAll("<port>", String(port)));
  options.signal?.throwIfAborted();
  // 桌面实例必须 detached：不变量与实测依据见 guiInstanceSpawnOptions。
  const child = spawn(exePath, args, guiInstanceSpawnOptions(false));
  let launchError: Error | undefined;
  child.once("error", (error) => {
    launchError = error;
  });
  // 实例要跨 MCP server 退出驻留，不能把已完成的探测进程挂在事件循环上。
  child.unref();
  logger.info(
    `[minimax] 已启动 ${path.basename(exePath)}，CDP 端口 ${port}，pid=${child.pid ?? "unknown"}`,
  );
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + gui.launchTimeoutMs);
  while (Date.now() < deadline) {
    await delay(500, undefined, { signal: options.signal });
    if (launchError) throw launchError;
    const ready = await probeMinimaxPort(port);
    if (ready.ready) return { ready: { port, title: ready.title, url: ready.url, pid: child.pid } };
    if (child.exitCode !== null) {
      // 启动器把参数转交给既有实例后会立刻退出：此时复用既有实例的 CDP 端口。
      const forwardedRoots = rootMinimaxProcesses(await listMinimaxProcessesAsync(options));
      for (const proc of forwardedRoots) {
        const forwardedPort = remoteDebugPort(proc.commandLine);
        if (!forwardedPort) continue;
        const forwarded = await probeMinimaxPort(forwardedPort);
        if (forwarded.ready) {
          logger.info(
            `[minimax] 启动器 exit=${child.exitCode}，已复用现有 MiniMax Code CDP 端口 ${forwardedPort}`,
          );
          return {
            ready: {
              port: forwardedPort,
              title: forwarded.title,
              url: forwarded.url,
              pid: proc.pid,
            },
          };
        }
      }
      if (child.exitCode !== 0)
        throw new Error(`MiniMax Code 启动后提前退出（exit=${child.exitCode}）`);
    }
  }
  throw new Error(`等待 MiniMax Code CDP 就绪超时（${gui.launchTimeoutMs}ms）`);
}
