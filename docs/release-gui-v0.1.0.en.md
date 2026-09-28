# Logs 0.1.0 — First stable release

> Full change history: [CHANGELOG](../CHANGELOG.en.md). Feature documentation: [docs/gui-log-viewer.en.md](gui-log-viewer.en.md).

The first **stable release** of the Tianshu-mcp Logs desktop app (`mcp-gui/`, display name
**Tianshu-mcp Logs / Tianshu-mcp 日志台**). It is a **fully decoupled** from the MCP server:
read-only, entirely local, reading the file system directly, and unifying the four kinds of logs and task
artifacts written by Tianshu into a single window.

---

## What "going stable" means here

Before 0.1.0, the app shipped on the `gui-v0.1.0-beta.N` pre-release channel. This release promotes both the
release pipeline and the product positioning:

- **One update manifest, one upgrade path**: stable and subsequent pre-release builds share
  `latest.json` / `latest-gitee.json` and are compared by semantic version
  (`0.1.1-beta.1 > 0.1.0`), so the upgrade path never forks;
- **Stable releases are no longer flagged Pre-release**: the release page is routed by tag shape —
  only tags containing `-beta.` / `-rc.` are marked as pre-releases;
- **The release body is this document**: bilingual (Chinese first, English second) and shipped with the
  release; the in-app update window renders it directly.

---

## New: update log panel

There is now a **dedicated update window** (no longer a small block inside the settings panel):

- **Pops up when a new version is found**: a silent check runs at startup; an ignored version is not shown
  again automatically;
- **Ignore and update**: "Download and install" updates right away; "Ignore this version" suppresses only the
  **automatic** prompt — a **manual** "Check for updates" still shows that version, and **a higher version
  re-prompts**;
- **Automatic source detection**: every check probes both the Gitee and GitHub manifest endpoints concurrently
  and picks by reachability and latency. The window states explicitly **which source will be used** along with
  the probe result; when both are unreachable it falls back to the last known good source and says so;
- **Release notes are displayed**: the window body *is* this release note (Markdown-rendered, inline HTML
  disabled), so you can read exactly what changed before updating.

---

## Everything in the 0.1.0 line (start here if you are new)

### Data home

Resolved with **exactly the same rules as the MCP server**: `TIANSHU_MCP_HOME` (used when non-empty),
otherwise `~/.tianshu-mcp`. You can switch between several data homes, add and remove them; a directory is
accepted only if it contains `logs/` or `tasks/`, otherwise it is rejected with an explicit reason. The added
list is stored in the **system app-config directory** and **never written into a project directory**.

### The four log kinds and task artifacts

| Data | Path (relative to the data home) | Where in the UI |
|---|---|---|
| Global runtime log | `logs/server.log` | Sidebar → Server log |
| Task event stream | `tasks/<taskId>/task.jsonl` | Workspace · Event stream |
| Raw execution logs | `tasks/<taskId>/agent-<round>.log`, `verify-<round>.log` | Workspace · Agent logs / Verify logs |
| Verification reports | `report-<round>.{md,json,html}`, `dry-run-report-<round>.{md,json}` | Workspace · Reports |

- **Overview**: a five-cell metric strip (total / running / finished / succeeded / failed), status chips, a
  task-card grid, a full filter popover (keyword / agent / status / project / time range / active only) and sorting;
- **Event stream**: state transitions are kept distinct from fine-grained agent events (`task_dispatched` /
  `confirmation_dialog_detected` / `awaiting_user_authorization` / `file_modification_started` /
  `rework_triggered`), while `note` remains a progress channel. Unparsable lines are **skipped but counted**
  and disclosed, never silently dropped;
- **Raw logs**: the first screen loads a tail window (64 KiB) and pages backwards, showing "loaded N / total M";
  level filtering, keyword highlighting, line numbers and word-wrap toggles; **live follow** that pauses
  automatically when you scroll up, with a one-click "jump to latest";
- **Reports**: Markdown rendering; a structured card (checks / duration / exit code / output tail /
  `changedFiles` / `diffstat` / `analysis.signals` / blocking issues); visual-acceptance HTML rendered inside a
  **sandboxed iframe** (scripts disabled, CSP injected, no network); dry-run reports are shown **separately** from
  regular ones, and multiple rounds can be compared side by side.

### Search / export / copy

- **Cross-task search** across the event stream, agent logs, verify logs, reports and the server log; results are
  grouped by task → file → line with hit snippets, and clicking jumps to the exact view and position. Scanning is
  on demand (no index), with progress and **cancellation**;
- **Export** a single file's raw content, or the whole `<taskId>/` directory as a zip (optionally excluding heavy
  raw logs, reporting **exactly** how many files were excluded);
- **Copy** the task ID, the absolute task directory path, or the whole current log.

### Language, themes and design system

- **Chinese / English** switchable (Chinese by default); three theme modes (follow system / light / dark, with
  **dark as the design baseline**);
- A self-built "obsidian terminal" design system with **zero UI libraries, zero external links, zero font files** —
  fully offline. The single source of truth for colors, fonts, spacing and radii is `mcp-gui/src/styles.css`;
- Layout: a persistent left rail plus a two-state content area (overview ↔ full-screen workspace), bracket status
  labels, tabular numerals (readouts never jitter), keyboard reachable with visible focus rings, and respect for the
  system "reduce motion" setting.

### System tray and close behavior

A resident tray icon (Windows notification area / macOS menu bar) whose right-click menu offers
"Show logs / Quit logs" with **labels that follow the UI language instantly**, while a left click shows and focuses
the window. By default **closing the window minimizes to tray** (the app keeps running); the settings panel can
switch that to a full exit. On macOS, clicking the Dock icon brings the window back.

### Dual-source auto-update and self-recovery

- Checks **actively probe** both the Gitee and GitHub endpoints (never trusting system region/timezone), pick by
  reachability and latency, and cache the result by TTL. If both are unreachable it falls back to the last known good
  source and marks the degradation explicitly;
- The settings panel offers **Auto / Force Gitee / Force GitHub**, so you can self-recover on a broken network;
- Update packages are **minisign-signed** and verified against a built-in public key — **a failed signature is always
  refused**;
- A failure at any step (check / download / install) **never blocks log viewing**, and a "manual download" entry is
  offered **following the source actually in use** (opened in the system browser, allow-listed to
  `github.com` / `gitee.com`).

### Security boundaries

Business data is **read-only at all times**; the only writes are the app's own preferences (system app-config
directory) and export/update temp files you explicitly choose. Every path relative to the data home is guarded
against escaping (absolute paths and `..` are rejected). No business secrets are read or stored, and log content
is never sent anywhere.

---

## Known limitations

- **No Apple code signing or notarization**: on first launch macOS may require manual approval under
  System Settings → Privacy & Security. This does not affect functionality or auto-update — package integrity is
  guaranteed by the minisign signature;
- **macOS is only guaranteed to build in CI** (the matrix covers both macOS architectures); **no on-device
  functional acceptance** has been performed on macOS;
- **No MSI**: Windows ships an NSIS installer only (the Tauri updater does not support MSI, while the NSIS
  installer can be reused directly as the update payload);
- **No Linux build**;
- **No task write operations**: cancel / rework / continue still go through the MCP tools;
- **No local full-text index**: search scans on demand and can be slow on very large log directories (it is
  cancellable);
- **The browser preview (mock) has no native runtime**: tray, close-to-tray and real download/install can only be
  verified in the actual desktop app.

---

## Upgrade notes

- Upgrading from `0.1.0-beta.9` or any earlier beta: **no breaking changes** — install over the existing build.
  Preferences (language / theme / update source / data homes / close behavior) are preserved; the newly added
  "ignored version" field simply defaults to empty;
- Auto-update compares semantic versions, and `0.1.0` is higher than any `0.1.0-beta.N`, so existing beta users
  will receive this update normally.
