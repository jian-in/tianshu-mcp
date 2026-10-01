#!/usr/bin/env node
/**
 * TS ↔ Rust ↔ 前端镜像 三方词表一致性检查（issue #25 的防漂移门禁）。
 *
 * 真源（唯一权威）：
 *   - `<repo>/src/tasks/task.ts`        → TASK_STATUSES / TERMINAL_STATUSES / ACTIVE_STATUSES / TaskEventName
 *   - `<repo>/src/agents/agent-events.ts` → AGENT_EVENT_NAMES
 * 镜像：
 *   - `mcp-gui/src/core/events.ts`        （前端展示与 mock 用）
 *   - `mcp-gui/src-tauri/src/schema.rs`   （Rust 侧事件分类用）
 *
 * 任一集合不相等即 `exit 1`——**不静默**、不只打印警告。
 * 另外校验 GUI 版本号在两个文件间一致（package.json ↔ tauri.conf.json）。
 *
 * 用法：node mcp-gui/scripts/check-schema-parity.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const guiRoot = path.resolve(here, "..");
const repoRoot = path.resolve(guiRoot, "..");

const files = {
  taskTs: path.join(repoRoot, "src", "tasks", "task.ts"),
  agentEventsTs: path.join(repoRoot, "src", "agents", "agent-events.ts"),
  toolsTs: path.join(repoRoot, "src", "mcp", "tools.ts"),
  eventsTs: path.join(guiRoot, "src", "core", "events.ts"),
  capabilitiesTs: path.join(guiRoot, "src", "core", "capabilities.ts"),
  schemaRs: path.join(guiRoot, "src-tauri", "src", "schema.rs"),
  packageJson: path.join(guiRoot, "package.json"),
  tauriConf: path.join(guiRoot, "src-tauri", "tauri.conf.json"),
};

function read(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (err) {
    console.error(`读取失败：${file}\n  ${err.message}`);
    process.exit(2);
  }
}

/** 取出括号区间内的字符串字面量（`"x"` 与 `'x'` 都支持） */
function extractStrings(body) {
  const out = [];
  const re = /["']([^"'\n]+)["']/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/**
 * TS：`export const NAME = [ ... ];` 或 `export const NAME: T[] = [ ... ];`
 * 或 `export const NAME = [ ... ] as const;`（三种写法在真源与镜像中并存）
 */
function tsConstArray(source, name) {
  const re = new RegExp(
    `export const ${name}\\s*(?::[^=]*)?=\\s*\\[([\\s\\S]*?)\\]\\s*(?:as const)?\\s*;`,
  );
  const m = re.exec(source);
  if (!m) throw new Error(`未找到 TS 常量数组：${name}`);
  return extractStrings(m[1]);
}

/** TS：`export type TaskEventName = | "a" | "b" | AgentEventName;` */
function tsUnionMembers(source, name) {
  const re = new RegExp(`export type ${name}\\s*=([\\s\\S]*?);`);
  const m = re.exec(source);
  if (!m) throw new Error(`未找到 TS 联合类型：${name}`);
  const out = [];
  const reLiteral = /\|\s*"([^"\n]+)"/g;
  let hit;
  while ((hit = reLiteral.exec(m[1])) !== null) {
    out.push(hit[1]);
  }
  return out;
}

/** 取出常量数组体（`export const NAME[: T] = [ ... ];` / `... ] as const;`） */
function tsArrayBody(source, name) {
  const re = new RegExp(
    `export const ${name}\\s*(?::[^=]*)?=\\s*\\[([\\s\\S]*?)\\]\\s*(?:as const)?\\s*;`,
  );
  const m = re.exec(source);
  if (!m) throw new Error(`未找到 TS 常量数组：${name}`);
  return m[1];
}

/**
 * TS：常量数组内**每个对象的字符串字段**，按出现顺序取值（如 `name: "run_task"`）。
 * 用于工具面镜像比对——两边条目顺序一致，故按序取值即可。
 */
function tsObjectFieldStrings(source, name, field) {
  const body = tsArrayBody(source, name);
  const out = [];
  const re = new RegExp(`${field}\\s*:\\s*["']([^"'\\n]+)["']`, "g");
  let hit;
  while ((hit = re.exec(body)) !== null) out.push(hit[1]);
  return out;
}

/** TS：常量数组内每个对象的布尔字段（如 `requireApproval: false`） */
function tsObjectFieldBooleans(source, name, field) {
  const body = tsArrayBody(source, name);
  const out = [];
  const re = new RegExp(`${field}\\s*:\\s*(true|false)`, "g");
  let hit;
  while ((hit = re.exec(body)) !== null) out.push(hit[1] === "true");
  return out;
}

/** Rust：`pub const NAME: [&str; N] = [ ... ];` */
function rustConstArray(source, name) {
  const re = new RegExp(`pub const ${name}\\s*:[^=]*=\\s*\\[([\\s\\S]*?)\\];`);
  const m = re.exec(source);
  if (!m) throw new Error(`未找到 Rust 常量数组：${name}`);
  return extractStrings(m[1]);
}

function setOf(list) {
  return [...new Set(list)].sort();
}

function diff(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    onlyA: a.filter((x) => !sb.has(x)),
    onlyB: b.filter((x) => !sa.has(x)),
  };
}

const failures = [];

function compare(label, expected, actual, expectedSource, actualSource) {
  const e = setOf(expected);
  const a = setOf(actual);
  if (e.length === a.length && e.every((v, i) => v === a[i])) {
    console.log(`  ✓ ${label}（${e.length} 项）`);
    return;
  }
  const { onlyA, onlyB } = diff(e, a);
  failures.push(
    [
      `✗ ${label} 不一致`,
      `    ${expectedSource} 独有：${onlyA.length ? onlyA.join(", ") : "（无）"}`,
      `    ${actualSource} 独有：${onlyB.length ? onlyB.join(", ") : "（无）"}`,
    ].join("\n"),
  );
}

console.log("检查 TS 真源 ↔ 前端镜像 ↔ Rust 镜像 的词表一致性…");

const taskTs = read(files.taskTs);
const agentEventsTs = read(files.agentEventsTs);
const eventsTs = read(files.eventsTs);
const schemaRs = read(files.schemaRs);

const truth = {
  taskStatuses: tsConstArray(taskTs, "TASK_STATUSES"),
  terminalStatuses: tsConstArray(taskTs, "TERMINAL_STATUSES"),
  activeStatuses: tsConstArray(taskTs, "ACTIVE_STATUSES"),
  taskEventName: tsUnionMembers(taskTs, "TaskEventName"),
  agentEventNames: tsConstArray(agentEventsTs, "AGENT_EVENT_NAMES"),
};

const frontend = {
  taskStatuses: tsConstArray(eventsTs, "TASK_STATUSES"),
  terminalStatuses: tsConstArray(eventsTs, "TERMINAL_STATUSES"),
  activeStatuses: tsConstArray(eventsTs, "ACTIVE_STATUSES"),
  statusEventNames: tsConstArray(eventsTs, "STATUS_EVENT_NAMES"),
  agentEventNames: tsConstArray(eventsTs, "AGENT_EVENT_NAMES"),
};

const rust = {
  taskStatuses: rustConstArray(schemaRs, "TASK_STATUSES"),
  terminalStatuses: rustConstArray(schemaRs, "TERMINAL_STATUSES"),
  activeStatuses: rustConstArray(schemaRs, "ACTIVE_STATUSES"),
  statusEventNames: rustConstArray(schemaRs, "STATUS_EVENT_NAMES"),
  agentEventNames: rustConstArray(schemaRs, "AGENT_EVENT_NAMES"),
};

compare("TASK_STATUSES（前端）", truth.taskStatuses, frontend.taskStatuses, "src/tasks/task.ts", "mcp-gui/src/core/events.ts");
compare("TASK_STATUSES（Rust）", truth.taskStatuses, rust.taskStatuses, "src/tasks/task.ts", "mcp-gui/src-tauri/src/schema.rs");
compare("TERMINAL_STATUSES（前端）", truth.terminalStatuses, frontend.terminalStatuses, "src/tasks/task.ts", "mcp-gui/src/core/events.ts");
compare("TERMINAL_STATUSES（Rust）", truth.terminalStatuses, rust.terminalStatuses, "src/tasks/task.ts", "mcp-gui/src-tauri/src/schema.rs");
compare("ACTIVE_STATUSES（前端）", truth.activeStatuses, frontend.activeStatuses, "src/tasks/task.ts", "mcp-gui/src/core/events.ts");
compare("ACTIVE_STATUSES（Rust）", truth.activeStatuses, rust.activeStatuses, "src/tasks/task.ts", "mcp-gui/src-tauri/src/schema.rs");
compare(
  "AGENT_EVENT_NAMES（前端）",
  truth.agentEventNames,
  frontend.agentEventNames,
  "src/agents/agent-events.ts",
  "mcp-gui/src/core/events.ts",
);
compare(
  "AGENT_EVENT_NAMES（Rust）",
  truth.agentEventNames,
  rust.agentEventNames,
  "src/agents/agent-events.ts",
  "mcp-gui/src-tauri/src/schema.rs",
);

// TaskEventName 全集 = 内置状态跃迁事件 + note + agent 事件（真源的联合类型里含 `| AgentEventName`）
const truthAllEvents = setOf([...truth.taskEventName, "note", ...truth.agentEventNames]);
const frontendAllEvents = setOf([...frontend.statusEventNames, "note", ...frontend.agentEventNames]);
const rustAllEvents = setOf([...rust.statusEventNames, "note", ...rust.agentEventNames]);
compare("TaskEventName 全集（前端）", truthAllEvents, frontendAllEvents, "src/tasks/task.ts", "mcp-gui/src/core/events.ts");
compare("TaskEventName 全集（Rust）", truthAllEvents, rustAllEvents, "src/tasks/task.ts", "mcp-gui/src-tauri/src/schema.rs");

// MCP 工具面：真源 TOOL_DEFS ↔ GUI 镜像 MCP_TOOLS（名称 + capability + requireApproval 三元组按序比对）
// 「MCP 能力」视图的内容就是这份镜像——新工具（如 issue #28 的 wait_task / wait_any）必须两边同步。
try {
  const toolTriples = (src, constName) => {
    const names = tsObjectFieldStrings(src, constName, "name");
    const caps = tsObjectFieldStrings(src, constName, "capability");
    const approvals = tsObjectFieldBooleans(src, constName, "requireApproval");
    if (names.length !== caps.length || names.length !== approvals.length) {
      throw new Error(
        `${constName} 字段数不一致：name=${names.length} capability=${caps.length} requireApproval=${approvals.length}`,
      );
    }
    return names.map((n, i) => `${n}|${caps[i]}|${approvals[i]}`);
  };
  compare(
    "MCP 工具面（前端镜像）",
    toolTriples(read(files.toolsTs), "TOOL_DEFS"),
    toolTriples(read(files.capabilitiesTs), "MCP_TOOLS"),
    "src/mcp/tools.ts",
    "mcp-gui/src/core/capabilities.ts",
  );
} catch (err) {
  failures.push(`✗ MCP 工具面比对失败：${err.message}`);
}

// GUI 版本号：两个文件必须一致（否则打包产物版本与前端显示不一致）
try {
  const pkg = JSON.parse(read(files.packageJson));
  const conf = JSON.parse(read(files.tauriConf));
  if (pkg.version === conf.version) {
    console.log(`  ✓ GUI 版本号一致（${pkg.version}）`);
  } else {
    failures.push(
      `✗ GUI 版本号不一致：package.json=${pkg.version} tauri.conf.json=${conf.version}`,
    );
  }
} catch (err) {
  failures.push(`✗ 版本号检查失败：${err.message}`);
}

if (failures.length > 0) {
  console.error("\n词表一致性检查未通过：\n");
  for (const item of failures) console.error(item);
  console.error(
    "\n请把差异同步到镜像文件（真源始终是 src/tasks/task.ts、src/agents/agent-events.ts 与 src/mcp/tools.ts）。",
  );
  process.exit(1);
}

console.log("\n全部一致：TS 真源 / 前端镜像 / Rust 镜像 三方词表无漂移（含 MCP 工具面）。");