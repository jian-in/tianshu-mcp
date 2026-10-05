# MiniMax Code GUI (CDP) Adapter

[中文](minimax-cdp.md)

tianshu-mcp's seventh GUI agent adapter (`agentId=minimax`): it drives the MiniMax Code desktop app through the full loop of "locate the installation → launch it with CDP enabled → bind the project folder → select model / reasoning level / context window → send the task → detect completion → auto-verify → rework on failure → re-verify".

- Implementation: `src/agents/minimax/` (`adapter.ts`, `run.ts`, `model-select.ts`, `cdp.ts`, `dom.ts`, `selectors.ts`, `instance.ts`, `session.ts`, `workspace.ts`, `dialog.ts`, `model.ts`, `liveness.ts`, `recovery.ts`, `fixplan.ts`, `discovery.ts`)
- Profile: `minimax` in `src/agents/builtin.ts` (`adapter: minimax-gui`)
- Status: `ready` on Windows; `research` on macOS (native folder dialog is fail-closed; dispatch refused)
- Read-only diagnostic probe: `scripts/probe-minimax.mjs`
- Real-machine evidence: Windows 10.0.19045 / MiniMax Code 3.1.0 / Electron 42.8.0 / Chromium 148.0.7778.280 (2026-10-05)

---

## 1. Installation and launch

| Item | Value | Source |
|---|---|---|
| Executable | `D:\MiniMax-Code\MiniMax Code\MiniMax Code.exe` | On-disk measurement (232 MB) |
| Packaging | Plain Electron install (not MSIX) | `LICENSE.electron.txt` + `resources/app.asar` |
| Version | 3.1.0 (file version 3.1.0.170) | CDP `/json/version` UA: `MiniMax/3.1.0` |
| Launch method | `--remote-debugging-port=9999` takes effect **immediately** | Verified: `/json/version` returns 200 |
| User data dir | `%APPDATA%\MiniMax` (config `minimax-agent-cn-config.json`) | On-disk measurement |

The CDP base port is **9999** (range 9999–10008), which does not overlap the existing 9222 (TraeWork) / 9333 (ZCode, Codex) / 9666 (Kimi Code) / 9777 (Qoder) / 9889 (Open Design).

Discovery order (no hard-coded user absolute paths in source):
**explicit `gui.exePath` → fixed-drive relative path templates (`preferredDrives: ["D:"]` first) → uninstall registry `InstallLocation` → standard install dirs → PATH**.

```bash
node scripts/probe-minimax.mjs install      # prints executable path / source / version
```

---

## 2. Dual renderer processes (key structure)

MiniMax Code is a **dual renderer process** app; a single CDP port exposes three page targets:

| Window | title | url | Purpose |
|---|---|---|---|
| Main | `MiniMax Code` | `app://./archon` | Sidebar / project groups / sessions / composer / input / send button |
| **Model popup** | `Model menu` | `.../resources/app.asar/dist/model-menu/index.html` | Model list + **hover-expanded submenu** (reasoning level / context window) |
| Helper page | `Rsbuild App` | `.../react-screenshots/dist/electron.html` | Unrelated, must be filtered out |

**How to disprove** (reproducible): after clicking `model-selector-trigger` in the main window, the main window's `data-testid` count **stays 58** (0 new), `role="group"` count is **0**, `role="menuitemradio"` count is **0**, and `innerText` contains no "推理等级"; meanwhile `/json/list` shows a `Model menu` target.

The adapter therefore holds **two** CDP clients: the main window converges by targetRank, while the popup is connected lazily (rank only accepts `dist/model-menu/`).

---

## 3. Reasoning level and context window live in a **second-level submenu**

> This is the adapter's most important real-machine correction: the product's own frontend artifacts show these as flat `role="group"` elements, but the **live DOM only renders them after hovering a model row**.

**Interaction sequence** (`src/agents/minimax/model-select.ts`):

1. Open the model menu (click `model-selector-trigger` in the main window → the popup window shows candidates);
2. **Hover** a model row carrying `aria-haspopup="menu"` → `aria-expanded` becomes `"true"` → a second `role="menu"` appears;
3. Only inside that submenu do `role="group"[aria-label="推理等级"]` and `[data-testid="model-context-control"]` exist;
4. Pick the reasoning level first, then the context window;
5. **Finally** click the model row to commit (clicking it immediately closes the menu, so it must come last).

**Two disciplines that must be observed**:

- **Move the pointer away before hovering**: the submenu container is **reused**; moving straight in does not fire `mouseenter`, so the DOM keeps the **previously hovered model's** tier/window groups — picking a tier from it selects another model's set (observed on the real machine).
- **Candidate reads must be scoped to the owning model**: the submenu root's `aria-label` is exactly the target model name (the top level is "选择模型"), and the adapter filters by it (`cdp.effortOptions(model)` / `cdp.contextOptions(model)`). Checking merely "a group exists" reads stale DOM.

### 3.1 Sets vary per model (measured)

| Model | Submenu | Reasoning levels | Context windows |
|---|---|---|---|
| `M3.1-Flash-Preview` | yes | `default` / `low` / `medium` / `high` / `xhigh` / `max` | `512K` / `1M` (1M tagged "higher usage") |
| `M3` | yes | **no such group** | `512K` / `1M` |
| `deepseek-v4.1-flash` | yes | `low` / `high` / `max` | **no such group** |
| `M2.7-highspeed` / `M2.7` | **none** | — | — |

```bash
node scripts/probe-minimax.mjs submenu      # hover each model and print its tier/window candidates (hover only, no clicks)
```

### 3.2 fail-closed boundaries

- Requesting `reasoningLevel` / `contextWindow` on a model with **no submenu** → **error before sending**; never silently keeps the UI's current value;
- Target value absent from the UI candidates → error listing the actual candidates;
- Tier set unreadable (submenu not expanded / selector drift) → error (`refusing to guess the tier`); never guesses from a built-in list;
- Everything is **read back** after selection: the reasoning level comes from the trigger's second line (same source as `aria-checked`), the context window from `aria-checked`; a mismatch is fail-closed.

---

## 4. Trigger text shapes

Two shapes were measured:

- **Single line** = model name (e.g. `M2.7-highspeed`);
- **Two lines** = model name + tier (e.g. `"M3.1-Flash-Preview\ndefault"`).

So `parseTriggerValue` **splits on newlines**, not on spaces or middle dots (Kimi Code uses `·`; this product does not). Model names contain dots and hyphens (`M3.1-Flash-Preview`) and must not be split on spaces.

---

## 5. Main-window selectors (measured highlights)

58 `data-testid` values (full list in `docs/minimax-evidence/main-window-testids.txt`). Keys used by the driver chain:

| Meaning | Selector | **Gotcha** |
|---|---|---|
| New task | `[data-testid="sidebar-shortcut-task.new"]` | The testid sits on a **`<kbd>`** (showing Ctrl+N); the clickable element is its ancestor `button[aria-label="新建任务"]` — `closest('button')` is required |
| Input | `[data-testid="message-textarea"]` | **tiptap ProseMirror** (`div.tiptap.ProseMirror[contenteditable=true]`). `Input.insertText` works; **after clearing, innerHTML keeps an empty `is-empty` paragraph** (innerText is an empty string) → emptiness is judged via `innerText.trim()` |
| Send button | `[data-testid="send-button"]` | It is a **DIV** (not a `<button>`). Usability comes from **`aria-disabled`** (empty input `"true"`, content `null`); there is **no `disabled` property** (`e.disabled` is always undefined) |
| Stop button | `[data-testid="stop-button"]` | Authoritative run signal. Extracted from the product artifact `app.asar` (not re-sampled in the post-send state) |
| Model trigger | `[data-testid="model-selector-trigger"]` | Text = current model (+ tier); the popup opens in a **separate window** |
| Permission trigger | `[data-testid="permission-mode-trigger"]` / `permission-mode-label` | Text measured as "始终授权"; its menu is an **ant-dropdown inside the main window** (not a separate window) |
| Project trigger | `[data-testid="project-selector-trigger"]` | Text = current project name (measured `.appdata`) |
| Project group | `[data-testid="sidebar-session-group"]` | **`data-workspace-dir` = full absolute path** → the **authoritative** project-binding criterion |
| New project | `[data-testid="sidebar-create-project-trigger"]` | Triggers the native `Select Directory` dialog |

---

## 6. Project binding

The **authoritative criterion** is a sidebar group's `data-workspace-dir` (measured `D:\Trae项目\tianshu-mcp`), compared as a **normalised full path** (drive letter uppercased + separators unified + path body case-folded); names are only a fallback. Identical names under different directories are `ambiguous` and fail-closed.

Measured caveat: **creating a new task does not clear the project** (it stays on the previous project) — so every dispatch re-verifies and re-binds explicitly.

When the project is absent from the sidebar, the adapter goes through "New project" → the native **`Select Directory`** dialog:

| Control | Criterion |
|---|---|
| Window | Class `#32770`, title **`Select Directory`** (stays English even on a Chinese UI) |
| Path edit | `AutomationId=1152` + `ClassName=Edit` (ControlType is **Pane**, no ValuePattern) → Win32 `WM_SETTEXT` only |
| Confirm | `AutomationId=1` + `Name=Select` (no UIA `InvokePattern`) → coordinate click required |
| Cancel | `AutomationId=2` |

The path is written with `WM_SETTEXT` and **immediately read back with `WM_GETTEXT`**; a mismatch never confirms. The path reaches the script only via environment variables (never interpolated into source), so CJK survives console code pages.

```bash
node scripts/probe-minimax.mjs projects     # print sidebar project groups (full paths)
node scripts/probe-minimax.mjs dialogs      # enumerate owned #32770 windows
```

---

## 7. Run detection (three signals)

| Signal | Criterion | Notes |
|---|---|---|
| Stop button | `[data-testid="stop-button"]` visible | **Authoritative** (artifact-extracted; not re-sampled post-send → degrades automatically) |
| Failure | Conversation text matches `请求失败` / `网络异常` / `provider.*` / `HTTP 4xx` | Yields `failed`; **never** a completion |
| Text stability | Identical text hash across `stableRounds` polls | Completion criterion; **"N seconds of no change" is never sufficient alone** |

**The send button's two states are deliberately not a run signal**: it has only an `aria-disabled` pair, and both "empty input" and "sent, awaiting reply" disable it — indistinguishable from the button itself. Treating it as a run signal would make every task run forever after sending. When all stop-button selectors fail, the stability window still converges (just `stableRounds` slower) — an intentional **slow but not wrong** trade-off.

Deadlock breaker: the stop button stays visible while text is stalled beyond `stallTimeoutMs` → `needs_user` (resumable via `continue_task`).

**Waiting for the user** (question detection) is **off by default** and only enabled when the profile explicitly configures `gui.selectors.userGate` — the heuristic is deliberately conservative (no run signal + empty input + changed text + trailing question mark). A missed detection falls back to `idle_timeout`; a false positive would feed the user's confirmation text back to the model as an answer on resume.

```bash
node scripts/probe-minimax.mjs liveness     # print one run-signal snapshot
```

---

## 8. Resume semantics

`run_task`'s `resume` dispatches by kind (same shape as Kimi Code / ZCode):

| Kind | Behaviour |
|---|---|
| `continue` + `agent_question` | Locate the original session → send the **answer** in the input (never resends the task brief) |
| `continue` + `user_confirmation` | **Reconnect and observe** to a terminal state (sends nothing) |
| Environment kinds (`login_required` / `close_existing_instance` / `setup_recovery` / `system_permission`) | Re-check the environment, then dispatch **fresh with the full task brief** (the user's confirmation text is never sent to the model) |
| `rework` | Locate the original session → re-read project/model → send the rework message |

**Locating the original session is mandatory; failure is a hard `session_lost` — the adapter never falls back to opening the "most recent session".**

Session anchor: MiniMax Code's session rows **carry no explicit id attribute**, so the anchor is "project path + session title" (`minimaxSessionId` / `minimaxSessionTitle` are stored in their own slots, never mixed with zcode/kimicode).

---

## 9. Parameters

| Parameter | Scope | Notes |
|---|---|---|
| `model` | minimax | **Required** (this product has no "default model" semantics). Exact match (`M3` and `M3.1-Flash-Preview` must be distinguished) |
| `reasoningLevel` | minimax | `default` / `低·low` / `中·medium` / `高·high` / `极高·xhigh` / `最大·max` (**`medium` is valid** — a key difference from Kimi Code) |
| `contextWindow` | **minimax only** | UI candidate text (e.g. `512K` / `1M`). Deliberately a loose string: candidates vary per model, and a hard-coded enum would reject valid values |
| `mode` / `designDirection` | not applicable | Explicitly passing them is an error |

Passing `contextWindow` for a non-minimax dispatch is rejected (`contextWindow 是 MiniMax Code 专用参数`) — never silently ignored.

---

## 10. Rework and repair plan

When verification fails, tianshu-mcp generates a repair/optimisation plan under the **project root** at `.minimax/plans/minimax-fix-r<N>.md` (one file per round, never overwritten) and writes its filename into the rework prompt (`buildMinimaxFixPrompt`). Placing it under the project root is deliberate: the agent must be able to read it — writing it to the task data directory produces "I told you to read the plan, you say you can't find it".

`defaultAutoFixRounds: 2` (overridable in the profile).

---

## 11. Known limitations

| Item | Status |
|---|---|
| macOS | `research`: the native folder dialog is fail-closed; **dispatch refused** |
| `stop-button` post-send state | Extracted from the product artifact; not re-sampled after sending. When missing, the three signals degrade automatically (affects convergence speed, not correctness) |
| Question detection | No measured sample (account quota prevented producing a question flow); off by default, conservative heuristic |
| Failure-retry button selector | **Not built in** (unverified); only the failure-text regex backs it up |
| Automatic permission-mode switching | The permission menu candidates are **not sampled**, so the adapter only reads back and compares (warns on mismatch) instead of switching |
| Version gate | **None**: there is no `resources/*-config.json` version file, and the version is only readable from the CDP UA (which is exactly what is unavailable when driving fails). Drift is caught by `selector_drift` — a diagnosable failure |

---

## 12. Evidence and reproduction

```bash
# 1) Launch with CDP enabled
"D:\MiniMax-Code\MiniMax Code\MiniMax Code.exe" --remote-debugging-port=9999

# 2) Run the read-only diagnostic probe (requires npm run build first)
npm run build
npm run probe:minimax             # all commands
npm run probe:minimax submenu     # only the second-level submenu candidates
```

| File | Content |
|---|---|
| `docs/minimax-evidence/main-window-testids.txt` | The 58 measured `data-testid` values of the main window |
| `docs/minimax-evidence/model-menu-structure.txt` | `Model menu` artifact structure (role/testid extraction) |
| `docs/minimax-evidence/model-menu-snippets.txt` | Key popup artifact snippets (including i18n ground truth) |
| `scripts/probe-minimax.mjs` | Read-only diagnostic probe (reproduces every conclusion in this document) |
