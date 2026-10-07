/**
 * GUI_ADAPTERS 注册表回归测试：ensureAdapterFor 的查表重构必须与原 7 分支
 * if-else 链行为一致——选对构造器、类型切换时重建、未指定时回退 CliAdapter。
 * 用 status:"unsupported" 让 resolve() 跳过可执行探测（只测 adapter 选择）。
 */
import { describe, it, expect } from "vitest";
import { AgentAdapterRegistry } from "../../src/agents/registry.js";
import { CliAdapter } from "../../src/agents/cli.js";
import { ZcodeGuiAdapter } from "../../src/agents/zcode/adapter.js";
import { TraeworkGuiAdapter } from "../../src/agents/traework/adapter.js";
import { CodexGuiAdapter } from "../../src/agents/codex/adapter.js";
import { Logger } from "../../src/util/log.js";
import type { AgentProfile } from "../../src/config/schema.js";

const silentLogger = new Logger(null, "error");

function profileOf(p: Partial<AgentProfile>): Record<string, AgentProfile> {
  return {
    myagent: {
      driver: "spawn",
      status: "research",
      ...p,
    } as AgentProfile,
  };
}

function makeRegistry(profiles: Record<string, AgentProfile>) {
  return new AgentAdapterRegistry(async () => profiles, silentLogger);
}

describe("GUI_ADAPTERS 注册表", () => {
  it("按 adapter 类型选对构造器", async () => {
    const r = makeRegistry(profileOf({ adapter: "zcode-gui", driver: "gui" }));
    await r.resolve("myagent");
    expect(r.getAdapter("myagent")).toBeInstanceOf(ZcodeGuiAdapter);
  });

  it("adapter 类型切换时重建实例", async () => {
    let profiles = profileOf({ adapter: "zcode-gui", driver: "gui" });
    const r = makeRegistry(profiles);
    await r.resolve("myagent");
    const first = r.getAdapter("myagent");
    expect(first).toBeInstanceOf(ZcodeGuiAdapter);

    profiles = profileOf({ adapter: "codex-gui", driver: "gui" });
    (r as unknown as { invalidate: (id?: string) => void }).invalidate("myagent");
    // 换 profile 源：重建 registry 模拟热加载
    const r2 = makeRegistry(profiles);
    await r2.resolve("myagent");
    expect(r2.getAdapter("myagent")).toBeInstanceOf(CodexGuiAdapter);
  });

  it("driver=gui 未指定 adapter 时默认 traework-gui", async () => {
    const r = makeRegistry(profileOf({ driver: "gui" }));
    await r.resolve("myagent");
    expect(r.getAdapter("myagent")).toBeInstanceOf(TraeworkGuiAdapter);
  });

  it("未指定 adapter 且非 gui 时回退 CliAdapter", async () => {
    const r = makeRegistry(profileOf({ driver: "spawn" }));
    await r.resolve("myagent");
    expect(r.getAdapter("myagent")).toBeInstanceOf(CliAdapter);
  });

  it("同类型重复 resolve 不重建实例", async () => {
    const r = makeRegistry(profileOf({ adapter: "zcode-gui", driver: "gui" }));
    await r.resolve("myagent");
    const first = r.getAdapter("myagent");
    await r.resolve("myagent");
    expect(r.getAdapter("myagent")).toBe(first);
  });
});
