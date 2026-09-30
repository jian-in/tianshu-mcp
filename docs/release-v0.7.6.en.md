# v0.7.6 — ZCode binding deadlock, CDP reconnect entry point, and reasoning tiers

> See the [CHANGELOG](../CHANGELOG.en.md#076---2026-09-30) for details.

## Background

Issue #27 reported three classes of ZCode defects that stall tasks: **split project-collection channels
causing a binding deadlock**, **CDP disconnects treated as hard failures with no recovery entry point**,
and **`reasoningLevel` never implemented plus a flaky two-level model menu**.

This release reproduces, diagnoses and fixes all three on real ZCode `3.14.3.7762` (Windows 10), and
runs the full dispatch chain end to end on the real machine (project binding → model switch →
permission confirm → send → poll to terminal state → artifact on disk).

## Changes

### 1. Split project-collection channels (the real root cause of the deadlock)

On `3.14.3` the `[data-testid^="workspace-item-"]` nodes are **not gone from the DOM** — measured on the
real machine, **40 of 42 nodes are invisible** (`getBoundingClientRect().top` starts at 720 while the
viewport is only 640 high, i.e. scrolled out of view).

The old implementation collected `projectItem` with no visibility filter at all:

1. Ghost entries entered the list → `out.length > 0` → the `if (!out.length)` short-circuit was
   permanently false → **the only trustworthy channel (the dropdown menu) never ran**;
2. `matchZcodeProject` matched a ghost entry via its testid-derived path → the working **auto-import
   branch was skipped**;
3. Clicking the ghost entry had no effect → all bounded retries failed → `project_mismatch`, and the
   task text was never delivered.

Fix: `projects()` now filters the legacy channel by **visibility**, **always merges both channels**,
and lets same-named menu items override sidebar entries (only the menu's `aria-checked` is binding
evidence rendered by ZCode itself).

### 2. Fall back to import when clicks never land

`clickProject` now reports a distinguishable reason (`trigger-unavailable` / `not-found` /
`not-visible`). When the target is listed but **not a single click ever landed**, the adapter falls
back to the `selectZcodeFolder` import path instead of declaring `project_mismatch`; it stays
fail-closed when `allowCreateProject=false`.

### 3. A recovery entry point for runtime CDP disconnects

The reported incident was "the agent kept writing artifacts after MCP had already failed the task" —
a single `Runtime.evaluate` timeout or endpoint hiccup does not mean CDP is dead. The send phase and
the runtime loop now share one guard:

- the first disconnect reconnects **once, for observation only** (matching the existing `codex` /
  `qoder` pattern — **the task is never resent**);
- a failed reconnect or a second disconnect lands on `needs_user(setup_recovery)` (a recoverable
  exit, not the `needs_attention` dead end) with both facts attached: **whether the process is still
  alive** (distinguishing "exited" from "endpoint not responding") and **whether the window still
  shows running signals**.

### 4. `reasoningLevel` and the two-level model menu

- The tier set **varies per model**, so it is read from the UI **after the model is confirmed** and
  then validated: out-of-range tiers and unreadable tier sets are rejected **before sending**
  (`reasoning_level_invalid`) instead of silently reusing the current value; omitting the tier never
  touches the UI. Real-machine contract: `chat-thought-level-select-trigger` (combobox) +
  `chat-thought-level-select-item-{enabled,disabled}` (binary on/off, mounted only while the menu is
  open).
- **Root cause of the flaky two-level model menu**: model items live in the provider group's
  **second-level submenu**, which renders only on **hover** — clicking selects the group itself or
  collapses the menu. The provider group testid has also drifted to
  `chat-model-select-group-registry-provider:`. Group expansion now uses hover, and when two rounds
  both yield an empty candidate list the menu is reopened for one more round instead of declaring
  `model_unavailable`.

### 5. Permission-menu contract drift (same class of defect, surfaced by the real-machine run)

On `3.14.3` the permission items use `menuitemradio` / `menuitemcheckbox` (**not** `option`), and the
visible name lives in the item's **direct text node**, followed by an explanatory sentence
(e.g. "Full access — fewer confirmations."). Both mismatched the old implementation and stalled
dispatch at `permission_unknown`. The selector now carries a role-agnostic fallback, and
`clickExact` resolves labels from direct text nodes first.

## Real-machine verification

| Area | Command | Result |
|---|---|---|
| Project-collection contract | `npm run probe:zcode -- dom-contracts` | `workspaceItems=42` (2 visible / 40 invisible), `dataProjectPath=0`; with the menu open `projects()` returns the menu items with correct checked state |
| Model / permission menus | `npm run probe:zcode -- models` / `permission` | provider group testid `chat-model-select-group-registry-provider:new-provider`; permission item role/text structure as described above |
| Reasoning tiers | one-off probe | `current=on`, `tiers=Off/On` |
| End-to-end dispatch | `npm run smoke:zcode` | `succeeded` / `reply_stable` / `permissionMode=完全访问`, ~40 s; **artifact `done.txt` contains `issue27-ok`** |

## Upgrade notes

- When dispatching ZCode tasks, a `reasoningLevel` that is not in **that model's** UI tier set now
  fails before sending (previously it silently reused the current tier).
- `continue_task` now treats a runtime CDP disconnect as "wait for the user, then keep observing the
  original task" rather than "the task has failed" — a failure verdict no longer means the agent has
  stopped; judge by the live window.
