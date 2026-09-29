# v0.7.5 — Qoder CN 0.4.2/0.4.3 support and verify-engine cwd normalisation

> See the [CHANGELOG](../CHANGELOG.en.md#075---2026-09-29) for details.

## Background

Qoder CN's UI contracts changed twice in a row (`0.4.2` / `0.4.3`), breaking the `qoder` adapter in two
scenarios:

- **New conversation**: stuck at the "bind workspace" stage with `qoder_stage_timeout: workspace-menu`
  (the dropdown never opens).
- **Resumed conversation** (`continue_task` / automatic repair): `qoder_workspace_mismatch: expected=..., actual=`
  (the bound-workspace read-back is empty).

Both symptoms sit in the first half of the dispatch chain, so the task brief is never delivered and
`autoFixRounds` has nothing to work with.

## Changes

### 1. Workspace-picker candidate order (0.4.3)

In `0.4.3` the composer picker drops the `aria-label` "切换或清空当前工作区…"; with the primary matching nothing,
resolution fell through to the broad fallback `button[aria-expanded][aria-label*="工作区"]` — which matches the
**sidebar "Workspace" section header** (`aria-label` exactly "工作区", `aria-expanded="true"`). Clicking it opens
no dropdown, hence the timeout.

Fix: the stable marker `[data-workspace-picker-trigger]` is now ordered before the broad heuristic (on `0.4.3` it
matches uniquely and opens the menu).

### 2. "Menu is open" check narrowed

The old check was "search box **or** any `[role=menu][data-state=open]` overlay"; the generic term could be
matched by an unrelated overlay and **pass falsely**, with the missing search box discovered only afterwards.
It is now narrowed to the **search box alone** (`workspaceSearch`); a click that lands on nothing is briefly
rechecked and retried once, and only after both attempts fail is the stage reported as failed.

### 3. Bound-workspace read-back (0.4.3)

Up to `0.4.2` the path sits on `[data-conversation-workspace][title]`; in `0.4.3` that container has **no
`title`** and the path is on an inner `aria-label`. Fix: the container side lists all candidates and falls back
to `aria-label`/text, while the **picker side still reads `title` only** — its `aria-label` is the prompt, not a
path.

### 4. Model selector chain (0.4.2)

In `0.4.2` the model menu drops the "default/custom" group tabs; candidates become a **flat list** and the model
name moves from `aria-label` to the trigger text. As part of the adaptation, `QoderCdpClient` gains
`resolveKey()` / `textKey()` for callers that must splice the selector into a compound query — they return the
**first matching candidate** (using `selector()` alone would take only the primary and make the extra candidates
useless).

### 5. Verify-engine cwd drive-letter normalisation (Windows)

A project path may be registered with a lowercase drive letter (e.g. `e:/proj` in `projects.json`), and
vite/vitest key their module graph and cache by **path string**: `e:\proj` and `E:\proj` count as two locations,
the same module appears twice, and collection crashes. `runVerifyCommand` now normalises the cwd with
`fs.realpathSync.native` before spawning; when the path cannot be resolved it falls back to the original value,
so normalisation never blocks acceptance.

## Thanks

Thanks to **@jian-in** (Bofei Jian) for the Qoder CN 0.4.2/0.4.3 adaptation in
[PR #26](https://github.com/lanlan0811/tianshu-mcp/pull/26) — the hardware probe data, the failure-chain
diagnosis and the accompanying regression tests all come from that PR.

## Verification

- **RED → GREEN (decisive evidence)**: running this release's new Qoder regression cases against the baseline
  source (`e59d10c`) yields **4 failed / 18 passed**; the same group is fully green after the fix — the cases
  really do lock the defect in, they are not tautological assertions.
- **Full suite**: `421 suites / 1396 passed / 0 failed` (12 skipped); `typecheck` / `lint` / `build` /
  `check:stdio` (8 scenarios) all pass; the worktree is clean after build.
- **CI**: the target commit's `CI` workflow is 22/22 green across ubuntu / macos / windows and Node 20/22/24.
- **Not covered**: the `0.4.2`/`0.4.3` selector conclusions come from the hardware record in PR #26; this
  machine has no Qoder CN environment, so no hardware re-verification was done. Pure unit tests can only lock
  the query contract (the test substitute does not parse a real DOM).

## Upgrade notes

Upgrading from `0.7.4` is non-breaking. Existing `0.3.4` behaviour is unchanged; Qoder CN `0.4.2`/`0.4.3` goes
from "stuck at workspace binding" to usable.
