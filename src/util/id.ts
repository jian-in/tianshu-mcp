/**
 * 基础 ID 生成。任务 id：tsk_<yyyyMMddHHmmss>_<rand6>（开发计划 §4.2）。
 */
import { randomBytes } from "node:crypto";

/**
 * 品牌类型：taskId / agentId 不再是裸 string。
 * 运行时仍是普通字符串（零开销）；编译期防止把 agentId 传给要 taskId 的参数、
 * 把 projectPath 传给要 taskId 的参数之类的"拿错 id"错误。
 */
export type TaskId = string & { readonly __brand: "TaskId" };
export type AgentId = string & { readonly __brand: "AgentId" };

/**
 * 信任边界转换：在 MCP 输入、持久化读取等外部字符串进入系统时调用。
 * 调用即表示"我已确认这个字符串确实是该种 id"。
 */
export function asTaskId(s: string): TaskId {
  return s as TaskId;
}
export function asAgentId(s: string): AgentId {
  return s as AgentId;
}

function tsCompact(d = new Date()): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function rand6(): string {
  return randomBytes(3).toString("hex").slice(0, 6);
}

export function genTaskId(): TaskId {
  return `tsk_${tsCompact()}_${rand6()}` as TaskId;
}

export function genVerifyId(): string {
  return `vfy_${tsCompact()}_${rand6()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
