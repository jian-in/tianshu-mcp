# v0.7.2 — Fix a cross-platform CI coupling (aligning tag / Release / npm)

> See [CHANGELOG](../CHANGELOG.en.md#072---2026-09-28).

## Background

`v0.7.1`'s **npm package is published and its `dist` is correct**, but the commit its tag pointed at
had a red CI, so the `Release` workflow's "Require successful CI for this commit" gate refused to
publish — leaving the inconsistency "npm has it, GitHub has no release". This release fixes the root
cause and re-issues so the three converge.

## Fixed

- **CI failed on every ubuntu / macOS leg** (`test/unit/opendesign-discovery.test.ts`): the
  `DevToolsActivePort` candidate-path case injected only `APPDATA`, while production's
  `devToolsActivePortPaths` **keys the base directory off the host platform** (win32 uses `APPDATA`,
  others use `HOME/Library/Application Support`) — so on ubuntu/macOS the base went down the `HOME`
  branch and the assertion could never match.

  This is the **third occurrence of the same family** (the earlier two were `discoverOpenDesign`'s
  candidate paths and the version read-back); the common trait is "assertions coupled to the host
  platform, passing on only one class of machine". Fix: the case injects the platform-appropriate env
  and derives the matching expectation, sharing production's source of truth.

## Impact

| | `v0.7.1` | `v0.7.2` |
|---|---|---|
| npm package | published, `dist` correct | published |
| tag | points at a CI-failing commit | points at a CI-passing commit |
| GitHub Release | could not be created | created by the workflow |

## Note

`v0.7.1` and `v0.7.2` have **identical runtime code**; the only difference is test files.
If you already installed `0.7.1` there is no functional reason to upgrade — this release exists to
align tag / Release / npm on a single commit.
