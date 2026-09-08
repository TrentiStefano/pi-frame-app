# Desktop App

Codex-style Electron shell for `pi`, with Playwright E2E coverage organized by test lane.

Windows, macOS, and Linux are supported desktop targets. Verify each platform on its real Electron or packaged surface.

## Setup

Install workspace dependencies once:

```bash
corepack enable
pnpm install
```

Build the desktop app:

```bash
pnpm --filter @pi-frame/desktop build
```

Run the app in development:

```bash
pnpm --filter @pi-frame/desktop dev
```

`dev` now runs through `electron-vite`, so renderer edits hot-update in place and Electron `main` / `preload` changes trigger the appropriate reload or restart behavior automatically. The desktop dev launcher also rebuilds the shared workspace packages up front and keeps them in watch mode so Node-side package changes can be picked up without manual rebuilds. It prefers port `5173` and automatically selects the next available port when that default is occupied; set `PI_APP_DEV_PORT` to require a specific port.

Run the built app locally without packaging:

```bash
pnpm --filter @pi-frame/desktop preview
```

Package macOS artifacts, including the native notification-permission helper:

```bash
pnpm --filter @pi-frame/desktop run package:mac
```

`package` remains an alias for `package:mac` for compatibility. Common `build` and non-macOS packaging do not build or include the Swift notification helper.

Package a Linux AppImage locally:

```bash
pnpm --filter @pi-frame/desktop run package:linux
```

Package Windows installers locally:

```bash
pnpm --filter @pi-frame/desktop run package:win
```

Unpacked Windows build (faster iteration):

```bash
pnpm --filter @pi-frame/desktop run package:win:dir
```

On Windows, `package:win*` routes through `scripts/package-windows.mjs`, which prefers the ASCII repo-local `tools/pnpm.cmd` shim, deploys a lockfile-pinned production dependency tree to avoid electron-builder's slow pnpm hoister, and redirects `ELECTRON_BUILDER_CACHE` / `LOCALAPPDATA` into `.cache/` under the repo. This avoids electron-builder failures when `pnpm` lives under a non-ASCII `%USERPROFILE%` or when Developer Mode / elevation is unavailable for winCodeSign symlink extraction. Electron and electron-builder tool downloads default to npmmirror; set `ELECTRON_MIRROR` or `ELECTRON_BUILDER_BINARIES_MIRROR` to override either source.

Live agent tests use your existing `pi` runtime and provider auth. If local `pi` runs do not work, the `live` lane will not be meaningful either.

## Test Lanes

Use the smallest lane that matches the changed surface.

- `core`
  Background-friendly Electron UI coverage. This is the default lane for renderer, sidebar, composer, persistence, settings, skills, and worktree UI behavior.

  ```bash
  pnpm --filter @pi-frame/desktop run test:e2e
  pnpm --filter @pi-frame/desktop run test:e2e:core
  ```

- `live`
  Real runtime/provider coverage. Use this when the change depends on an actual run, transcript item, tool call, or background notification.

  ```bash
  pnpm --filter @pi-frame/desktop run test:e2e:live
  ```

- `native`
  macOS OS-surface coverage such as folder pickers, image pickers, and real clipboard paste. This lane is foreground-only and can take focus.

  ```bash
  pnpm --filter @pi-frame/desktop run test:e2e:native
  ```

- `production`
  Opt-in higher-fidelity smokes that stay out of the default fast lanes. Use these for real-auth `live` checks, packaged `.app` launch, and real macOS open-panel coverage.

  ```bash
  pnpm --filter @pi-frame/desktop run test:prod:real-auth-contract
  pnpm --filter @pi-frame/desktop run test:prod:packaged-smoke
  pnpm --filter @pi-frame/desktop run test:prod:packaged-terminal
  pnpm --filter @pi-frame/desktop run test:live:computer-use
  pnpm --filter @pi-frame/desktop run test:prod:applications-relaunch
  pnpm --filter @pi-frame/desktop run test:prod:release-zip-smoke
  pnpm --filter @pi-frame/desktop run test:prod:open-folder-real
  ```

Run all desktop lanes:

```bash
pnpm --filter @pi-frame/desktop run test:e2e:all
```

For mac-first CI, use:

```bash
pnpm --filter @pi-frame/desktop run test:e2e:ci:mac
```

CI runs this complete core gate as four Playwright shards on isolated runners. Each
shard still uses one worker so that a single Electron app owns its input loop.

Linux CI validates packaging, runtime dependencies, and the existing unpacked executable via:

```bash
pnpm --filter @pi-frame/desktop run package:linux
pnpm --dir apps/desktop run verify:packaged-runtime-deps:linux
pnpm --dir apps/desktop run test:prod:packaged-release:linux:ci
```

Windows release CI validates packaging, runtime dependencies, Computer Use, and the unpacked executable via:

```bash
pnpm --filter @pi-frame/desktop run package:win:dir
pnpm --dir apps/desktop run verify:packaged-runtime-deps:windows
pnpm --dir apps/desktop run verify:packaged-computer-use:windows
pnpm --dir apps/desktop run test:prod:packaged-release:windows:ci
```

The distributable Windows build is produced by `package:win` as separate `setup-x64.exe` and `portable-x64.exe` artifacts. System notifications are guaranteed for the NSIS setup build, whose Start menu shortcut registers the app identity used by Windows notifications. The portable build remains available but notification delivery is best effort because it does not install that shortcut. Run `test:prod:packaged-windows` to launch the unpacked executable and exercise startup plus integrated terminal; `test:prod:packaged-live:win` opts into the real-auth packaged Pi conversation check. After installing the setup artifact, run `test:prod:installed-windows-smoke` to exercise the executable targeted by the Start menu and desktop shortcuts with isolated test user data.

For the Windows internal trial, an unpacked executable can be checked without installing it or touching the normal Pi user data. In PowerShell, point the production harness at the reviewed executable:

```powershell
$env:PI_APP_INSTALLED_EXE = "C:\absolute\path\to\win-unpacked\pi-frame.exe"
$env:PI_APP_VERIFY_INSTALLED_SHORTCUTS = "0"
pnpm --filter @pi-frame/desktop run test:prod:installed-windows-smoke

$env:PI_APP_REAL_AUTH = "1"
$env:PI_APP_REAL_AUTH_SOURCE_DIR = "C:\absolute\path\to\agent"
```

## Focus And Foreground Rules

- `core` and most `live` scripts set `PI_APP_TEST_MODE=background` for you. Agents normally should not set that env var manually.
- `native` scripts set `PI_APP_TEST_MODE=foreground` for you and may steal focus.
- If a native test fails, rerun it with a clean foreground window before assuming the product is broken.
- Picker tests rely on macOS Accessibility/UI scripting. If folder or image picker automation cannot type into the dialog, check system Accessibility permissions first.
- `production` open-panel coverage also relies on macOS Accessibility/UI scripting and should be run with the app kept frontmost.

## Playwright Vs Computer Use

Prefer the repo lanes first. They are deterministic, scriptable, and the right source of truth for normal development and CI.

- Use `core` when the behavior lives inside the Electron window and should stay background-friendly.
- Use `live` when you need a real run, transcript item, tool call, queued message, or other runtime-backed behavior.
- Use `native` or `production` when the surface is a real macOS dialog, picker, clipboard path, installed `.app`, or packaged release artifact.

Use manual Computer Use smoke only as a complement, not a replacement.

- Use the deterministic Playwright lanes for release-readiness sweeps and native surfaces.
- The reason to use Computer Use is product confidence, not determinism. It is useful when you want to see the real installed app behave correctly while minimizing disruption to the laptop.
- Keep Playwright as the primary regression signal. Computer Use should not replace lane coverage for `core`, `live`, `native`, or `production`, and it should not become a hidden repo dependency.
- Treat real open-folder and native file-picker checks in Computer Use as best-effort smoke coverage unless the workflow is explicitly being validated there.

## Targeted Commands

Use a targeted script while iterating and as the default closing proof for a narrow change. These scripts build the current app and exercise the named behavior on the real Electron surface, so a passing targeted spec does not require an automatic full-lane rerun.

Expand verification according to risk:

- Run the directly affected spec(s) for a local feature or regression fix.
- Add related specs and `tests/core/smoke.spec.ts` when startup, thread creation, or adjacent features could regress.
- Run the complete owning lane after changes to Playwright/shared Electron test helpers, app bootstrap or preload, shared persistence/state schemas, cross-feature navigation, or multiple unrelated surfaces.
- Keep complete lanes as CI and release gates.
- For `native`, use the targeted native spec by default and expand only for shared native infrastructure or multiple native surfaces.

```bash
pnpm --filter @pi-frame/desktop run test:core:worktrees
pnpm --filter @pi-frame/desktop run test:core:persistence
pnpm --filter @pi-frame/desktop run test:live:tool-calls
pnpm --filter @pi-frame/desktop run test:native:paste
pnpm --filter @pi-frame/desktop run test:native:open-folder
pnpm --filter @pi-frame/desktop run test:native:attach-image
pnpm --filter @pi-frame/desktop run test:prod:real-auth-contract
pnpm --filter @pi-frame/desktop run test:prod:packaged-smoke
pnpm --filter @pi-frame/desktop run test:prod:applications-relaunch
pnpm --filter @pi-frame/desktop run test:prod:release-zip-smoke
pnpm --filter @pi-frame/desktop run test:prod:open-folder-real
```

For real-auth `live` specs, opt in explicitly:

```bash
PI_APP_REAL_AUTH=1 PI_APP_REAL_AUTH_SOURCE_DIR=/absolute/path/to/agent \
  pnpm --filter @pi-frame/desktop run test:e2e:runner -- apps/desktop/tests/live/submit-run.spec.ts

PI_APP_REAL_AUTH=1 PI_APP_REAL_AUTH_SOURCE_DIR=/absolute/path/to/agent \
  pnpm --filter @pi-frame/desktop run test:e2e:runner -- apps/desktop/tests/live/tool-calls.spec.ts
```

For dev-loop verification, use:

```bash
pnpm --filter @pi-frame/desktop run test:dev:reload
```

That spec launches the app in development mode, edits isolated probe modules for renderer/Electron/shared-package wiring, and proves the running window picks up the changes.

## Test Conventions

- Shared helpers live in [`tests/helpers/electron-app.ts`](./tests/helpers/electron-app.ts). Extend them instead of adding another Electron harness.
- Prefer real clicks, typing, keyboard shortcuts, and visible assertions.
- Avoid direct IPC shortcuts for visible behavior unless the user surface does not exist yet. If you must use one, document why the surface gap exists.
- `pasteTinyPng()` drives the renderer paste handler directly and is appropriate for background-safe coverage.
- `pasteTinyPngViaClipboard()` uses Electron clipboard plus `webContents.paste()` and is appropriate for foreground/native coverage.
- `tests/production/real-auth-contract.spec.ts` proves the default non-real-auth path still seeds a temporary fake-auth agent dir and keeps real-auth coverage opt-in.
- `tests/production/packaged-smoke.spec.ts` proves the packaged `.app` bundle launches and can start a thread through the real UI.
- `tests/production/applications-relaunch.spec.ts` proves an installed copy under `/Applications` launches and relaunches with persisted state.
- `tests/production/release-zip-smoke.spec.ts` proves the packaged release ZIP can be extracted to a temp download-style path and launched through the real UI before publish.
- `tests/production/open-folder-real.spec.ts` proves the real macOS open panel can add a workspace through the empty-state button.

## Lane Map

- `tests/core`: deterministic in-window behavior
- `tests/live`: real agent/runtime behavior
- `tests/native`: macOS OS-surface behavior
- `tests/production`: opt-in higher-fidelity smokes kept out of the default lane globs

Future agents should start by reading this file, `apps/desktop/tests/AGENTS.md`, and the scripts in `apps/desktop/package.json`.
