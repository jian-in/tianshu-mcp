# Logs 0.1.1-beta.2 — Structured filters / Multi-task compare / Command palette

> Full change history: [CHANGELOG](../CHANGELOG.en.md). Feature documentation: [docs/gui-log-viewer.en.md](gui-log-viewer.en.md).

This is the **second pre-release on the 0.1.1 line**: batch two of the "insights" plan — **A4 multi-task compare,
A7 richer structured filtering, A8a command palette and hotkeys**. All three are **frontend-led, read-only
enhancements**: no new Tauri plugin, no protocol registration change.

---

## What's new

### A7 Richer structured filtering (overview filter sheet)

The filter set grows from 7 to 11 conditions, with four new **structured** dimensions whose semantics map
**one-to-one onto task-snapshot fields**:

| New filter | Semantics |
|---|---|
| Error type `errorType` | Exact match on `task.errorType`; options come from the **facets** of the current task set (no hard-coded enum) |
| Dry run `dryRun` | Exact match on `task.dryRun` (tri-state: all / yes / no) |
| Reworked `reworked` | `yes` = `roundsUsed > 1`; `no` = `roundsUsed <= 1` (**a single round is not rework**) |
| Visual acceptance `hasVisual` | `yes` = a `report-<round>.html` artifact exists |

Rust's `TaskFilter` (`models.rs`) gains the same fields, and `matches_filter` in `scanner.rs` stays
**line-for-line identical in semantics** with the frontend's `filterTasks` in `core/filter.ts` (both were
changed; any drift is caught by unit tests plus the real-machine preview). Every new field is `#[serde(default)]`,
so existing callers that omit them keep working.

### A4 Multi-task compare (new "Compare tasks" section on the Insights page)

- **Left**: a task picker (reusing the existing task set plus keyword filtering) with a **4-task** limit;
  going past it shows an **explicit notice** and **never silently replaces** an existing pick.
- **Right**: a metric matrix — columns are tasks, rows are metrics: status / agent / project / rounds used /
  verify time / changed lines (+ / -) / files changed / latest verdict / failed checks / error type / message.
  The rounds and verify-time rows mark the **best value across tasks**.
- **Reports are read on demand**: only when a task is picked does the app read that task's latest
  `report-<round>.json` (preferring the snapshot's `reportRound`); results are cached per `taskId` and
  **never re-fetched**. Switching the data home clears both the selection and the cache.
- **Anything missing shows `—`**: without a report, verdict and diff stats stay empty and verify time falls back
  to the task snapshot's `createdAt → finishedAt`; if neither parses it is left blank — **no invented times, no
  invented winners**.

### A8a Command palette and hotkeys

- **`Ctrl/Cmd + K`** opens the palette (the sidebar also gains a permanent entry). Typing performs
  **subsequence fuzzy matching**; `↑` `↓` move, `Enter` runs, `Esc` closes; while it is open **no other global
  hotkey fires**.
- Every command reuses existing data and actions: Tasks / Insights / Server log / MCP Capabilities,
  cross-task global search, open Settings, **switch to a data home** (the active one is labelled), and
  **open a task directly** (capped at 50 entries so the list never grows unbounded).
- **`Ctrl/Cmd + R`** refreshes the task list (`preventDefault`ed so the webview never reloads); combinations with
  `Alt` / `Shift` are never intercepted (so `Ctrl+Shift+R` and similar stay untouched).

---

## Reading the numbers

- **Filters default to "all"**: every new condition is opt-in, and filtering happens both in the backend (desktop
  runtime) and in the frontend with **the same semantics**, so behaviour is identical under local mock preview.
- **Compare is read-only**: it writes no business data and only reads `task.json` / `report-*.json`; there is no
  delete or cleanup entry.
- **"Best" is only marked when comparable values exist**: if all values are missing, nothing is marked
  (no invented winners).
- **The palette adds no write operations**: every command navigates to an existing page or triggers an existing
  read-only action.

---

## Scope (what this batch does not include)

The work ships in three batches; this release contains **the second batch only**:

| Feature | Batch |
|---|---|
| A5 baseline drift, A6 transition Gantt, A9 disk usage, A8b deep link `tianshu://task/<id>` | `0.1.1-beta.3` |

---

## Upgrade notes

- This release **only adds read-only filters, a read-only comparison view and pure frontend interactions**;
  nothing existing changes. The task list, event stream, raw logs, reports, search / export, update check and the
  three existing Insights sections all behave exactly as before.
- It shares the same `latest.json` / `latest-gitee.json` feed with `0.1.0` and `0.1.1-beta.1` and compares
  semantic versions, so `0.1.1-beta.2 > 0.1.1-beta.1` — upgrading from any earlier version works.
