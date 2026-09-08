---
name: verify
description: Verify code changes in this repo on the right real surface. Use when the user asks to verify, test, self-test, prove something works, or when implementation is complete and verification is still needed. For `apps/desktop`, choose the correct Electron Playwright lane (`core`, `live`, or `native`), use the shared desktop helpers, and scale from targeted specs to full lanes according to change risk.
---

# Verify

## Overview

Prove the change works on the closest real user surface available.

For this repo, verification starts by mapping changed files to the correct package, scripts, and runtime surface instead of defaulting to the broadest or easiest test.

## Workflow

1. Read the closest instruction files first.
2. Inspect the changed files and map them to the affected package and user surface.
3. Read the current package scripts instead of assuming command names from memory.
4. Run the smallest convincing proof first while iterating.
5. Expand verification only when the changed surface or observed failures justify it.
6. Report what was verified, on which surface, and any blockers that prevented stronger proof.

## Repo Map

- Root rules: `AGENTS.md`
- Desktop package: `apps/desktop/AGENTS.md`
- Desktop test-specific rules: `apps/desktop/tests/AGENTS.md`
- Desktop lane/setup docs: `apps/desktop/README.md`
- Desktop command source of truth: `apps/desktop/package.json`

## Desktop Verification

If changed files are under `apps/desktop`, read:

- `apps/desktop/package.json`
- `apps/desktop/README.md`
- `apps/desktop/tests/AGENTS.md`

Choose the smallest lane that matches the changed surface:

- `core`
  Background-friendly in-window Electron behavior. Default for renderer, sidebar, composer, persistence, settings, skills, and worktree UI changes.
- `live`
  Real provider/runtime behavior. Use when the change depends on actual runs, transcript/tool items, parallel execution, or notifications.
- `native`
  macOS OS-surface behavior such as pickers or real clipboard paste. Foreground-only and focus-sensitive.

Use targeted specs while iterating and, for narrow changes, as the default closing proof. A targeted Electron spec is real-surface verification; it does not need a full-lane rerun merely because it belongs to `core` or `live`.

Scale desktop verification by blast radius:

- Narrow feature or regression fix: run the directly affected spec or tests, plus package typecheck or unit coverage when relevant.
- Change shared by several related features: run the affected specs together and add `tests/core/smoke.spec.ts` when startup or basic thread creation could regress.
- Lane-wide or high-risk change: run the full owning lane. This includes changes to `playwright.config.ts`, `tests/helpers/electron-app.ts`, Electron app bootstrap/preload, shared persistence or state schemas, cross-feature navigation, or multiple unrelated desktop surfaces.
- Release candidate or CI gate: run the full lane required by the release/CI workflow.

For `native`, keep the targeted native spec as the default and expand to the full native lane only when the change touches shared native helpers, multiple native specs, or lane-wide native behavior.

Prefer shared helpers in `apps/desktop/tests/helpers/electron-app.ts`.
Do not add IPC/state shortcuts for visible behavior unless the product surface does not exist yet.

## Non-Desktop Verification

For other packages, inspect the nearest `package.json`, test config, and path-scoped instructions.
Prefer package-local typecheck and test commands over repo-wide sweeps when the change is narrow.

## What To Report

- Exact commands run
- Which surface was verified
- What user action or scenario was exercised
- What visible or concrete result was observed
- Any stronger proof that was blocked, and why

## Gotchas

- Do not stop at `pnpm test` when the changed surface is `apps/desktop`; choose the correct Electron lane explicitly.
- Do not turn the full `core` lane into a default closing ritual. It is a 200+ test serial regression gate; reserve it for broad changes, CI, and release confidence.
- Do not claim broad lane confidence from a targeted spec. Report the exact covered scenario and why that scope matches the change.
- Do not treat `native` failures as automatic product regressions. Foreground focus, picker timing, and macOS Accessibility can invalidate the run.
- Do not force the full `native` lane for every native-adjacent change. Unrelated picker failures can hide whether the changed native surface actually works.
- Do not add new desktop harnesses when `apps/desktop/tests/helpers/electron-app.ts` can be extended instead.
- Do not claim real-surface proof if the test only exercised IPC, store state, or other internal plumbing.
- Do not hard-code unstable UI details in assertions when behavior or state proves the same thing more robustly.

## Close Condition

Do not call the work verified until the strongest practical proof for the changed surface has passed, or the blocker is explicit and concrete.
