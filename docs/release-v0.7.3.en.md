# v0.7.3 — Aligning the skill docs with the implementation (incl. Open Design artifact retrieval)

> See [CHANGELOG](../CHANGELOG.en.md#073---2026-09-28) and the [skill itself](../skills/tianshu-mcp/SKILL.md).

## Background

The docs under `skills/tianshu-mcp/` (`SKILL.md` 321 lines + `usage-examples.md` 627 lines) had drifted
from the implementation: they never mentioned the artifact-retrieval capability added in `v0.7.1`, and
`usage-examples.md` carried a **duplicate `### 2.9`** heading. This release brings the docs back in line
with the code and, while rewriting, fixes a few misleading statements.

## Fixed

- **Heading collision in `usage-examples.md`**: `### 2.9 通用约定` → `### 2.10 通用约定`
  (it collided with the `### 2.9 codex-cli` above it).
- **`SKILL.md` §9 now states explicitly that the error-code table is a subset, not a closed set**:
  `endReason` is typed as an optional `string` (`src/agents/adapter.ts:93`) with no enum constraint, so an
  adapter can introduce a new value without a type change. When you meet a value that is not in the table,
  read that adapter's `run.ts` rather than guessing from the name.
- **Added three high-frequency `endReason` values that were missing**: `input_mismatch` (a leftover draft
  in the input box makes the task land inside stale text), `send_unknown` (delivery unconfirmable — the
  adapter **never resends**), and `reply_stable` (normal completion, not an error).

## Added (docs)

- **Open Design artifact retrieval** (a `v0.7.1` capability, previously undocumented): designs live in the
  product's artifact store at `<dataRoot>/projects/<projectId>/<entry>`, **not** in the task directory;
  once the task reaches a terminal state the adapter copies it into `projectPath`, after which visual
  acceptance can derive a static entry point. Retrieval is an **additive step**: failure is only recorded
  in `progressSummary` and **never changes the terminal state**.
- **Daemon-readiness precondition**: the product completes an auth handshake with its daemon before opening
  the folder picker (measured: the daemon only settles ~30s after launch); when it is not ready the product
  **does not open any dialog at all**, so the adapter waits for the daemon first.
- **`zip` export as a known limitation**: the product's main process takes over downloads, overriding CDP's
  download handling; the `html` path is fully working.

## Note

This release contains **no runtime code changes** (only `skills/` docs and the version bump), so upgrading
from `0.7.2` changes no behaviour; it exists to sync docs with implementation and to align
`tag` / `Release` / npm on a single commit.
