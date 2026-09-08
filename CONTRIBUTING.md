# Contributing to pi-frame

Thanks for your interest in contributing to **pi-frame**. This guide covers local setup, test lanes, architectural principles, and what "done" means for a change.

For a comprehensive technical overview and architecture guide, please also read [PROJECT_DESCRIPTION.md](./PROJECT_DESCRIPTION.md).

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) 10.25.0, managed through `corepack`

```bash
corepack enable
pnpm install
```

## Development Loop

```bash
pnpm dev         # Run the desktop app with hot reload (electron-vite)
pnpm typecheck   # Type-check all packages and apps
pnpm lint        # Lint all workspaces
pnpm build       # Build all workspaces
```

`pnpm dev` automatically builds workspace packages up front and runs them in watch mode, ensuring package-level changes are reflected without manual rebuilds.

## Testing

Use `pnpm test` during development. It inspects uncommitted Git changes and runs the closest package or desktop specs; use `pnpm test:changed:list` to preview the selection. Run `pnpm test:all` for the complete default regression suite before finishing changes or packaging.

Desktop end-to-end tests run against a real Electron build using Playwright, split into distinct lanes:

- `core` — Background-friendly Electron behavior (in-window UI, session persistence, composer, settings, sidebar, worktrees).
- `live` — Exercises live agent execution against providers; requires valid `pi` credentials/auth.
- `native` — Foreground and OS-integration behaviors (file dialogs, folder pickers, clipboard paste, attachments).
- `production` — Opt-in packaging smokes, real-auth verification, and release artifact checks.

```bash
pnpm test                                          # Tests mapped to uncommitted changes
pnpm test:all                                      # Complete default regression suite
pnpm --filter @pi-frame/desktop run test:e2e:all   # Run core + live + native lanes
```

See [`apps/desktop/README.md`](./apps/desktop/README.md) for detailed lane maps and platform-specific packaging instructions.

## Expectations for a Change

- **Verify on the real Electron surface.** Desktop changes must be confirmed on the actual Electron application, not only via isolated unit tests. Session correctness, transcript integrity, and Codex-style ergonomics are core product requirements.
- **Keep the renderer/main/preload boundary tight.** Do not expose broad Node.js primitives to the renderer. Use strictly typed IPC channels defined in the preload bridge.
- **Keep `pi-sdk-driver` thin.** `pi-sdk-driver` is an adapter over `@earendil-works/pi-coding-agent`. Do not fork or reimplement core `pi` runtime behavior.
- **Preserve session and user safety.** Never delete user session history, cached transcripts, or worktree artifacts without explicit approval.
- **Make focused checkpoints.** Keep commits and PRs focused on a single concern with clear verification notes.

Repo-wide guidelines live in [`AGENTS.md`](./AGENTS.md) (with `CLAUDE.md` maintained as a symlink). Path-scoped guidelines live in nested `AGENTS.md` files.

## Pull Requests

- Clearly describe what changed and the exact verification steps taken (including Playwright specs executed).
- Ensure `pnpm typecheck`, `pnpm lint`, and the relevant test lanes pass cleanly.
- Keep unrelated changes out of the pull request.

## License & Attribution

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE). All contributions must respect and preserve the attributions to `pi-gui`, `pi-desktop`, and the `pi` coding agent.
