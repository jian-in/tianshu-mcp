#!/usr/bin/env node
/**
 * MiniMax Code 只读诊断探针（与 scripts/probe-kimicode.mjs 同构）。
 *
 * 用途：在已安装 MiniMax Code 的机器上，只读地查看安装探测结果、进程与 CDP 端口、
 * CDP page target 拓扑（主窗口 / `Model menu` 弹层 / 截图页）、模型菜单与**二级子菜单**
 * （推理等级 / 上下文窗口）、项目分组、运行信号快照，以及原生「Select Directory」对话框。
 * 输出为结构化文本，可直接贴进 docs/minimax-cdp.md 作为证据。
 *
 * 前置：脚本从 dist/ 动态 import 构建产物，必须先执行 `npm run build`。
 *
 * 副作用边界（硬性）：
 * - 默认**只读**：不启动实例、不发送任何消息（本探针没有发送能力）；
 * - 只有显式传 `--launch` 才允许在无可用实例时启动 MiniMax Code（会新开一个窗口）；
 * - `picking` 会**展开模型子菜单**（悬停）但**不点击**任何候选——模型/档位不会被改变，
 *   `menus` 会短暂打开模型菜单并读取候选，随后按 Esc 收起；
 * - 连接主窗口会把 MiniMax Code 窗口置于前台（Chromium 会节流后台页面，不置前则点击与
 *   elementFromPoint 都不可靠），这是 CDP 只读诊断的必要条件，脚本会在输出里提示。
 *
 * 用法：
 *   node scripts/probe-minimax.mjs [命令] [--port <n>] [--launch]
 */
import http from "node:http";
import { execFile } from "node:child_process";

const USAGE = `用法: node scripts/probe-minimax.mjs [命令] [选项]

命令（默认 all）：
  install     探测 MiniMax Code 可执行文件（路径 / 来源 / 版本）
  process     枚举 MiniMax Code 进程（pid / 命令行 / 解析出的 --remote-debugging-port）
  cdp         打印 /json/version 与全部 page target，并标注主窗口 / 弹层 / 截图窗口
  models      打开模型菜单，打印模型候选（名称 / 当前项 / 是否有子菜单）
  submenu     逐个悬停有子菜单的模型，打印其推理等级与上下文窗口候选（**不点击**）
  projects    打印侧栏项目分组（data-workspace-dir 完整路径）
  liveness    打印一次运行信号快照（stopVisible / 文本哈希 / pageHidden 等）
  dialogs     枚举 MiniMax Code 进程拥有的原生 #32770 窗口（标题 / 可见性）
  all         依次执行上述全部只读命令

选项：
  --port <n>  CDP 端口（默认 9999）
  --launch    允许在无可用实例时启动 MiniMax Code（默认只读，不启动；会新开一个窗口）
  --help      显示本帮助

前置：先执行 npm run build（脚本从 dist/ 动态 import 构建产物）。
`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}

/** 位置参数解析：跳过 --port 的取值，避免把端口号当成子命令 */
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--port") {
    i++;
    continue;
  }
  if (argv[i].startsWith("-")) continue;
  positional.push(argv[i]);
}
const COMMANDS = [
  "install",
  "process",
  "cdp",
  "models",
  "submenu",
  "projects",
  "liveness",
  "dialogs",
  "all",
];
const command = positional[0] ?? "all";
if (!COMMANDS.includes(command)) {
  process.stderr.write(`未知命令：${command}\n\n${USAGE}`);
  process.exit(2);
}

const portIndex = argv.indexOf("--port");
const configuredPort = Number(portIndex >= 0 && argv[portIndex + 1] ? argv[portIndex + 1] : 9999);
if (!Number.isInteger(configuredPort) || configuredPort <= 0 || configuredPort > 65535) {
  process.stderr.write(`--port 取值无效：${argv[portIndex + 1] ?? ""}\n`);
  process.exit(2);
}
const allowLaunch = argv.includes("--launch");

const section = (title) => console.log(`\n=== ${title} ===`);
const line = (label, value) => console.log(`  ${label}: ${value}`);

/** 动态 import 构建产物；失败时给出「先 build」的可操作提示 */
async function load(specifier) {
  try {
    return await import(specifier);
  } catch (error) {
    throw new Error(`加载 ${specifier} 失败（${error.message}）；请先执行 npm run build`);
  }
}

async function profileOf() {
  const { BUILTIN_PROFILES } = await load("../dist/agents/builtin.js");
  const profile = BUILTIN_PROFILES.minimax;
  if (!profile) throw new Error("dist/agents/builtin.js 里没有 minimax profile");
  return profile;
}

/** 读取 CDP 只读 JSON 端点（127.0.0.1） */
function httpJson(port, pathname, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname, timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`${pathname} 响应无法解析：${error.message}`));
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`${pathname} 超时`));
    });
    req.on("error", (error) => reject(error));
  });
}

async function minimaxProcesses() {
  const instance = await load("../dist/agents/minimax/instance.js");
  const all = await instance.listMinimaxProcesses();
  return { instance, all, roots: instance.rootMinimaxProcesses(all) };
}

/* ------------------------------ install ------------------------------ */

/**
 * 探针侧补读文件版本：探测模块的版本查询只给 5s，而本机 PowerShell 冷启动实测需 6–10s，
 * 冷启动慢时 install 会打印「未读取到」。这里用更宽的超时补一次，只为诊断可读性，
 * 不改动 adapter 的探测逻辑（版本缺失不影响安装探测结果）。
 */
async function fileVersionFallback(exePath) {
  if (process.platform !== "win32") return undefined;
  const escaped = exePath.replace(/'/g, "''");
  try {
    const stdout = await runPowerShell(
      `(Get-Item -LiteralPath '${escaped}').VersionInfo.FileVersion`,
      {},
      30_000,
    );
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function commandInstall() {
  section("install：MiniMax Code 安装探测");
  const [{ discoverMinimax }, profile] = await Promise.all([
    load("../dist/agents/minimax/discovery.js"),
    profileOf(),
  ]);
  const found = await discoverMinimax(profile);
  if (!found) {
    line("结果", "未探测到 MiniMax Code 可执行文件");
    line("建议", "确认已安装 MiniMax Code，或在 profile 中配置 gui.exePath / command");
    return { found: null };
  }
  line("可执行路径", found.path);
  line("来源", found.source);
  if (found.version) line("版本", found.version);
  else {
    const version = await fileVersionFallback(found.path);
    line("版本", version ?? "未读取到");
    console.log(
      "  说明: 探测模块的版本查询超时（本机 PowerShell 冷启动较慢），上面是探针侧用更长超时补读的结果",
    );
  }
  console.log(
    "  说明: 来源取值 explicit / fixed-drive / registry / standard / path / bundle；" +
      "路径由「显式配置 → 固定盘相对路径模板（preferredDrives 优先）→ 卸载注册表 → 标准目录 → PATH」推导，" +
      "代码不硬编码用户绝对路径",
  );
  return { found };
}

/* ------------------------------ process ------------------------------ */

async function commandProcess() {
  section("process：MiniMax Code 进程");
  const { instance, all, roots } = await minimaxProcesses();
  line("进程总数", String(all.length));
  line("根进程数", String(roots.length));
  if (!all.length) {
    line("结果", "未发现 MiniMax Code 进程（应用可能未运行）");
    return { all, roots };
  }
  const rootPids = new Set(roots.map((proc) => proc.pid));
  for (const proc of all) {
    const cdp = instance.remoteDebugPort(proc.commandLine);
    console.log(
      `  - pid=${proc.pid} 角色=${rootPids.has(proc.pid) ? "根进程" : "子进程（渲染/GPU/工具）"} cdp=${cdp ?? "无"}`,
    );
    console.log(`    可执行: ${proc.executable ?? "（未读取到）"}`);
    console.log(`    命令行: ${proc.commandLine || "（空）"}`);
  }
  return { all, roots };
}

/* -------------------------------- cdp -------------------------------- */

/** 端口候选：进程 argv 里的调试端口优先，其次探针配置端口 */
async function candidatePorts() {
  const { instance, roots } = await minimaxProcesses();
  const fromArgv = roots
    .map((proc) => instance.remoteDebugPort(proc.commandLine))
    .filter((value) => value !== null);
  return { ports: [...new Set([...fromArgv, configuredPort])], roots };
}

function targetRole(target, mainRank, menuRank) {
  const url = target.url ?? "";
  if (/react-screenshots/i.test(url)) return "截图窗口（适配器排除）";
  if (menuRank === 0) return "模型弹层窗口（Model menu）";
  if (mainRank === 0) return "主窗口（title=MiniMax Code）";
  if (mainRank === 1) return "主窗口（app:// 页面）";
  return "其它页面";
}

async function commandCdp() {
  section("cdp：CDP 端点与 page target");
  const [{ minimaxMainTargetRank, minimaxMenuTargetRank }, { ports }] = await Promise.all([
    load("../dist/agents/minimax/cdp.js"),
    candidatePorts(),
  ]);
  line("端口候选", ports.join("、"));
  for (const port of ports) {
    console.log(`\n  --- 127.0.0.1:${port} ---`);
    const version = await httpJson(port, "/json/version").catch((error) => ({
      __error: error.message,
    }));
    if (version.__error) {
      line("连接", `失败：${version.__error}`);
      continue;
    }
    const ua = String(version["User-Agent"] ?? "");
    line("Browser", version.Browser ?? "（空）");
    line("User-Agent", ua || "（空）");
    line("产品标识 MiniMax/", /minimax\//i.test(ua) ? "命中" : "未命中");
    const targets = await httpJson(port, "/json").catch(() => []);
    const pages = (Array.isArray(targets) ? targets : []).filter(
      (target) => target.type === "page",
    );
    line("page target 数", String(pages.length));
    for (const target of pages) {
      const mainRank = minimaxMainTargetRank(target);
      const menuRank = minimaxMenuTargetRank(target);
      console.log(`  - [${targetRole(target, mainRank, menuRank)}]`);
      console.log(`    mainRank=${mainRank} menuRank=${menuRank}`);
      console.log(`    title: ${target.title ?? ""}`);
      console.log(`    url:   ${target.url ?? ""}`);
    }
    const others = (Array.isArray(targets) ? targets : []).filter(
      (target) => target.type !== "page",
    );
    if (others.length)
      line("非 page target", others.map((target) => target.type).join("、"));
  }
  return { ports };
}

/* ---------------------------- CDP 客户端 ---------------------------- */

/**
 * 解析可用的 MiniMax Code CDP 端口并连接主窗口。
 * 复用顺序与 adapter 一致：先认进程 argv 里的端口 + 配置端口，并用 probeMinimaxPort 做产品校验；
 * 都没有时只有显式 --launch 才启动新实例（否则如实报告「无可用实例」）。
 */
async function resolveEndpoint() {
  const { instance, roots } = await minimaxProcesses();
  const ports = [
    ...new Set([
      ...roots
        .map((proc) => instance.remoteDebugPort(proc.commandLine))
        .filter((value) => value !== null),
      configuredPort,
    ]),
  ];
  for (const port of ports) {
    const probe = await instance.probeMinimaxPort(port);
    if (probe.ready) return { port, probe, roots, launched: false };
  }
  if (!allowLaunch)
    return {
      port: undefined,
      roots,
      message: "未发现带 CDP 的 MiniMax Code 实例（未传 --launch，不启动）",
    };

  console.log(
    "\n!!! --launch：将新开一个 MiniMax Code 窗口（注入 --remote-debugging-port）；" +
      "既有实例若已存在且未开启 CDP，Electron 单实例锁会转交参数后让启动器退出",
  );
  const [profile, { discoverMinimax }] = await Promise.all([
    profileOf(),
    load("../dist/agents/minimax/discovery.js"),
  ]);
  const found = await discoverMinimax(profile);
  if (!found)
    return { port: undefined, roots, message: "未探测到 MiniMax Code 可执行文件，无法启动" };
  const logger = {
    info: (message) => console.log(`  [launch] ${message}`),
    warn: (message) => console.log(`  [launch][warn] ${message}`),
    error: (message) => console.log(`  [launch][error] ${message}`),
    debug: () => {},
  };
  const launched = await instance.ensureMinimaxInstance(found.path, profile.gui, logger);
  if (launched.needsClose)
    return {
      port: undefined,
      roots,
      message:
        "既有 MiniMax Code 实例未开启 CDP：adapter 会转 needs_user(close_existing_instance)，请用户先关闭",
    };
  return { port: launched.ready.port, probe: launched.ready, roots, launched: true };
}

/** 连接主窗口执行只读读取；连接会把窗口置前（CDP 需要），结束统一断开 */
async function withMainClient(fn) {
  const endpoint = await resolveEndpoint();
  if (!endpoint.port) {
    line("结果", endpoint.message ?? "无可用 CDP 端点");
    return { ok: false, message: endpoint.message };
  }
  const { MinimaxCdpClient } = await load("../dist/agents/minimax/cdp.js");
  line("CDP 端口", String(endpoint.port));
  line("目标页面", `${endpoint.probe?.title ?? ""} ${endpoint.probe?.url ?? ""}`.trim());
  console.log(
    "  提示: 连接会把 MiniMax Code 主窗口置于前台（后台页面被节流，合成点击与坐标判定不可靠）",
  );
  const client = new MinimaxCdpClient(endpoint.port, 15_000, {});
  await client.connect();
  try {
    return await fn(client, endpoint);
  } finally {
    try {
      client.disconnect();
    } catch {
      /* 已断开 */
    }
  }
}

/* -------------------------------- models -------------------------------- */

async function commandModels() {
  section("models：模型候选（Model menu 独立窗口）");
  return withMainClient(async (client) => {
    const trigger = await client.modelTriggerText();
    line("模型触发器文本", JSON.stringify(trigger));
    const parsed = await load("../dist/agents/minimax/model.js");
    const value = parsed.parseTriggerValue(trigger);
    line("解析结果", `模型=${value.model || "（空）"} 档位=${value.levelToken ?? "（无）"}`);
    line("权限触发器文本", (await client.permissionText()) || "（空）");
    const opened = await client.openModelMenu(10_000);
    line("菜单是否打开", opened ? "是" : "否（触发器点击被吞或窗口未置前）");
    if (!opened) return { ok: false };
    const models = await client.menuModels();
    line("模型候选数", String(models.length));
    for (const entry of models)
      console.log(
        `  - ${entry.current ? "[当前]" : "[    ]"} ${JSON.stringify(entry.name)} hasPopup=${entry.hasPopup}`,
      );
    console.log(
      "  说明: hasPopup=true 的项**才有二级子菜单**（推理等级 / 上下文窗口）；" +
        "不带子菜单的模型无法设置这两项（实测 M2.7-highspeed / M2.7 即此类）",
    );
    await client.dismissMenus();
    line("收起后菜单是否仍打开", (await client.menuOpen()) ? "是（异常）" : "否");
    return { ok: true, trigger };
  });
}

/* -------------------------------- submenu -------------------------------- */

async function commandSubmenu() {
  section("submenu：二级子菜单（推理等级 / 上下文窗口）—— 只悬停，不点击");
  return withMainClient(async (client) => {
    const opened = await client.openModelMenu(10_000);
    line("菜单是否打开", opened ? "是" : "否");
    if (!opened) return { ok: false };
    const models = await client.menuModels();
    for (const entry of models) {
      if (!entry.hasPopup) {
        console.log(`\n  --- ${entry.name} --- 无二级子菜单（跳过）`);
        continue;
      }
      console.log(`\n  --- ${entry.name} ---`);
      // 悬停展开（实测是**唯一**展开方式；点击会直接提交切换并关闭菜单）
      const hovered = await client.hoverModel(entry.name, 8_000);
      line("子菜单是否展开", hovered ? "是" : "否");
      if (!hovered) continue;
      const owner = await client.submenuOwner();
      line("子菜单归属模型", owner || "（空）");
      const efforts = await client.effortOptions(entry.name);
      const contexts = await client.contextOptions(entry.name);
      line("推理等级", efforts.length ? efforts.map((e) => e.label + (e.current ? "*" : "")).join("/") : "（无此组）");
      line(
        "上下文窗口",
        contexts.length
          ? contexts.map((c) => c.label + (c.current ? "*" : "") + (c.higherUsage ? "(用量较高)" : "")).join("/")
          : "（无此组）",
      );
    }
    console.log(
      "\n  说明: * = 当前值。**档位/窗口集合随模型变化**（实测 M3.1-Flash-Preview 六档+窗口 /" +
        " M3 仅窗口 / deepseek-v4.1-flash 仅三档），因此 adapter 对无子菜单或集合不含目标值时" +
        " fail-closed 报错，绝不静默沿用界面当前值",
    );
    await client.dismissMenus();
    return { ok: true };
  });
}

/* ------------------------------- projects ------------------------------- */

async function commandProjects() {
  section("projects：侧栏项目分组（data-workspace-dir = 完整绝对路径）");
  return withMainClient(async (client) => {
    line("项目触发器文本", (await client.projectTriggerText()) || "（空）");
    const groups = await client.projectGroups();
    line("分组数", String(groups.length));
    for (const group of groups) {
      console.log(`  - ${group.active ? "[当前]" : "[    ]"} ${JSON.stringify(group.dir)}`);
      console.log(`    key:   ${group.key || "（空）"}`);
      console.log(`    title: ${group.title || "（空）"}`);
    }
    console.log(
      "  说明: 绑定判据是 data-workspace-dir 的**归一化完整路径**（盘符大写 + 反斜杠 + 大小写折叠），" +
        "名称仅作回退；同名不同目录一律 fail-closed",
    );
    const sessions = await client.sessionTitles();
    line("会话条目数", String(sessions.length));
    for (const session of sessions.slice(0, 10))
      console.log(`  - [${session.dir || "（无路径）"}] ${JSON.stringify(session.title).slice(0, 90)}`);
    return { ok: true, groups };
  });
}

/* ------------------------------- liveness ------------------------------- */

async function commandLiveness() {
  section("liveness：运行信号快照（单次 poll）");
  return withMainClient(async (client) => {
    const { hashText } = await load("../dist/agents/minimax/liveness.js");
    const poll = await client.poll();
    line("stopVisible（[data-testid=stop-button]，权威运行信号）", String(poll.stopVisible));
    line("sendVisible", String(poll.sendVisible ?? false));
    line("sendDisabled（aria-disabled 双态）", String(poll.sendDisabled ?? true));
    line("errorText", poll.errorText || "（无）");
    line("retryVisible（仅在 profile 配置了重试选择器时可能为真）", String(poll.retryVisible));
    line("questionVisible（产物提取，未真机复验）", String(poll.questionVisible ?? false));
    line("busyVisible（诊断用）", String(poll.busyVisible ?? false));
    line("assistantText 长度", String(poll.assistantText.length));
    line("assistantText 哈希", hashText(poll.assistantText));
    line("inputText 长度", String(poll.inputText.length));
    line("sendEnabled", String(poll.sendEnabled));
    line("pageHidden（窗口不在前台 → 点击可能被吞）", String(poll.pageHidden));
    const preview = poll.assistantText.trim().slice(0, 300);
    console.log(`  assistantText 预览: ${preview || "（空）"}`);
    console.log(
      "  说明: 输入框是 tiptap ProseMirror，清空后 innerHTML 仍保留空的 is-empty 段落（innerText 为空串）；" +
        "故空态判定走 innerText.trim()。发送按钮是 DIV，可用性读 aria-disabled（没有 disabled 属性）",
    );
    return { ok: true, poll };
  });
}

/* -------------------------------- dialogs -------------------------------- */

/** 只读枚举：目标进程拥有的 #32770 窗口（与 dialog.ts 的守卫同源，额外回报可见性用于诊断） */
const DIALOG_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class TianshuMinimaxProbe {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
'@
$ids=($env:TIANSHU_MINIMAX_PROBE_PIDS -split ',' | Where-Object { $_ -ne '' })
$script:rows=@()
[TianshuMinimaxProbe]::EnumWindows({param($h,$l)
  [uint32]$owner=0
  [void][TianshuMinimaxProbe]::GetWindowThreadProcessId($h,[ref]$owner)
  if($ids -contains [string]$owner){
    $cls=New-Object Text.StringBuilder 256
    [void][TianshuMinimaxProbe]::GetClassName($h,$cls,$cls.Capacity)
    if($cls.ToString() -eq '#32770'){
      $t=New-Object Text.StringBuilder 512
      [void][TianshuMinimaxProbe]::GetWindowText($h,$t,$t.Capacity)
      $visible=[TianshuMinimaxProbe]::IsWindowVisible($h)
      $script:rows += "dialog:$($h.ToInt64()):$($cls.ToString()):$($t.ToString()):$visible"
    }
  }
  return $true
},[IntPtr]::Zero)|Out-Null
$script:rows -join [Environment]::NewLine
`;

function runPowerShell(script, env, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: timeoutMs },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

async function commandDialogs() {
  section("dialogs：原生「Select Directory」对话框");
  if (process.platform !== "win32") {
    line("结果", `当前平台 ${process.platform} 不支持该枚举（macOS 分支 fail-closed）`);
    return { ok: false };
  }
  const { all } = await minimaxProcesses();
  if (!all.length) {
    line("结果", "未发现 MiniMax Code 进程，跳过枚举");
    return { ok: false };
  }
  line("参与枚举的 pid", all.map((proc) => proc.pid).join("、"));
  const stdout = await runPowerShell(DIALOG_SCRIPT, {
    TIANSHU_MINIMAX_PROBE_PIDS: all.map((proc) => proc.pid).join(","),
  });
  const rows = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  line("匹配窗口数", String(rows.length));
  if (!rows.length) {
    line("结果", "当前没有 #32770 窗口（对话框只在点「新建项目」后出现）");
    return { ok: true, rows };
  }
  for (const row of rows) {
    const parsed = /^dialog:(\d+):([^:]*):(.*):(True|False)$/.exec(row);
    if (!parsed) continue;
    console.log(`  - hwnd=${parsed[1]}`);
    console.log(`    类名: ${parsed[2]}`);
    console.log(`    标题: ${parsed[3] || "（空）"}`);
    console.log(`    可见: ${parsed[4] === "True" ? "是" : "否"}`);
  }
  console.log(
    "  说明: 标题实测为 **Select Directory**（界面为中文时仍是英文）；" +
      "编辑框 AutomationId=1152 + ClassName=Edit（ControlType 为 Pane，无 ValuePattern）；" +
      "确认按钮 AutomationId=1（Name=Select）、取消 AutomationId=2，均不支持 UIA InvokePattern，" +
      "只能 WM_SETTEXT 写入 + 回读 + 坐标点击",
  );
  return { ok: true, rows };
}

/* --------------------------------- all --------------------------------- */

const READ_ONLY_COMMANDS = [
  ["install", commandInstall],
  ["process", commandProcess],
  ["cdp", commandCdp],
  ["models", commandModels],
  ["submenu", commandSubmenu],
  ["projects", commandProjects],
  ["liveness", commandLiveness],
  ["dialogs", commandDialogs],
];

async function commandAll() {
  for (const [name, run] of READ_ONLY_COMMANDS) {
    try {
      await run();
    } catch (error) {
      section(`${name}：失败`);
      line("错误", error instanceof Error ? error.message : String(error));
    }
  }
}

const runners = Object.fromEntries(READ_ONLY_COMMANDS);
runners.all = commandAll;

try {
  await runners[command]();
} catch (error) {
  process.stderr.write(`探针执行失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
