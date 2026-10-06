# v0.7.10 — Precise semantics for the visual content-egress gate (issue #29)

> See [CHANGELOG](../CHANGELOG.en.md#0710---2026-10-06).

## Background

issue #29 reports that with `allowRemote=false` (the default), a content-judgement rule using
`<image:base64:file>` is rejected by the schema, while delivering the same inspected image via
`<image:path>` is **unconstrained**; and the wording in `SECURITY.md` ("the MCP's enforcement is
contract-level only") leads readers to believe the contract layer **blocked every way of handing an image to
a command**. The issue proposes folding `<image:path>` and `<expect:file>` into the `allowRemote` gate.

This release **does not adopt that proposal as-is**, for two reasons pinned down by measurement.

## Why the path channel is not gated

### 1. Zero security benefit (counter-evidence probe)

The judgement command's `cwd` is inside the **project directory** (see `projectFile(ctx.project,
effective.cwd)` in `src/visual/content.ts`, defaulting to `"."`), and the inspected image (`contents[].files[]`)
is itself a **project file**. So:

```
project(cwd) = D:\Trae项目\tianshu-mcp
inspected file (project-relative) = package.json
placeholders in argv = false
exitCode = 0
output = {"passed":true,"confidence":1,"reason":"READ 4187 bytes with zero placeholders"}
```

**The command reads project-file bytes with zero placeholders.** Gating `<image:path>` only forces users to
turn on `allowRemote` to obtain a path they could already read — adding no security.

### 2. It widens the egress surface instead

Requiring `allowRemote` just to pass the schema pushes users toward a broader configuration — `allowRemote=true`
**also opens** `<image:base64:file>` (inline bytes). That is, gating the path channel opens the real inline
byte channel.

### 3. `<expect:file>` is not an image channel at all

It delivers a temp file holding the **expectation text** (a description the user wrote), not image bytes.
The issue conflates two placeholders of different natures — this release clarifies that in the docs so readers
do not carry the misreading forward.

## What this release actually does

`allowRemote` is really about **preventing accidental/misconfigured inline egress** — it is not "preventing
deliberate egress", nor a system-level block (the latter was already stated truthfully in `SECURITY.md`). The
current state is a **deliberate trade-off**; what was missing is stating it clearly. So:

| Change | Location |
|---|---|
| New `contentChannelUsage()` as the **single source of channel semantics** (gate + display share it, so they cannot drift) | `src/visual/schema.ts` |
| `visual doctor` reports each rule's **actually-used channels** and whether they are `GATED by allowRemote` | `src/visual/runtime.ts` |
| `visual content probe` output gains `egressConstrained` / `pathChannels` | `src/visual/manage.ts` |
| Precise bilingual wording + `<expect:file>` clarification | `SECURITY.md`/`.en.md`, `docs/visual-acceptance.md`/`.en.md`, `skills/tianshu-mcp/SKILL.md` |

After the fix, `visual doctor` prints lines like:

```
logo: judge -> /usr/bin/judge; allowRemote=false (constrains only <image:base64:file>);
channels used: <image:path>, <expect:file> — NOT gated by allowRemote
```

**The channels are visible, not hidden.**

## Behaviour boundaries (unchanged)

- `allowRemote=false` still **rejects** `<image:base64:file>` (schema-rejected outright, not a runtime warning).
- `<image:path>` / `<expect:file>` remain unconstrained by `allowRemote` — deliberately, as argued above.
- The contract layer is still **not** a complete block on image egress; whether an image leaves the machine
  depends on the user's own command.

## Verification

- 5 new channel/admission contract tests + 2 doctor channel-semantics tests; probe field assertion updated.
- Full `npm test`: **1582 passed / 12 skipped, 0 failed**.
- `typecheck` / `lint` / `build` / `pack:check` / `check:stdio` all green.

## Known limitations

- If a user genuinely wants the `pages[].content` case (whose screenshot lands in the out-of-project task
  directory) to hard-gate `<image:path>` too, that would be a **breaking change** (the same placeholder would
  mean different things across the two rule kinds, plus batch config migration). issue #29 lists it as
  pending; this release does not do it.
- `visual doctor`'s channel visibility is **informational**, not **preventive**.
