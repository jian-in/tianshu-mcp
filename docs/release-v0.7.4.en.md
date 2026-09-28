# v0.7.4 — ZCode 3.14.x project binding fix (issue #24)

> See the [CHANGELOG](../CHANGELOG.en.md#074---2026-09-28) for details.

## Background

issue #24 reported that on ZCode `3.14.x`, **every dispatch with a `projectPath`** fails with
`endReason: "project_mismatch"` — the project is genuinely imported, yet the binding re-check still fails and
the task brief is **never delivered to the agent**.

Because the failure happens before sending, `autoFixRounds` is inert (`roundsUsed` stays 0) and the user sees
only "project binding read-back does not match projectPath" with no way to recover. `projectPath` is one of
`run_task`'s two core parameters, so on 3.14.x **the entire project-scoped dispatch surface is unusable**.

## Root cause

ZCode 3.14.x removed the two DOM contracts tianshu-mcp relied on for **binding read-back**:

| Contract | 3.11.x | 3.14.x (measured in the issue) | Who depends on it |
|---|---|---|---|
| `data-project-path` | present | **0 hits** | `pathOf()` (`src/agents/zcode/dom.ts:27`) |
| `data-testid^="workspace-item-"` | present | **0 hits** | same, plus `cdp.projects()` (`src/agents/zcode/cdp.ts:279`) |

So `workspaceBinding().projectPath` was always empty and `projects()` always returned `[]`: the path-equality
criterion could never hold, and `ensureProjectBound()` spun its retry loop on `if (!item) continue` until the
budget ran out, ending in `project_mismatch`.

An additional blocker: even if the project list came from the menu instead, the old `matchZcodeProject()`
matched **only on `item.path`** (its name branch produced ambiguity but never an item), so fixing the data
source alone would still never be consumed.

## The fix

Four places, all stemming from that single root cause:

- **`selectors.ts`**: new `projectMenuItem` (`[role="menuitemcheckbox"]`); `projectItem` / `projectPath`
  are now explicitly labelled as 3.11.x contracts (gone in 3.14.x).
- **`dom.ts`**: `workspaceBindingExpression()` now also returns `projectName` (the bound display name) and
  `menuChecked` (display names of items with `aria-checked="true"`), treating multiple checked items as
  ambiguity. It **never fabricates a path** — on 3.14.x `projectPath` stays an empty string so the decision
  layer can distinguish evidence strength.
- **`cdp.ts`**: `projects()` falls back to harvesting the expanded menu **only when the legacy contracts
  yield nothing**, including the checked state and excluding "work outside a project". The 3.11.x result is
  byte-for-byte unchanged.
- **`project.ts`**: `matchZcodeProject()` gains a **display-name exact-match** branch and reports
  `matchedBy`; a new `boundProjectVerdict()` implements the layered criterion — **strict path equality
  whenever a path is available (unchanged semantics), display name when there is no path channel** — and
  requires the project list to be free of same-name ambiguity. Anything that cannot be uniquely confirmed
  still fails closed.

A fragile timing dependency was removed at the same time: `ensureProjectBound()` used to accept an
externally supplied item, which made "the menu happens to still be open" an implicit precondition. It is now
an idempotent self-check (read the verdict first, pass immediately when already bound). The binding-failure
message also now carries the trigger text, the menu checked state and the path read-back.

## Behaviour boundaries (important)

- **3.11.x is unaffected**: with a path available the original strict equality applies, and every existing
  case keeps passing.
- **3.14.x cannot expose a project's absolute path**, so the criterion is "display name + global same-name
  disambiguation". More than one same-name item yields `project_ambiguous` (fail-closed) — it **never
  guesses**. The cost is that two projects sharing a name but differing in path cannot be told apart; in that
  case the system fails explicitly rather than silently dispatching to the wrong project.
- Disambiguation needs the menu to be expanded (that is the project list's data source). With the menu
  closed only the display-name evidence is used, and a missing list **never negates** a binding.

## Verification

- **Local RED → GREEN (decisive evidence)**: a `linkedom` fixture was first built in the 3.14.x shape
  (trigger plus an expanded `menuitemcheckbox` menu, deliberately without either legacy contract) and three
  assertions were confirmed failing (`projectName`/`menuChecked` absent, `projects()` empty, multi-check not
  treated as ambiguous); they were then driven green.
- **14 new cases**: 4 at the DOM layer, 6 at the decision layer, 4 at the orchestration layer (including a
  **counter-example** where missing display-name evidence still fails closed with diagnostics).
- **Full suite: 1383 passed / 12 skipped** (1395 tests, 115 files plus 3 real-browser files skipped by
  design); `typecheck` / `lint` exit 0.
- **On-device boundary**: this machine has no ZCode 3.14.x, so the fix **was not re-verified on hardware**.
  The measurements in issue #24 were not independently reproduced and the fix is designed against those
  contracts. A new `npm run probe:zcode -- dom-contracts` helps maintainers with a 3.14.x environment
  confirm it: it reports hit counts for both legacy contracts, the trigger's full attributes, the menu item
  list and the post-fix read-back.

## Upgrade notes

Upgrading from `0.7.3` is non-breaking. 3.11.x behaviour is entirely unchanged; 3.14.x goes from "always
fails" to "dispatches normally", and still fails explicitly (rather than guessing) whenever the binding
cannot be uniquely confirmed.
