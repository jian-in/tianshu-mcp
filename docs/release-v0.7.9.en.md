# v0.7.9 — Documentation surface completed and an npm packaging allowlist fix

> See the [CHANGELOG](../CHANGELOG.en.md#079---2026-10-06).

## Background

v0.7.8 shipped the MiniMax Code adapter (the full `src/agents/minimax/` implementation plus
`docs/minimax-cdp.md`), but **only that one new document was updated** — every other place in the
repository that describes agents was still stopping at opendesign, including the body of both READMEs,
the agent list in `docs/agent-profiles.md`, and **the orchestration skill under `skills/tianshu-mcp/`**
(`SKILL.md` / `usage-examples.md`).

At the same time a **pre-existing packaging defect** surfaced: three places in the README (including the
top navigation) point at `docs/agent-profiles.md`, but that file was missing from the `package.json`
`files` allowlist — **users installing from npm hit a 404**.

This release contains **no logic changes**; it only completes the documentation surface and the
packaging allowlist.

## Changes

### 1. Fixed the dead link to `docs/agent-profiles.md` inside the npm package

Added `docs/agent-profiles.md` and `docs/agent-profiles.en.md` to the allowlist.
(This defect predates 0.7.8; it was not introduced by it.)

### 2. Completed the MiniMax Code documentation across 4 files (23 places)

| File | Count | What was added |
|---|---|---|
| `README.md` / `README.en.md` | 5 each | The agent banner, the `continue_task` resume-semantics list, **a new `minimax` row in the agent capability table**, the `reasoningLevel` validation footnote, and the version-history table |
| `docs/agent-profiles.md` / `.en.md` | 4 each | The `adapter` enum comment, the `driver=gui` table's agent list (**which had also been missing qoder / opendesign**), cross-document links, and **a new complete `minimax` profile example section** |
| `skills/tianshu-mcp/SKILL.md` | 35 | The header `description` and `triggers` (**without which the skill's keyword triggering cannot match minimax**), the tool-surface `continue_task` support list, a new 8th column and a `contextWindow` row in the §3.1 parameter matrix, a new minimax subsection in §3.2, the §3.3 platform status, all six `needsUserKind` rows plus the anchor field in the §5 resume matrix, and six error codes in §9 |
| `skills/tianshu-mcp/usage-examples.md` | 9 | **A new §2.9 minimax example** (including a candidate table for all four measured model shapes), renumbering of the `codex-cli` section (**fixing a duplicate `### 2.10` in the original**), a `contextWindow` row in the parameter-rejection table, the `autoFixRounds` defaults, and the session-anchor field table |

### 3. Every assertion was verified against the source, not recalled

Concrete values were checked line by line against the implementation, and the behavioural differences
were exercised with a real probe:

| Doc assertion | Source |
|---|---|
| `defaultAutoFixRounds = 2` | `src/agents/minimax/profile.ts:86` |
| CDP base port `9999` | `src/agents/minimax/profile.ts:62` |
| Permission mode `始终授权` | `src/agents/minimax/profile.ts:83` |
| Windows `ready` / darwin `research` | `src/agents/minimax/profile.ts:25` |
| `contextWindow` is **minimax-only** | `src/mcp/handlers.ts:476` |
| Accepts `中`/`medium`, `极高`, `最大`; **rejects** `关闭思考` | `src/agents/minimax/model.ts:43-57` (probe-confirmed) |

The "**minimax is the only adapter that accepts `中`/`medium`**" point is the easiest one to get wrong
(the other six reject it) — it follows from MiniMax Code actually rendering that tier in its UI, and the
docs call it out explicitly.

## Verification

- `npm run typecheck` / `npm run lint` / `npm run build` all green; the **full test suite has no failures**
  (no logic changed in this release).
- `npm pack --dry-run` confirms `docs/agent-profiles.md`, `.en.md` and `skills/tianshu-mcp/` are all in
  the tarball.
- Bilingual symmetry checked: README 6 mentions each, agent-profiles 17 each, SKILL.md 35,
  usage-examples 9.

## Known limitation

- The contents of `skills/` are synced by the server at startup into `~/.rivet/skills/tianshu-mcp/`
  (overwritten only when the content hash changes), taking effect in **new sessions** — you need to
  restart the MCP server to pick up this release's skill documentation.
