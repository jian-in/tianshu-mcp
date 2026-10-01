# Tianshu-mcp Logs 0.1.1-beta.1 — Insights (scoreboard / attribution / trend)

> Full change history: [CHANGELOG](../CHANGELOG.en.md). Feature documentation: [docs/gui-log-viewer.en.md](gui-log-viewer.en.md).

This is the **first pre-release on the 0.1.1 line**. It ships the first three pieces of the "insights" work:
**A1 scoreboard, A2 failure attribution, A3 time trend**, plus a new **read-only** aggregation data path for them.

---

## What's new

### A new "Insights" entry in the sidebar

The main navigation gains an **Insights** full page right after "Tasks" (the shell `view` grows from three states to four).
The page has three sections, switched with a segmented control:

| Section | Contents |
|---|---|
| Scoreboard | Two tables — **by agent** and **by project**: tasks / success rate / avg rounds / one-pass rate / avg verify time / missing reports |
| Attribution | Top lists for four kinds of attribution (error type `errorType`, failed check `failedCheck`, blocking issue `blockingIssue`, code signal `signal`) with share bars |
| Trend | **By day / by week** toggle; task-count bars plus success-rate and rework-rate lines (plain inline SVG, no chart library) |

The page loads once when opened, has a Refresh button, and reloads automatically when the data home changes;
it does **no live watching** (decoupled from the file watcher, so it never holds a persistent IO handle).

### A new read-only aggregation command, `get_insights`

The Tauri side gains `insights.rs` (aggregation) and `timestamps.rs` (a minimal UTC timestamp parser). The
`get_insights` command scans `tasks/*/task.json` and each task's **latest** `report-*.json` in one pass and only
does **counting and summing**; rates, TopN, trend gap-filling and week bucketing all happen in the frontend's
pure functions (`core/insights.ts`), so time-zone and presentation logic never leaks into Rust.

The scan uses **exactly the same rule** as the task list: only `tasks/tsk_*` and `tasks/vfy_*` are considered.

---

## Reading the numbers (please read before interpreting)

- **Dates are bucketed by UTC**: the day bucket takes the first 10 characters of `createdAt` (a UTC date).
  The UI states this explicitly — no guessing at a local time zone.
- **Weeks start on Monday** (ISO-8601); the same week spanning a month or year boundary is merged into one bucket.
- **"One pass" = succeeded in exactly 1 round** (`succeeded` and `roundsUsed <= 1`).
- **"Rework rate" = tasks with `roundsUsed > 1` in that bucket / all tasks in that bucket**.
- **Only each task's latest report round is counted** (the snapshot's `reportRound`, else the highest
  `report-<round>.json` present). So for a task that failed once and then succeeded, the **earlier failure does
  not enter the attribution aggregation** — that is intentional.
- **Average verify time** counts only rounds whose `startedAt` / `finishedAt` both parse; unparsable reports are
  excluded from the denominator — **no invented times**.
- **A zero denominator always shows `—`**, never 0%.
- **Read-only**: this page and its backend command **write no business data** and offer no delete / cleanup entry;
  reports that fail to parse are reported honestly as "N unparsable".

---

## Scope (what this batch does not include)

The work ships in three batches; this release contains **the first batch only**:

| Feature | Batch |
|---|---|
| A4 multi-task compare, A7 richer filtering, A8a command palette | `0.1.1-beta.2` |
| A5 baseline drift, A6 transition Gantt, A9 disk usage, A8b deep link `tianshu://task/<id>` | `0.1.1-beta.3` |

---

## Upgrade notes

- This release **only adds a read-only view and a read-only command**; nothing existing changes. The task list,
  event stream, raw logs, reports, search / export and update check all behave exactly as before.
- It shares the same `latest.json` / `latest-gitee.json` feed with 0.1.0 and compares semantic versions, so
  `0.1.1-beta.1 > 0.1.0` — upgrading straight from the stable release to this pre-release is a supported path.
