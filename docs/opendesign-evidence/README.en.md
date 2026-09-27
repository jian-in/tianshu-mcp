# Open Design real-machine evidence directory

This directory holds probe evidence produced by `scripts/probe-opendesign.mjs` **on a real machine**,
used to fill in the "to be filled" table in [docs/opendesign-cdp.en.md](../opendesign-cdp.en.md) §4.4
and to confirm the selector evidence table in §4.1.

Why it exists: the selectors are already grounded in the **product's own artifacts** (the `data-testid`
hooks in its web bundle), but "those hooks really match on the current build, and each matches exactly once"
still has to be captured once on real hardware — otherwise the evidence chain in
`docs/opendesign-cdp.en.md` is missing its final link.

Chinese version: [README.md](README.md)

## Capture command (run in a normal, **network-capable** terminal; about two minutes)

```powershell
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:\NODE_OPTIONS -ErrorAction SilentlyContinue
cd <repo root>
npm run build
node scripts/probe-opendesign.mjs all --launch --save
```

- `--save` writes into **this directory** by default, with a timestamped filename; the output is also
  printed to stdout so it can be read on the spot.
- The probe is **read-only by default**: it never clicks, types, or sends; `--launch` only allows starting
  one window when no usable instance exists.
- If a running Open Design instance does **not** have the debug port enabled, the single-instance lock makes
  the launcher hand over arguments and exit — close that instance first (when this happens during dispatch,
  the adapter truthfully reports `needs_user(close_existing_instance)` and never kills the user's process).
- Failures are written too: **a failed capture is itself evidence** (for example, inside the sandbox used for
  development, `/json` connects but never responds).

## What to do with the capture

1. Fill the `anchors` section (each semantic key's **hit count + first text**) into the §4.4 table of
   `docs/opendesign-cdp.en.md` **and** `docs/opendesign-cdp.md`;
2. If a key's count differs from the expectation, check §4.1: prefer a hot-fix through
   `profile.gui.selectors` keyed by semantic key (**an override is authoritative** and is not merged with the
   built-in fallbacks); only change the `primary` in `src/agents/opendesign/selectors.ts` when necessary;
3. Then run one real `run_task` (`designDirection="原型"`, `designSystem="Claude"`, an explicit model) and put
   the key screenshots plus `agent-0.log` from the task data directory here, recording the conclusions in
   `docs/opendesign-cdp.en.md` — including one full "verification failed → automatic rework → passed" round.

## Directory conventions

- Files here are **produced by the probe / by tasks**, not hand-written documentation; `package.json`'s
  `files` already includes this directory, so shipping it inside the npm package is intended.
- Naming: probe evidence is `opendesign-probe-<ISO timestamp>.md`; for real-machine task evidence prefer
  `opendesign-run-<taskId>-<round>.png|log` so it can be matched against the task data directory.