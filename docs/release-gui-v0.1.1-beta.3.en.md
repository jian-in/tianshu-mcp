# Logs 0.1.1-beta.3 — Baseline / Stage gantt / Disk usage / Deep links

> Full change history: [CHANGELOG](../CHANGELOG.en.md). Feature documentation: [docs/gui-log-viewer.en.md](gui-log-viewer.en.md).

This is the **third and final pre-release on the 0.1.1 line**, delivering batch three of the "insights" plan:
**A5 baseline drift, A6 stage gantt, A9 artifact disk usage and A8b deep link `tianshu://task/<id>`**. The first three
remain read-only enhancements; A8b is the only item that needs **new Tauri plugins and protocol registration** in this
round (with a documented fallback).

---

## What's new

### A5 A new "Baseline" section in the workspace

- Shows the summary of the `baseline.json` captured at dispatch: repository or not / HEAD (short hash) / whether the tree
  was already dirty / pre-existing change count / untracked count / capture time and message;
- **Compared against the latest report**: the report's actual changes (file count, `+N / -M`) sit next to the baseline's
  pre-existing changes, so out-of-scope edits are easy to spot;
- **No baseline means saying so**: a missing or broken file always renders "this task has no saved pre-work baseline" —
  **no zero values are invented**.

### A6 A new "Stages" view for the event stream (state-transition gantt)

- The event-stream toolbar gains a **List / Stages** segmented control: List stays the original tail window (friendly to
  huge files), while Stages reads **one full pass** of `task.jsonl` on demand;
- A stage spans **two adjacent state transitions** (`created → started → verify_start → fix_start → … → succeeded/failed`),
  and bar widths are proportional to each stage's share of the total (plain divs, no chart library);
- The last stage has no end time and is marked **"running" with a hatched bar** — **no invented durations**;
- If even the full read does not start at `created` (truncated file), the UI **says so** instead of showing an
  incomplete timeline silently;
- `full` defaults to `false`: the List view behaves **exactly as before** (no regression).

### A9 A new "Disk usage" section on the Insights page

- Totals for task artifacts / `logs/` and its share / median task size / a TOP-20 table (with the "heaviest file" per task
  and its share of that task);
- **"Cleanup" hints**: every rule is **relative** (one file taking **> 50%** of its task, or a task at least
  **2x the median task size**); both ratios are **named constants** at the top of `core/insights.ts`, never scattered
  through components and never hard-coded absolute byte thresholds;
- **Statistics only, never deletion**: this page and its backend command expose **no delete or cleanup entry**; they only
  `stat` files and never read contents;
- Convention note: disk usage is measured over the **actual directories** (`logs/` plus **every** subdirectory of
  `tasks/`) with **no `tsk_` / `vfy_` prefix filter** — deliberately different from the task-list scan, because filtering
  by prefix would under-report real disk usage. The UI states this.

### A8b Deep link `tianshu://task/<taskId>`

- **Both cold and hot start work**: a URL arriving via launch arguments or via an already-running instance is queued on
  the Rust side, which emits a `gui://deeplink` signal; the frontend **drains the queue** and routes it (on cold start the
  event fires before the frontend listener exists, so **the queue is the source of truth** and no link is lost);
- **Single instance**: a second launch no longer opens a second window — it **reveals the existing window** and hands the
  URL to the first instance (`single-instance` plugin with its `deep-link` feature, which forwards URL arguments);
- **Protocol registration**: the `tianshu` handler is registered at startup, and **a failed registration never blocks
  startup** (macOS returns `UnsupportedPlatform`, which is expected);
- **Parsing lives in a pure function**: only `tianshu://task/<id>` is accepted, and the task id must match
  `[A-Za-z0-9_-]` (a deep link is external input and the id ends up in a file path). Anything containing `..` or `%2e`
  is **rejected outright** — URL normalisation erases `..`, so after normalisation there is no way to tell what the
  original was; rather than silently guessing a different id, the link is reported as unrecognised. Unrecognised links
  produce an **honest UI notice** instead of being dropped silently.
- **Minimal permissions**: deep links are handled **entirely in Rust**; the frontend never calls the
  `@tauri-apps/plugin-deep-link` JS API, so `capabilities/default.json` **does not gain `deep-link:default`** — the
  webview is granted no extra plugin capability.
- **Fallback plan**: if cold-start routing turns out not to work on some platform, the hot path (`on_open_url`) stays and
  the platform difference is documented honestly in `docs/gui-log-viewer.md`; nothing else in this batch is affected.

---

## Reading the numbers

- **Baseline / disk / full events are all read-only**: no business data is written; the two new Rust commands only read
  files and `stat` them.
- **Missing data is left blank honestly**: no baseline shows "no baseline", an unreadable report shows as unavailable,
  and unparsable times show `—` — **nothing is invented**.
- **The gantt does not normalise**: the stage total is simply the sum of parseable stages; a stage without a duration is
  shown as "running" and excluded from the total.

---

## Scope (what this batch does not include)

- All three batches (A1–A9) are now delivered; after this release the `0.1.1` line may be promoted to `0.1.1` whenever
  the maintainer decides;
- No **write operations** of any kind: no cleanup or delete entry, no task resume or rework;
- No notifications / tray badges, no local full-text index, and no live watching of insights data (existing decisions).

---

## Upgrade notes

- It shares the same `latest.json` / `latest-gitee.json` feed with `0.1.0`, `0.1.1-beta.1` and `0.1.1-beta.2` and
  compares semantic versions, so `0.1.1-beta.3 > 0.1.1-beta.2` — upgrading from any earlier version works;
- This release **adds** a workspace section, an event-stream view switch, an insights section and a deep-link entry point;
  everything existing (task list / four log types / search and export / update check / the previous three insights
  sections / command palette) behaves exactly as before.
