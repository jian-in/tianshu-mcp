# Open Design GUI (CDP) adapter: real-machine facts and design rationale

[中文](opendesign-cdp.md)

This document records the **real-machine findings** for the `opendesign-gui` adapter and the
constraints they impose on the implementation. The adapter turns the Open Design desktop client (the
"Let's create a prototype" AI app that generates design artifacts) into a tianshu-mcp GUI agent that can
be dispatched to, observed, and accepted.

> Evidence machine: Windows 10 Pro 19045; Open Design 0.24.1 (Electron 41.3.0, official installer);
> install directory `D:\Open Design`; captured 2026-09-25 ~ 2026-09-26.

## 1. Installation and data directories

| Fact | Value / source |
|---|---|
| Install shape | **Plain install** (not an MSIX store package), `<install dir>\Open Design.exe` |
| Install config | `<install dir>\resources\open-design-config.json` → `appVersion` / `namespace` |
| Measured values | `appVersion=0.24.1`, `namespace=release-stable-win` |
| Electron userData | `%APPDATA%\Open Design\namespaces\<namespace>\user-data` |
| App data | `%APPDATA%\Open Design\namespaces\<namespace>\data\` (`app-config.json`, `app.sqlite`) |
| Logs | `%APPDATA%\Open Design\namespaces\<namespace>\logs\{daemon,desktop,launcher,web}` |

**Nothing is hard-coded**: the install path is derived from `executableDiscovery`
(`preferredDrives:["D:"]` + `relativePaths:["Open Design/Open Design.exe"]` → registry uninstall info →
standard directories → PATH); version and namespace always come from the install config.
**When the namespace cannot be read we do not guess** (`openDesignNamespaceRoot` returns `null`),
because guessing it wrong produces a silent misjudgement ("directory bound but `app-config.json`
unreadable") instead of a loud error.

## 2. Instance takeover: single-instance lock and the truth about `--user-data-dir`

This is where Open Design differs most from ZCode / Kimi Code / Qoder, and it decides the instance strategy.

### 2.1 ⚠️ `ELECTRON_RUN_AS_NODE`: the real root cause of failed launches (measured)

`Open Design.exe` is an **Electron launcher with an embedded Node**. If the process that starts it carries
`ELECTRON_RUN_AS_NODE=1` (this machine's DSH harness injects exactly that), the launcher is forced into
**Node mode**:

```
D:\Open Design\Open Design.exe: bad option: --remote-debugging-port=9889   (exit code 9)
D:\Open Design\Open Design.exe: bad option: --headless                     (exit code 9)
```

The symptom is "no window, no new log lines, no crash dump" — **very easy to misdiagnose as a broken
installation**. Clearing the variable makes the same command work immediately:

```
DevTools listening on ws://127.0.0.1:9889/devtools/browser/63dd8142-…
```

`NODE_OPTIONS` must be cleared too: Node explicitly forbids `--remote-debugging-port` there, and a leftover
value fails with `--remote-debugging-port= is not allowed in NODE_OPTIONS`.

**Managed launches therefore sanitise the environment** (`OPEN_DESIGN_ENV_DENYLIST` +
`sanitizedSpawnEnv()`) and **do not change the command line** — it stays the profile's `exeArgs`
(`--remote-debugging-port=<port>`), which is the form the official launcher already supports.

> ⚠️ **Manual verification must clear the variable yourself**: launching via `Start-Process` or the Explorer
> shortcut from a session that carries it fails the same way — measured as **launcher exit=0 with zero
> processes left** (not `bad option`, because the arguments are fine; the launcher's internal Node-mode branch
> just returns). Both symptoms share one root cause, so do not be misled by the differing exit codes.

### 2.2 The launcher is a "detached child" shape

Measured: after accepting the debug port the launcher prints `DevTools listening on …` and then **exits with
code 0**; the real Electron main process is the detached child it spawned. Therefore:

- **Exit code 0 does not mean failure**: the announced port must be parsed from stderr
  (`devtoolsPortsFromOutput()`) and polling must continue;
- The first implementation treated exit code 0 as "ask the user to close the old instance", which on the real
  machine manifested as "it is clearly running yet it keeps asking me to close it" — fixed.
- Exit code 9 is classified as "cannot take over → `needs_user`"; any other non-zero is a genuine launch
  failure (thrown with the stderr tail).

| Fact | Source (`resources/app/prebundled/packaged-main.mjs`) |
|---|---|
| A **process-level single-instance lock** exists; a second instance only hands its deeplink to the first and exits | `claimPackagedSingleInstanceLock` (:34250-34259), `createPackagedSecondInstanceHandoff` (:34260-34283) |
| The main process **forces** `app.setPath("userData", <namespaceRoot>/user-data)` | `applyPackagedElectronPathOverrides` (:34245-34248) |
| Therefore the `--user-data-dir` switch **is overridden** | same; `resolvePackagedNamespacePaths` (:32578-32598) |
| `--headless` is supported (no window; starts daemon/web sidecars; `--mcp-install codex`) | `parsePackagedHeadlessRequest` (:33471-33484), `runPackagedHeadless` (:33510+) |

### Resulting strategy (reuse → self-launch → ask the user to close)

1. **Reuse first**: an existing instance whose root process argv carries a valid debug port is taken over
   (`probeOpenDesignPort` performs product validation).
2. **Launch a managed instance**: with no instance present,
   `spawn(exe, ["--remote-debugging-port=<port>"])`.
3. **`needs_user(close_existing_instance)`**: an instance exists without a debug port → the spawned child is
   handed off by the single-instance lock and exits; the adapter **asks the user to close it manually**
   and never kills user processes.

**No "dedicated userData managed instance"**: the main process overrides that switch, so writing it into the
profile would be a false promise. The `opendesign` profile therefore leaves `gui.userDataDir` unset and
`exeArgs` only injects the debug port.

### The root-process trap (hit on the real machine, then fixed)

The product also runs its daemon and web sidecars as child processes of the same executable. On the evidence
machine their command lines look like:

```
"D:\Open Design\Open Design.exe" "D:\Open Design\resources\app\prebundled\daemon\daemon-sidecar.mjs"
"D:\Open Design\Open Design.exe" "...\@open-design\sidecar\dist\supervisor.mjs" --od-stamp-app=web
```

They have **no window and do not take part in the single-instance lock**, but they stay resident. Counting
them as "a running instance" would keep reporting `needsClose` after the user closes the UI, so a managed
instance could **never start**. `rootOpenDesignProcesses()` therefore also drops processes whose argv
contains an `.mjs` script, in addition to `--type=` / crashpad. Measured: 11 same-named processes → exactly 1
real desktop main process.

## 3. CDP endpoint

| Item | Value |
|---|---|
| Debug port base | **9889** (range 9889-9898) |
| Why not 9777 | That port is taken by **Qoder CN** (base 9777, range 9777-9796) — changed after real-machine measurement |
| Existing bases | traework 9222 / zcode 9333 / codex 9333 / kimicode 9666 / qoder 9777 |
| Product validation | `/json/version` `User-Agent` contains `electron` **and** a page target exists whose title starts with `Open Design` (or whose URL contains `open-design`) |
| Version criterion | The **product version** comes from `resources/open-design-config.json`; CDP `/json/version`'s `Browser` is the **Electron version** (`Electron/41.3.0` measured) and must **not** be used for product-version comparison |

> Version-criterion pitfall: the first implementation used CDP's `Browser` field for the version gate, which
> made every real-machine dispatch fail with `version_mismatch`. It now reads the install config, with a
> regression test in `opendesign-discovery.test.ts`.

## 3.1 ⚠️ Measured: `/json` hangs → the transport needs two paths

| Observation | Value |
|---|---|
| Browser-process `/json/version` | **responds normally** (including `webSocketDebuggerUrl`) |
| Browser-process `/json`, `/json/list` | **connects and then never answers** (0 bytes, timeout) |
| Same port, other checks | the port is LISTENing and `DevTools listening on ws://127.0.0.1:9889/…` has been printed |

Diagnosis: `/json`'s target enumeration runs on the **UI thread**, and Open Design's main thread is occupied
during startup by its own version/telemetry/billing requests — so "the endpoint is alive but the catalogue
never answers". A transport that only uses `/json` would **hang forever in connect** on the real machine.

`src/agents/opendesign/transport.ts` therefore uses **two paths**:

1. Fast path: HTTP `/json` (fastest on healthy versions, semantically identical to the existing GUI
   transport), with a shorter cap (≤3s);
2. Slow path: `/json/version` yields the **browser-level** WebSocket URL → `Target.getTargets` enumerates
   targets → `Target.attachToTarget({flatten:true})` yields a `sessionId` → page-level commands then carry
   that `sessionId`, while `Target.*` / `Browser.*` **must not** (they are rejected if they do).

The readiness probe `probeOpenDesignPort` and the transport **share one target-enumeration implementation**
(`resolvePageTargets`) — two copies would inevitably drift. When both paths fail the error must state what was
tried; dumping a bare `CDP_UNAVAILABLE` is not acceptable.

## 4. UI structure and selector evidence

Open Design is a packaged React app (`resources/app/prebundled/*` are minified artifacts), but its
**web front-end bundle is readable**:

```text
<install dir>/resources/open-design-web-standalone/apps/web/.next/static/chunks/*.js
```

That bundle **systematically uses `data-testid`** as automation hooks (600+ were found), and those hooks carry
business semantics (`chat-send` / `working-dir-trigger` / `composer-design-system-trigger` …) — i.e. the hooks
the product authors reserved for automation. Every `primary` in this adapter therefore comes from **bundle
evidence**, not from eyeballed screenshots: eyeballed coordinates/class names drift silently on the first UI
upgrade.

Review entry points (read-only):

```sh
npm run build
node scripts/probe-opendesign.mjs anchors --no-focus   # read-only survey; connect without focusing
node scripts/probe-opendesign.mjs all                  # install + process + cdp + appconfig + anchors
node scripts/probe-opendesign.mjs all --launch --save  # real-machine capture: launch + write all output into docs/opendesign-evidence/
```

### 4.1 Selector evidence table (`primary` values in `src/agents/opendesign/selectors.ts`)

| Semantic key | primary (real hook) | Evidence |
|---|---|---|
| `title` | `[data-testid="home-hero"]` | the home hero container (a product-owned hook) |
| `composer` | `[data-testid="chat-composer"]` | conversation-page composer container; the home shape is `home-hero-composer-card` |
| `inputBox` | `[data-testid="home-hero-input"]` | the home editor explicitly carries this testId (Lexical rich text); on the conversation page it is the `[contenteditable=true]` inside `chat-composer` |
| `workingDirTrigger` | `[data-testid="working-dir-trigger"]` | the button inside `working-dir-picker` (carries `aria-expanded`) |
| `selectDirItem` | `[data-testid="working-dir-pick"]` | the "Select directory" item once expanded; inside the composer "+" menu it is `composer-plus-working-dir-pick` |
| `workingDirValue` | `[data-testid="working-dir-trigger"]` | reads that trigger's label text back (the only authoritative proof the binding took effect) |
| `modelTrigger` | `[data-testid="inline-model-switcher-chip"]` | the in-conversation inline model switcher; inside the new-project modal it is `model-picker-trigger` |
| `modelMenuItem` | `[role="option"]` | the trigger is `aria-haspopup="listbox"` and the panel is `role="listbox"` |
| `designSystemTrigger` | `[data-testid="composer-design-system-trigger"]` | composer icon shape; home shape `home-hero-design-system-trigger`, project picker `project-ds-picker-trigger` |
| `designSystemSearch` | `[data-testid="design-system-search"]` | the design-system panel's search box (`class="ds-picker-search"`) |
| `designSystemItem` | `[role="option"]` | panel list items (list container `ds-picker-list-design-systems`) |
| `designDirectionTrigger` | `[data-testid="home-hero-template-trigger"]` | the "creation type" picker in the UI (inside `home-hero-template-picker`, `aria-haspopup="listbox"`) |
| `designDirectionItem` | `[role="option"]` | same listbox shape |
| `sendButton` | `[data-testid="chat-send"]` | conversation-page send button (`aria-label=<chat.send>`); home shape `home-hero-submit` |
| `stopButton` | `button.composer-send.stop` | **this control has no testid**; the product marks it with `class="composer-send stop"` + `aria-label=<chat.stop>`, so class is the primary (language-independent) and aria is the diagnostic fallback |
| `conversationText` | `[data-testid="chat-log"]` | the product's own scroll/forensics anchor; extremely stable semantically |

> The three menu-item keys (model / design system / design direction) **share `[role="option"]`** — the product
> only ever has one listbox open at a time, so the union semantics are safe; the adapter still demands a
> **unique match** and refuses to click on multiple matches (never guesses a coordinate).

### 4.2 Why the layout guard keeps only four keys

`OPEN_DESIGN_LAYOUT_GUARD_KEYS` = `title / composer / inputBox / sendButton` — only anchors that
**unconditionally exist on the home page**.

The working-directory, model, design-system and design-direction triggers render depending on user
configuration and page shape:

- the model trigger only appears when a matching execution mode is configured;
- the design-system / design-direction triggers are not rendered when the footer options are empty.

Keeping such keys in the guard makes the adapter **fail broadly and falsely** (reporting "page structure
drifted" when the truth is "that capability is unavailable in the current configuration"). They are therefore
validated **inside their own steps** with precise reasons (`no-trigger` / `no-menu` / `needs_user`), which is
more truthful than a blanket block.

### 4.3 Implemented selector/DOM layer and execution layer

| File | Contents |
|---|---|
| `selectors.ts` | a registry of 16 semantic keys (`primary` + semantic `fallbacks` + `texts`/`ariaLabels`/`ariaPatterns`), `cssCandidates`, `specArgs`, `selectorSpec`, the in-page `resolveFnSource`, the **layout guard key set** and `missingSelectorKeys()` |
| `dom.ts` | in-page expressions: `exists` / `text` / `singlePoint` / `firstPoint` / `exactMatch` / `listLabels` / `count` / `inputValue` / `conversationText` / `triggerText` / `layoutProbe` / `dismiss` / `directionItemVisible`, marker prefix `od:` |
| `transport.ts` | page-level CDP transport (two paths, session isolation, disconnect semantics) |
| `cdp.ts` | the semantic layer `OpenDesignCdpClient`: trusted coordinate clicks, exact-match clicks, typing, Escape dismissal, single-shot poll snapshots, layout probing |
| `menu.ts` | the shared "trigger → expand → exact match → read-back" flow for model / design system / design direction |
| `send.ts` | type the task + click send exactly once + bounded confirmation (three pieces of evidence) |
| `recovery.ts` | per-step budget (`remaining(cap)` takes the minimum of three deadlines; retries never reset it) |
| `workspace.ts` | working-directory binding orchestration: skip when already bound → expand trigger → click "Select directory" → native dialog → **read-back verification** |
| `dialog.ts` | native dialog: `toNativeDialogPath`, `listOwnedDialogs`, `closeStrayDialogs`, `selectOpenDesignFolder` (**two routes**: WM_SETTEXT first, keyboard input as fallback; both require a matching read-back, and success requires the dialog to **actually close**) |
| `liveness.ts` | **three-signal** judging: stop-button visibility + conversation-text hash + **artifact mtime/size fingerprint**; pure function `judgeOpenDesignPoll` |
| `fixplan.ts` | repair/optimisation plans written to the **project root** `.opendesign/plans/opendesign-fix-r<N>.md` (per-round, never overwritten) + fix-prompt assembly |
| `visual.ts` | visual-acceptance page-source **suggestions** (derived only, never written to disk, never silently changing project config) |

**Success is judged by a matching read-back, not by the dialog closing**: confirming the native dialog only
means the OS accepted the directory; whether the app actually adopted it as its working directory must be
verified by reading the UI value back. When the two disagree the result is reported truthfully as a
`readback` failure and never treated as success (otherwise later failures get attributed to entirely
unrelated causes).

**Why the artifact signal is required**: Open Design writes files continuously while **not refreshing the
conversation** for long stretches. Text-only judging would call that normal work "idle and finished", so the
quiet criterion demands **both text and artifacts to be stable**.

**Native-dialog safety boundary** (`dialog.ts`): only operate on windows that are "**newly appeared** +
owned by the target process + class `#32770` + visible + **unique**". The baseline is sampled *before*
clicking "Select directory", and any window already in the baseline is never touched; multiple new dialogs
abort the operation (never guess which to click); paths enter the script only via environment variables so
CJK is not mangled by the console code page.

After taking over a managed instance, `run.ts` first **closes stray `#32770` windows owned by that
instance's pids** — a modal dialog swallows the main window's synthetic clicks, and leaving it in place makes
the next round misread "clicking Select directory does nothing" as selector drift.

Design constraints (isomorphic to `kimicode/dom.ts`):
- Click expressions **return coordinates only**; `cdp.ts` dispatches the mouse events via
  `Input.dispatchMouseEvent` (**trusted clicks**: React's synthetic event chain is sensitive to `isTrusted`).
  The expressions themselves have no side effects.
- "The click succeeded" ≠ "the state changed": whether a panel opened, whether a menu item appeared, and
  whether the trigger's read-back equals the target are all confirmed by reading back.
- Fallbacks **must not be broad containers** (`button`/`div[class]`/`li`…): multiple matches break
  coordinate clicking, and the error only says "selector not mounted", which is very hard to diagnose
  (now pinned by assertions).
- Candidate matching is **exact equality**; a miss errors and echoes the visible candidates, and
  **never degrades into fuzzy matching**.
- **A `gui.selectors` override is authoritative**: once an override is given for a semantic key, only that
  value is used and the built-in fallbacks are **not** mixed in (they contain broad candidates such as
  `[aria-haspopup]`, and mixing them makes "unique match" fail necessarily — a hot-fix selector would then
  switch the feature off entirely). A small UI revision can therefore be hot-fixed **without a release**.

### 4.4 To be filled in: the probe's actual all-anchor hit list

`scripts/probe-opendesign.mjs anchors` prints the **actual hit count and first text** for every semantic key.
Inside this sandbox Open Design's main thread stalls during startup (see §3.1), so real DOM capture cannot
complete; the table below awaits capture from a **network-capable terminal** (one `--save` run produces a
committable evidence file directly — see [docs/opendesign-evidence/](opendesign-evidence/README.en.md)):

| Semantic key | Expected hits | Measured hits | Measured text |
|---|---|---|---|
| `title` | 1 | to be filled | |
| `composer` | 1 | to be filled | |
| `inputBox` | 1 | to be filled | |
| `workingDirTrigger` / `workingDirValue` | 1 / 1 | to be filled | |
| `selectDirItem` (after expanding) | 1 | to be filled | |
| `modelTrigger` | 1 | to be filled | |
| `modelMenuItem` (after expanding) | ≥1 | to be filled | |
| `designSystemTrigger` | 1 | to be filled | |
| `designSystemSearch` / `designSystemItem` (panel open) | 1 / ≥1 | to be filled | |
| `designDirectionTrigger` | 1 | to be filled | |
| `designDirectionItem` (after expanding) | ≥1 | to be filled | |
| `sendButton` | 1 | to be filled | |
| `stopButton` (while running) | 1 | to be filled | |
| `conversationText` | 1 | to be filled | |

## 5. Native "Select Folder" dialog

The dialog in mockup 2 is a native Windows `#32770` raised by Electron `dialog.showOpenDialog`, with a
"Folder:" edit box and "Select Folder" / "Cancel" buttons. The adapter's contract:

- **Ownership check first**: collect the managed instance's process pids and match with
  `EnumWindows` + `GetWindowThreadProcessId` (recursively checking parent processes, same approach as
  `kimicode/dialog.ts`); only operate on windows that match;
- Path entry and confirmation go through UIA / keyboard (landing with evidence in phase P2);
- Ownership unclear or dialog absent → close only the dialog we raised and switch to
  `needs_user(system_permission)`; user windows are **never** touched.

## 6. `app-config.json` corroborating fields

Measured content of `%APPDATA%\Open Design\namespaces\<namespace>\data\app-config.json` (excerpt):

```json
{
  "agentId": "amr",
  "designSystemId": "default",
  "agentModels": { "amr": { "model": "deepseek-v4.1-flash" } },
  "recentLinkedDirs": ["D:\\Trae项目\\tianshu-mcp"],
  "defaultProjectLocationId": "default"
}
```

Purpose: **corroboration and diagnostics only** (`agentModels` / `recentLinkedDirs` can corroborate "which
model was selected / which directory was bound last"). **UI read-back is the authoritative criterion**;
editing this file to bypass clicking is outside this adapter's behavioural boundary.

The probe's `appconfig` subcommand prints these fields read-only.

## 7. Where design systems and models come from

| Item | Source |
|---|---|
| Design system catalogue | `<install dir>\resources\open-design\design-systems\<slug>\manifest.json`'s `name` (e.g. `claude` → `Claude (Anthropic)`), 151 bundled packages |
| Model IDs | Model registry in the packaged artifacts; `deepseek-v4-flash` / `deepseek-v4-pro` / `claude-fable-5` confirmed present |
| Design direction | The UI offers six entries; the adapter supports **only** Prototype / Document / Website clone and rejects the rest explicitly |

Models and design systems are always **matched exactly and then read back**: a miss fails with the currently
visible candidates echoed back (see `matchMenuCandidate` in `model.ts`) and never degrades into fuzzy
matching — picking the wrong model is worse than an error.

## 8. Failure codes

| Failure code (`endReason`) | Trigger | Orchestrator action |
|---|---|---|
| `setup_failed` | Entry validation failed (invalid direction / empty task text / executable not found / CDP never connects) | Hard failure, no acceptance |
| `version_mismatch` | Product version not in `opendesign.supportedVersions` | Hard failure echoing the measured version |
| `selector_drift` | Required selectors missing, or a layout-guard anchor did not match | Hard failure listing the missing keys and the current page |
| `model_unavailable` | The target model name has no exact match in the model menu (it does not exist) | Hard failure echoing the currently visible candidates |
| `model_mismatch` | A candidate was picked but the trigger's read-back differs from the target | Hard failure echoing the read-back value |
| `design_system_mismatch` | After searching the design-system panel the target still cannot be picked uniquely, or the read-back differs | Hard failure |
| `input_mismatch` | The input's read-back does not contain this round's task marker (the text never reached the controlled editor) | Hard failure, **send was never clicked** (avoids dispatching an empty task) |
| `send_unknown` | No evidence could be confirmed within the bounded window after sending | Hard failure, **never resent**, tells the user to check the window |
| `session_lost` | A rework/answer round is not on a conversation page (conversation container missing) | Hard failure; never degrades to a fresh dispatch from the home page |
| `reply_stable` | Conversation text and artifact fingerprint are both stable (successful completion) | Proceeds to acceptance |
| `idle_timeout` | No change for `stableRounds` consecutive rounds while the completion criterion is unmet | Keeps the state and reports truthfully |
| `task_timeout` | The overall task deadline was reached | Keeps the state (no window closed, no process killed) |
| `aborted` | The user cancelled | Tries to click stop and waits within `cancelWaitMs`; when `guiStop.idle=false` it **must** state that the task in the window may still be running |

`needsUserKind` (used with the `needs_user` terminal state):

| Value | Trigger | `continue_task` resume semantics |
|---|---|---|
| `close_existing_instance` | An existing instance without a debug port cannot be adopted | After the user closes it, **re-dispatch** (resending the full task text) |
| `login_required` | The page is readable but the input never appears within the observation window (login/onboarding) | Sign in, then re-dispatch |
| `system_permission` | Native-dialog ownership is unclear / it never appeared, or system permission was denied | Grant permission, then re-dispatch |
| `setup_recovery` | The initialization budget ran out (instance / page / working-directory binding not ready) | Re-check the environment, then re-dispatch |
| `user_confirmation` | The stop button stays visible while conversation and artifacts are completely static (possibly waiting for a human) | **Reconnect and observe only**; sends nothing |

## 9. Reproduction notes

```sh
npm run build
# ⚠️ Clear the variables that force the launcher into Node mode first (see §2.1);
# managed launches sanitise automatically, manual diagnosis must do it explicitly.
unset ELECTRON_RUN_AS_NODE; unset NODE_OPTIONS      # Windows PowerShell: Remove-Item Env:\ELECTRON_RUN_AS_NODE

node scripts/probe-opendesign.mjs install      # install / version / namespace / data directories
node scripts/probe-opendesign.mjs process      # processes and root-process determination
node scripts/probe-opendesign.mjs appconfig    # app-config.json corroboration
node scripts/probe-opendesign.mjs cdp          # ports and page targets (needs an instance with a debug port)
node scripts/probe-opendesign.mjs anchors      # UI anchor survey (needs an instance with a debug port)
```

**Full selector-capture procedure** (requires reachable external network, otherwise the main thread wedges on
startup requests):

1. Close every Open Design window (an instance without a debug port cannot be taken over);
2. `node scripts/probe-opendesign.mjs all --launch --save`: starts a managed instance, prints
   `/json/version`, the page-target topology, the match count and text for every semantic key, and the first
   1200 characters of visible page text, and **writes all of that to disk** under
   [docs/opendesign-evidence/](opendesign-evidence/README.en.md) with a timestamped filename;
3. Fill the `anchors` section of that file into the §4.4 table (both languages); when a count differs from the
   expectation, prefer a hot-fix through `agent-profiles.json`'s `gui.selectors` keyed by semantic key
   (**an override is authoritative** — no release needed), and only then edit the `primary` in
   `src/agents/opendesign/selectors.ts`;
4. Re-run `anchors` and confirm the "layout guard" section reports **all anchors matched**;
5. Paste the evidence into the anchor table in §4 and drop the key screenshots plus `agent-0.log` into
   `docs/opendesign-evidence/`.

`--no-focus` connects without bringing the window to the front (for pure DOM reads). Click diagnostics
**must** focus it — background pages are throttled by Chromium and synthetic events become unreliable.
`--save [dir]` writes all output to disk as committable evidence (default `docs/opendesign-evidence/`);
**failures are written too** — a failed capture is itself evidence.
