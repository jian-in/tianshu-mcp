import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RunTaskParamsSchema } from "../../src/config/schema.js";

/**
 * MiniMax Code 参数面（`contextWindow`）。
 *
 * 校验点（与 handlers.ts 的拒绝矩阵一一对应）：
 * 1. schema 接受 `contextWindow`（string）；
 * 2. 其他 agent 的专用参数（`designDirection`/`mode`）与 minimax 的并存不会互相吞掉；
 * 3. `contextWindow` 取值刻意宽松（候选值随模型变化）——合法性留给运行期读界面候选校验。
 *
 * 拒绝矩阵本身跑在 handlers 层（需要 MCP 会话），见 test/integration/minimax-flow.test.ts。
 */
describe("MiniMax Code 参数面", () => {
  it("RunTaskParamsSchema 接受 contextWindow（512K / 1M 等界面候选文本）", () => {
    const parsed = RunTaskParamsSchema.parse({
      task: "改点东西",
      agentId: "minimax",
      contextWindow: "1M",
    });
    expect(parsed.contextWindow).toBe("1M");
  });

  it("contextWindow 省略时为 undefined（不影响既有调用）", () => {
    const parsed = RunTaskParamsSchema.parse({ task: "改点东西", agentId: "minimax" });
    expect(parsed.contextWindow).toBeUndefined();
  });

  it("contextWindow 不接受空串（min(1)）", () => {
    expect(
      RunTaskParamsSchema.safeParse({ task: "t", agentId: "minimax", contextWindow: "" }).success,
    ).toBe(false);
  });

  it("取值不做枚举约束：非 512K/1M 的文本在参数层通过（合法性由界面候选在运行期判定）", () => {
    // 候选值随模型变化，硬编码枚举会把合法值拒之门外——这是刻意的设计决策。
    const parsed = RunTaskParamsSchema.safeParse({
      task: "t",
      agentId: "minimax",
      contextWindow: "256K",
    });
    expect(parsed.success).toBe(true);
  });

  it("contextWindow 与 designDirection/mode 互不干扰（三个专用参数各自可选）", () => {
    const schema = RunTaskParamsSchema as unknown as z.ZodObject<z.ZodRawShape>;
    expect(schema.shape.contextWindow).toBeDefined();
    expect(schema.shape.designDirection).toBeDefined();
    expect(schema.shape.mode).toBeDefined();
  });
});
