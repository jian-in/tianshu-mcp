# v0.7.1 — Open Design adapter verified on real hardware + artifact retrieval

> See [Open Design CDP adapter notes](opendesign-cdp.en.md) and [CHANGELOG](../CHANGELOG.en.md#071---2026-09-28).

## Background

The built-in `opendesign` agent (Open Design desktop app, `driver=gui` / `adapter=opendesign-gui`)
was "code complete but never verified on real hardware": CDP could not be reached, tasks went in
but no artifact came out, and visual acceptance spun its wheels. This release makes the whole chain
work on a real machine.

## Added

- **Artifact retrieval `src/agents/opendesign/artifact.ts`**: Open Design does **not** write its
  designs into the task directory; they live in its own artifact store at
  `<dataRoot>/projects/<projectId>/<entry>` (`dataRoot` = `%APPDATA%\Open Design\namespaces\<namespace>\data`,
  `projectId` from the artifact URL `od://app/projects/<id>/...`, and `entry`/`status` from
  `<entry>.artifact.json` in the same directory). Once the task reaches a terminal state the file is
  copied into the task directory, after which visual acceptance can derive a static entry point.
  **This is an additive step**: failure is only recorded in `progressSummary` and **never changes the
  terminal state**.
- **`src/agents/opendesign/export.ts`**: export-kind normalisation, artifact location, save-dialog
  address-bar matching predicate, and the `zip` extraction command (groundwork for the zip path).
- **Real-hardware adapter corrections**: the design-system panel's real testids are `project-ds-picker-*`;
  model menu items are `role=radio` (not `option`); selector candidates now **stop at the first
  candidate that matches** (a primary hit is no longer merged with fallback hits); a daemon-readiness
  wait was added (the product completes an auth handshake with its daemon before opening the folder
  picker, and the daemon only settles ~30s after launch); the task input is cleared before typing;
  and the workspace `already-bound` predicate now requires the `recentLinkedDirs` sidecar.
- **`visual.ts` single-root-html fallback**: the allow-list cannot recognise the names the product
  gives its artifacts, so when the allow-list matches nothing and there is **exactly one** html at the
  project root it is accepted; multiple html files are still never guessed.

## Fixed

- **CDP was never reachable**: the fixed `--remote-debugging-port` is bound and held by the
  **windowless launcher process**, so the real window process fails to bind — `/json/version` answers
  while `/json/list` stays `[]` (the port is reachable but exposes no page target). Switching to `=0`
  (each process gets its own random port) plus locating the real window via **`DevToolsActivePort`**
  makes the real machine attach in **4 seconds**.
- **The readiness predicate had a stale copy in `instance.ts`** (missing the `^od://` rule) while the
  real page is `title=OpenDesign` (no space) + `url=od://app/` → consolidated into a single source in
  `cdp.ts`, tolerating the title with or without the space.
- **Main-window ranking could be stolen by a same-titled helper page** (`od://app/desktop-pet` is also
  titled `OpenDesign`).
- **Tests depended on local processes**: `waitForDaemonReady` used to call the real process enumeration,
  so cases drifted with "is Open Design running on this machine" (passing alone, failing in a full run).
  Now injectable — **tests stay green with Open Design closed**.

## Verified on real hardware

- `onboarding-guide.html` (37,838 bytes, self-contained) landed in the task directory, and visual
  acceptance resolved the `/onboarding-guide.html` entry.
- Gates: `test` 115 passed / 0 failed; `typecheck` / `lint` / `build` / `check:stdio` (8/8) all green.

## Known limitations

- **The `zip` export path is not wired up**: CDP observed a real download (`suggestedFilename` is a
  Chinese zip name) but the final state is `canceled` — the product's main process takes over downloads,
  overriding `Browser.setDownloadBehavior`. The `html` path is fully working; zip is future work.
