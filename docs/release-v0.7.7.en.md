# v0.7.7 — Blocking wait primitives `wait_task` / `wait_any`

> See the [CHANGELOG](../CHANGELOG.en.md#077---2026-10-01).

## Background

Issue #28 is a feature request (P6): after `run_task` returns a `taskId` asynchronously, **the caller has no way to wait for the task to finish** — the only means is to keep calling `query_task`, and the intended caller (a Tianshu desktop agent session) is **turn-driven**: the agent runs only within the turn that received a user message and does nothing between turns, so it **cannot poll on its own**. The stable symptom was "every task completion requires a human to send a message to trigger a check".

Cause chain: ① `run_task` returning a `taskId` immediately is the right adaptation to the host's constraints; ② the host MCP tools **return text only**, call `tools/call` **synchronously per call**, and **do not rely on server-side push** (README "Runtime contract" C1/C2), so "waiting" can only be carried by **a single tool call**; ③ the original tool surface had no wait / watch / subscribe primitive. Conclusion: a **new blocking wait primitive** is needed, and it is the only viable shape on the tool surface.

## Changes

### 1. Stop-point definition (key decision)

The "returnable point" that `wait_task` waits for is a **stop point**, via the single decision point `isWaitSettled` (`src/tasks/task.ts`):

```text
isWaitSettled(status) = isTerminal(status) || status === "needs_user"
```

`needs_user` **must** also be a stop point: the moment a task truly stops making progress is the moment to wake the caller. Without waiting for it, once a task enters `needs_user` the wait would block until the timeout and the caller would **know nothing about "the task is waiting for a person"** — yet that is exactly the status that must be relayed immediately. This matches the webhook notification (issue #22) decision to classify `needs_user` separately.

### 2. Wait core and wiring

- `src/tasks/wait.ts`: `waitForStops(taskIds, getMeta, {timeoutMs, pollIntervalMs=500, signal})` — **pure logic with dependency-injected `getMeta`**, touching neither the filesystem nor TaskManager construction, so it is independently unit-testable; polls every 500 ms, is `signal`-aware, and returns `{stopped, timedOut, waitedMs, missing, aborted}`.
- `TaskManager.waitForStops`: only wires it (injects `(id) => this.getMeta(id)`, reusing the `waitForStatusWrite` barrier + memory-first + snapshot fallback), so the wait sees the **same facts** as `query_task`.
- `src/config/schema.ts`: constants `WAIT_TASK_TIMEOUT_DEFAULT_MS(50_000)` / `WAIT_TASK_TIMEOUT_MAX_MS(600_000)` / `WAIT_ANY_TASK_IDS_MAX(20)`; `WaitTaskParamsSchema` / `WaitAnyParamsSchema`; `clampWaitTimeout()`.

### 3. Timeout policy (three mitigations for an unknown client timeout)

1. **Default and cap + honest clamping**: `timeoutMs` defaults to `50000ms` (below the common 60 s client timeout, leaving ~10 s serialization/round-trip headroom) with an explicit cap of `600000ms`; values above the cap are **clamped and the response body states "clamped to the cap"**, never silently rewritten.
2. **Timed-out response steers a loop**: when no stop point is reached, the body gives the executable guidance "please call `wait_task` again to keep waiting" (≈50 s per round; long tasks need several calls).
3. **Lossless guarantee**: `wait_task` / `wait_any` are **pure read-only** — they write no task state and touch no task body; a truncation / interruption / timeout **never affects the task's continued execution**.

### 4. Tool surface and MCP wiring

- `TOOL_DEFS` **11 → 13**: `wait_task` / `wait_any` join the `read` family (`capability: "read"`, `requireApproval: false`, `readOnlyHint: true`).
- `handlers.ts`: added `waitTaskHandler` / `waitAnyHandler`; the `Handler` type widens to `(args, extra?) => Promise<ToolResult>` (**only the wait tools use `extra.signal`**; the other 11 handlers are unchanged).
- `server.ts`: the `registerTool` callback forwards the SDK `extra` to the handler; `instructions` gains a line about the wait usage.
- `formatter.ts`: `MetaBlockFields` + `waitSettled?` / `waitedMs?`.

### 5. `wait_any` return semantics

Returns the **first task in `taskIds` array order** that has reached a stop point (determinism first; no `finishedAt` sorting); the entry point **validates all ids up front**, failing closed with the missing ids listed if any is absent; the body also lists every task's current status.

## Verification

| Item | Command | Result |
|---|---|---|
| SDK request concurrency (physical premise) | one-off probe | a 3 s `slow` followed +200 ms later by `fast` returned `fast` in **215 ms** → requests do not block each other; `cancel_task`/`query_task` proceed during a wait |
| Wait-core unit tests | `npx vitest run test/unit/wait-task.test.ts` | **8 passed** (stop point / transition / timeout / `signal` abort / missing / clamp disclosure) |
| End-to-end integration | `npx vitest run test/integration/wait-task.test.ts` | **6 passed** (real stub long task, short-timeout continuation, not-found error, `cancel_task` effective during a wait, `wait_any` first settled, fail-closed on a missing id) |
| Protocol tool surface | `npx vitest run test/protocol/protocol.test.ts` | **11 passed** (13-tool truth table / annotations) |
| Types and lint | `npm run typecheck && npm run lint` | exit 0 |
| Full regression | `npm test` | **1447 passed / 12 skipped** (1459 tests, 122 files) |
| Real-machine simulation (built-artifact stdio server) | Start a real server from `dist/index.js` + a stub `sleep` long task | **5/5 passed**: ① `wait_task` reached a stop point (wall clock 6106 ms / status=succeeded / waitedMs=6101); ② a short timeout returned `waitSettled=false` (523 ms) and calling again continued to a stop point (4391 ms); ③ `wait_any` returned the first settled in array order; ④ `cancel_task` during a wait took effect in **57 ms** (not blocked); ⑤ a non-existent task errored |
| `check:stdio` | `npm run check:stdio` | **8/8 scenarios passed**, tool count **13** |

> **Verification boundary (disclosed honestly)**: the single `tools/call` timeout was **not** calibrated here on the Tianshu desktop (it is third-party client behaviour and cannot be reproduced locally) — the "real-machine simulation" row above ran the built-artifact stdio server with the official SDK client. If your client's single-tool timeout is shorter than 50 s, lower `timeoutMs` per "Upgrade notes" below; a truncation is harmless (the wait is lossless, and calling again continues).

## Usage

```text
run_task(...) → taskId
wait_task(taskId, timeoutMs=50000)          # wait for a stop point within the turn
  ├─ success → get_task_report(taskId)
  ├─ needs_user → continue_task then wait_task again
  └─ timeout → call wait_task again to keep waiting (lossless)
```

Use `wait_any(taskIds=[...])` to wait on several tasks in parallel. See [wait primitives](docs/wait-task.en.md).

## Upgrade notes

- Turn-driven callers (a Tianshu agent session) can now **call `wait_task` directly** after `run_task`, with no need for a human to send a message to trigger a check; `query_task` remains available for progress detail.
- If your client's single `tools/call` timeout is shorter than 50 s, set `timeoutMs` a little below it (for example 20000 ms on a 30 s client) — even if truncated it is harmless, as the caller simply calls again to continue.
- The new `wait_task` / `wait_any` are **read-only, approval-free** tools; a host's existing approval policy for write tools is unaffected.
