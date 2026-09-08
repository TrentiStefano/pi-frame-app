# Repo Guidelines

These rules apply for the full session.

## Workflow
- Define success criteria before coding; if unclear, stop and clarify.
- For non-trivial work, plan verification up front with the `self-test` skill.
- Do not create or switch to new branches to start work unless the user explicitly asks; respect the current branch or worktree as intentional.
- Commit in small focused checkpoints; don’t batch unrelated changes.
- Run `simplify` before closing non-trivial implementation work.
- After a desktop release is packaged, installed, and verified, keep only the single latest release output and promptly remove older release directories, installers, portable builds, unpacked builds, and release-only logs. Never treat user sessions, cached transcripts, screenshots, or other user data as release artifacts.

## Product
- This repo is building a Codex-style desktop app for `pi`; preserve that product direction.
- Windows is a first-class desktop target. Windows-specific performance, stability, packaging, and native behavior must be proved on a real Windows Electron or packaged surface, not inferred from macOS or Linux checks.
- Desktop work is not done until it is verified on the real Electron surface, not only by unit tests.
- Transcript/timeline behavior, session correctness, and Codex-style UX are product features, not polish.
- Preserve MIT license notices and clear attribution to `pi-gui`, `pi-desktop`, and upstream `pi`.
- Prefer clean reimplementation over patching around local complexity.

## Safety
- Never delete user session history, cached transcripts, screenshots, or temp artifacts without approval.
- Treat files you didn’t edit as read-only when multiple agents may be working.
- Ask before destructive commands or history rewrites.
- If implementation work reveals a real bug outside the current scope, document it in `known_bugs.md` with severity, source evidence, impact, and reproduction or verification notes. Do not silently ignore it or expand scope without approval.

## Structure
- Prefer path-scoped guidance in nested `AGENTS.md` files over growing this file.
- Keep the desktop renderer/main/preload boundary tight; avoid broad Node exposure to the renderer.
- Keep `pi-sdk-driver` thin over `pi-mono`; don’t fork or reimplement `pi` runtime behavior unless necessary.

## Source Of Truth
- Root `AGENTS.md` is the repo instruction source of truth.
- Root `CLAUDE.md` should remain a symlink to `AGENTS.md`.
