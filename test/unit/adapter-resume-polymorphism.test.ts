/**
 * AgentAdapter.planResume / buildResumePayload 多态回归测试。
 * 覆盖旧 task-manager.ts 6 分支链与 context.ts buildResume 6 分支链的行为：
 * 每个 adapter 自己声明恢复语义，编排层只做分发。
 */
import { describe, it, expect } from "vitest";
import { ZcodeGuiAdapter } from "../../src/agents/zcode/adapter.js";
import { CodexGuiAdapter } from "../../src/agents/codex/adapter.js";
import { QoderGuiAdapter } from "../../src/agents/qoder/adapter.js";
import { KimicodeGuiAdapter } from "../../src/agents/kimicode/adapter.js";
import { MinimaxGuiAdapter } from "../../src/agents/minimax/adapter.js";
import { OpenDesignGuiAdapter } from "../../src/agents/opendesign/adapter.js";
import { CliAdapter } from "../../src/agents/cli.js";
import type { TaskMeta } from "../../src/tasks/task.js";

function metaOf(patch: Partial<TaskMeta>): TaskMeta {
  return {
    taskId: "tsk_test" as TaskMeta["taskId"],
    status: "needs_user",
    projectPath: "/tmp/proj",
    displayPath: "/tmp/proj",
    agentId: "zcode" as TaskMeta["agentId"],
    task: "do something",
    ...patch,
  } as TaskMeta;
}

describe("planResume 多态", () => {
  it("zcode：提问缺会话锚点直接拒绝", () => {
    const a = new ZcodeGuiAdapter("zcode");
    const r = a.planResume!(metaOf({ needsUserKind: "agent_question" }), "继续");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("ZCode");
  });

  it("zcode：有会话锚点时提问会发送消息", () => {
    const a = new ZcodeGuiAdapter("zcode");
    const r = a.planResume!(
      metaOf({ needsUserKind: "agent_question", zcodeSessionId: "s1" }),
      "继续",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.continueSendMessage).toBe(true);
      expect(r.plan.continueMessage).toBe("继续");
    }
  });

  it("codex：仅支持 login_required / user_confirmation", () => {
    const a = new CodexGuiAdapter("codex");
    const bad = a.planResume!(metaOf({ needsUserKind: "agent_question" }), "继续");
    expect(bad.ok).toBe(false);
    const good = a.planResume!(metaOf({ needsUserKind: "user_confirmation" }), "继续");
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.plan.continueSendMessage).toBe(false);
      expect(good.plan.continueReobserve).toBe(true);
    }
  });

  it("qoder：缺锚点拒绝；有锚点时提问发送、不重观察", () => {
    const a = new QoderGuiAdapter("qoder");
    const bad = a.planResume!(metaOf({ needsUserKind: "agent_question" }), "继续");
    expect(bad.ok).toBe(false);
    const good = a.planResume!(
      metaOf({ needsUserKind: "agent_question", qoderSessionId: "q1" }),
      "继续",
    );
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.plan.continueSendMessage).toBe(true);
      expect(good.plan.continueReobserve).toBe(false);
    }
  });

  it("kimicode/minimax：三分派行为一致", () => {
    for (const a of [new KimicodeGuiAdapter("kimicode"), new MinimaxGuiAdapter("minimax")]) {
      const q = a.planResume!(metaOf({ needsUserKind: "agent_question" }), "继续");
      expect(q.ok).toBe(false); // 缺会话锚点
      const c = a.planResume!(metaOf({ needsUserKind: "user_confirmation" }), "继续");
      expect(c.ok).toBe(true);
      if (c.ok) expect(c.plan.continueReobserve).toBe(true);
    }
  });

  it("opendesign：无会话 id，提问也直接通过（对当前会话续说）", () => {
    const a = new OpenDesignGuiAdapter("opendesign");
    const r = a.planResume!(metaOf({ needsUserKind: "agent_question" }), "继续");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.continueSendMessage).toBe(true);
  });

  it("CliAdapter 未实现 planResume（continue_task 应拒绝）", () => {
    const a = new CliAdapter("stub");
    expect(a.planResume).toBeUndefined();
    expect(a.buildResumePayload).toBeUndefined();
  });
});

describe("buildResumePayload 多态", () => {
  it("zcode：带出自己的会话字段", () => {
    const a = new ZcodeGuiAdapter("zcode");
    const p = a.buildResumePayload!(
      metaOf({ continueMessage: "继续", zcodeSessionId: "s1", zcodeSessionTitle: "t1" }),
      1,
    );
    expect(p?.sessionId).toBe("s1");
    expect(p?.sessionTitle).toBe("t1");
    expect(p?.kind).toBe("continue");
  });

  it("非 continue 且 round<=0 时返回 undefined", () => {
    const a = new ZcodeGuiAdapter("zcode");
    expect(a.buildResumePayload!(metaOf({}), 0)).toBeUndefined();
  });

  it("codex：user_confirmation 时带 reobserve", () => {
    const a = new CodexGuiAdapter("codex");
    const p = a.buildResumePayload!(
      metaOf({ continueMessage: "继续", continueReobserve: true }),
      1,
    );
    expect(p?.reobserve).toBe(true);
    expect(p?.sessionId).toBeUndefined(); // codex 无需回选 id
  });

  it("opendesign：无 sessionId 字段", () => {
    const a = new OpenDesignGuiAdapter("opendesign");
    const p = a.buildResumePayload!(metaOf({ continueMessage: "继续" }), 1);
    expect(p?.sessionId).toBeUndefined();
    expect(p?.kind).toBe("continue");
  });
});
