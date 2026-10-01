# v0.7.7 — 阻塞等待原语 `wait_task` / `wait_any`

> 详见 [CHANGELOG](../CHANGELOG.md#077---2026-10-01)。

## 背景

issue #28 是功能请求（P6）：`run_task` 异步返回 `taskId` 后，**调用方没有任何方式等到任务结束**——
当前唯一手段是反复调 `query_task`，而目标调用方（天枢桌面端的 agent 会话）**回合驱动**：
agent 只在收到用户消息的回合内执行、回合之间不运行，**无法自行轮询**。
稳定现象是「每次任务完成都必须人工发一条消息触发查询」。

成因链：① `run_task` 秒回 `taskId` 是对宿主约束的正确适配；② 宿主 MCP 工具**只回文本**、**按次同步**调用
`tools/call`、**不依赖服务端推送**（README「运行时契约」C1/C2），因此「等」这个动作只能由**一次工具调用**承载；
③ 原工具面无任何 wait / watch / subscribe 原语。结论：需要**新增阻塞等待原语**，且这是工具面唯一可行的形态。

## 改动

### 1. 停点定义（关键决策）

`wait_task` 等待的「可返回点」是**停点**，单一判定点 `isWaitSettled`（`src/tasks/task.ts`）：

```text
isWaitSettled(status) = isTerminal(status) || status === "needs_user"
```

`needs_user` **必须**也是停点：任务真正停止推进的时刻 = 调用方应当被唤醒的时刻。若不等它，
任务进 `needs_user` 后 wait 会一直空等到 timeout，调用方**在超时前对「任务在等人」一无所知**——
而这恰是需要立刻转达用户的状态。这与 webhook 通知（issue #22）对 `needs_user` 单独分类的决策一致。

### 2. 等待核心与接线

- `src/tasks/wait.ts`：`waitForStops(taskIds, getMeta, {timeoutMs, pollIntervalMs=500, signal})`——
  **纯逻辑、依赖注入 `getMeta`**，不触文件系统 / TaskManager 构造，可独立单测；轮询 500ms、`signal` 感知、返回 `{stopped, timedOut, waitedMs, missing, aborted}`。
- `TaskManager.waitForStops`：只做接线（注入 `(id) => this.getMeta(id)`，复用 `waitForStatusWrite` 屏障 + 内存优先 + 快照兜底），
  因此 wait 看到的是与 `query_task` **同一口径**的事实。
- `src/config/schema.ts`：常量 `WAIT_TASK_TIMEOUT_DEFAULT_MS(50_000)` / `WAIT_TASK_TIMEOUT_MAX_MS(600_000)` / `WAIT_ANY_TASK_IDS_MAX(20)`；
  `WaitTaskParamsSchema` / `WaitAnyParamsSchema`；`clampWaitTimeout()`。

### 3. 超时策略（面向「客户端超时未知」的三重缓解）

1. **默认值与上限 + 如实钳制**：`timeoutMs` 缺省 `50000ms`（低于生态常见 60s 客户端超时，留 10s 序列化/往返余量）；
   显式上限 `600000ms`；显式超上限的值**钳制并在响应正文写明「已钳制到上限」**，不静默改值。
2. **超时返回体引导循环**：未到停点时正文明确给出「请再次调用 `wait_task` 继续等待」的可执行指引（每轮 ≈50s，长任务靠多次调用）。
3. **等待无损保证**：`wait_task` / `wait_any` 是**纯只读**操作——不写任务状态、不动任务本体；被截断 / 中断 / 超时都**不影响任务继续执行**。

### 4. 工具面与 MCP 接线

- `TOOL_DEFS` **11 → 13**：`wait_task` / `wait_any` 归 `read` 族（`capability: "read"`、`requireApproval: false`、`readOnlyHint: true`）。
- `handlers.ts`：新增 `waitTaskHandler` / `waitAnyHandler`；`Handler` 类型扩为 `(args, extra?) => Promise<ToolResult>`
  （**仅 wait 使用 `extra.signal`**，其余 11 个 handler 零改动）。
- `server.ts`：`registerTool` 回调把 SDK 的 `extra` 透传给 handler；`instructions` 补一句 wait 用法。
- `formatter.ts`：`MetaBlockFields` + `waitSettled?` / `waitedMs?`。

### 5. `wait_any` 返回语义

按 `taskIds` **数组顺序**返回首个处于停点的任务（确定性优先，不做 `finishedAt` 排序）；
入口**预检全部 id**，缺一即 fail-closed 报错并列出缺失 id；正文另列出全部任务当前状态行。

## 验证

| 项目 | 命令 | 结果 |
|---|---|---|
| SDK 请求并发（物理前提） | 一次性探针 | 3s `slow` 发出后 +200ms 的 `fast` 仅 **215ms** 返回 → 请求互不阻塞；等待期间 `cancel_task`/`query_task` 照常 |
| 等待核心单测 | `npx vitest run test/unit/wait-task.test.ts` | **8 passed**（停点 / 跃迁 / 超时 / `signal` 中止 / 缺失 / 钳制披露） |
| 端到端集成 | `npx vitest run test/integration/wait-task.test.ts` | **6 passed**（真实 stub 长任务、短超时续等、不存在报错、等待中 `cancel_task` 即时生效、`wait_any` 先停者、缺一即报错） |
| 协议工具面 | `npx vitest run test/protocol/protocol.test.ts` | **11 passed**（13 工具真值表 / 注解） |
| 类型与风格 | `npm run typecheck && npm run lint` | exit 0 |
| 全量回归 | `npm test` | **1447 passed / 12 skipped**（1459 项，122 文件） |

## 用法

```text
run_task(...) → taskId
wait_task(taskId, timeoutMs=50000)          # 一回合内等到停点
  ├─ 成功 → get_task_report(taskId)
  ├─ needs_user → continue_task 后再次 wait_task
  └─ 超时 → 再次 wait_task 继续等待（无损）
```

多任务并行等待用 `wait_any(taskIds=[...])`。详见 [等待原语](docs/wait-task.md)。

## 升级建议

- 回合驱动调用方（天枢 agent 会话）可在 `run_task` 后**直接 `wait_task`**，无需人工再发消息触发查询；
  仍可用 `query_task` 看进度细节。
- 若你的客户端单次 `tools/call` 超时短于 50s，把 `timeoutMs` 调到略低于该超时（例如 30s 客户端用 20000ms）——
  即便被截断也无害，调用方再次调用即可续等。
- 新增的 `wait_task` / `wait_any` 是**只读、免审批**工具；宿主原有对写工具的审批策略不受影响。
