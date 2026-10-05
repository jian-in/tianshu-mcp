# v0.7.8 — Seventh GUI agent: the MiniMax Code adapter

> See the [CHANGELOG](../CHANGELOG.en.md#078---2026-10-06).

## Background

tianshu-mcp exists to "have an external AI agent do the development, then auto-verify and rework on failure", and every agent integration is a GUI adapter. This release adds the **seventh**: MiniMax Code (`agentId=minimax`), alongside the existing traework / zcode / codex / kimicode / qoder / opendesign.

The deliverable is **a plan plus code plus a real-machine loop on this machine** — not merely "the code is written and the unit tests are green". A GUI adapter's correctness can only be proven on the real app.

## Changes

### 1. Real-machine evidence corrected three structural assumptions (the most valuable part of this release)

The assumptions came from the product's frontend artifacts and static reading; **live DOM probing disproved three of them**, and each would have produced "looks correct, fails on the real machine":

| # | Original assumption | Measured reality | Consequence if uncorrected |
|---|---|---|---|
| 1 | Reasoning level / context window are flat `role="group"` elements | **Only rendered after hovering a model row with `aria-haspopup="menu"`** (a second `role="menu"` appears) | The tier set can never be read → the adapter reports "unsupported by the UI" when in fact it never expanded the submenu |
| 2 | Tier/window sets are the same across models | **They vary per model**: M3.1 has six tiers + windows / M3 has windows only / deepseek has three tiers / M2.7* has no submenu | On a submenu-less model the adapter would silently keep the current tier, so the user believes a tier was set when it was not |
| 3 | "New project" directly opens the native folder dialog | **Two steps**: an in-app HTML modal opens first; clicking "Choose folder" inside it opens the native `Select Directory`; after confirming, the modal still needs its own "Create project" submit | The native dialog never appears, and it gets misread as a broken selector |

There is also a subtle trap: **the second-level submenu container is reused**. Moving straight into the next model row without first moving the pointer away does not fire `mouseenter`, so the DOM **keeps the previous model's tier set** — picking from it selects another model's tiers. The adapter therefore scopes candidate reads to the owning model via `aria-label`, and moves the pointer away before hovering in.

### 2. Fail-closed boundaries (never silently degrade)

- Requesting `reasoningLevel` / `contextWindow` on a model with **no submenu** → **error before sending**; the UI's current value is never silently kept;
- Target value absent from the UI candidates → error listing the actual candidates;
- Tier set unreadable (submenu not expanded / selector drift) → **refuses to guess**; no built-in fallback list;
- Everything is **read back** after selection (the reasoning level from the trigger's second line, the context window from `aria-checked`); a mismatch fails.

### 3. Read-only diagnostic probe

`npm run probe:minimax` reproduces every conclusion above: install discovery, processes and CDP topology, model and **submenu candidates (hover only, no clicks, changes no state)**, project groups, run-signal snapshot and native-dialog enumeration.

## Real-machine loop (the core criterion of this release)

The sandbox `D:\Trae项目\MiniMax-Test` **keeps one deliberately failing test** (`add(-2,-3)` returns `5` instead of `-5`), which proves that verification really fails, rework really edits, and the edit really passes — rather than running through empty.

- **Dispatch**: `agentId=minimax` / `model=M3.1-Flash-Preview` / `reasoningLevel=low` / `contextWindow=512K`
- **Result**: `ok=true`, `endReason=reply_stable`, with the `stop_button` run signal recorded in the log
- **Independent re-verification** (not through the adapter):
  - `cd /d/Trae项目/MiniMax-Test && node --test` → `tests 4 / pass 4 / fail 0`
  - `git diff --stat` → `src/calc.mjs | 6 ------` (the agent really edited the source)

Every stage of the chain was observed during that run: discovery (fixed-drive hit) → takeover (reusing the existing CDP instance) → main window and composer ready → create session → bind project (two steps) → select model/tier/window (second-level submenu) → type → send → poll (measured `stop_button`) → terminal `reply_stable`.

## Tests

- Added `test/unit/minimax-*` (6 files, **121 cases**).
- **Added a new class of "in-page expression sandbox executability" test**: every in-page expression is executed through `node:vm` and asserted not to raise `is not defined`. Expressions are string-assembled and injected into the page, so a missing helper is invisible to both `tsc` and ordinary unit tests and only blows up on the real machine — this already happened twice, and this test class is the only thing that stops it early.
- Full suite **126 files passed / 3 skipped / 0 failed**; typecheck / lint / build / strict stdio all green.

## Known limitations

| Item | Status |
|---|---|
| macOS | `research` (native folder dialog is fail-closed; dispatch refused) |
| `stop-button` post-send state | Extracted from the product artifact, not re-sampled after sending; when missing, the three signals degrade automatically (affects convergence speed, not correctness) |
| Question detection | No measured sample (account quota prevented producing a question flow); off by default, conservative heuristic |
| Automatic permission-mode switching | The permission menu candidates are not sampled, so the adapter only reads back and compares instead of switching |
| Version gate | None (no version file; the version is only readable from the CDP UA); drift is caught by `selector_drift`, which fails diagnosably |

## Docs

- Added the bilingual [MiniMax Code adapter](minimax-cdp.en.md) doc (structure, selectors, fail-closed boundaries, resume semantics, known limitations)
- Added `docs/minimax-evidence/` (main-window testid list, popup artifact structure, real-machine loop transcript)
- Both READMEs gained a navigation row
