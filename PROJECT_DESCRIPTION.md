# PROJECT_DESCRIPTION.md: pi-frame

> **Target Audience**: AI Coding Agents (Claude, Gemini, GPT/Codex, Cursor, Windsurf) and Human Engineers.
> **Purpose**: Master onboarding, architecture reference, and contextual foundation for developing, debugging, and extending the `pi-frame` codebase.

---

## 1. Executive Summary

**pi-frame** is a high-performance, Codex-style native desktop workspace for the [`pi`](https://github.com/earendil-works/pi) coding agent. It packages long-running agent workflows into a modern, multi-window Electron application without replacing, forking, or diverging from the upstream `pi` agent runtime.

### Key Capabilities
- **Conversation-First Workspace**: Persistent multi-threaded timelines, collapsible tool execution blocks, prompt queuing, transcript search, and crash resilience.
- **Collision-Free Parallel Execution**: Simultaneous agent tasks running across isolated Git worktrees, thread branching, and multi-agent coordination.
- **Contextual Code Review**: Integrated xterm.js terminal, visual file diffs (inline and side-by-side), file staging/unstaging, and `@` file mentions.
- **Browser & DevTools Automation**: Embedded Chromium browser for agent-driven web navigation, DOM inspection, and visual validation.
- **Computer Use Automation**: Background and foreground OS-level automation for macOS and Windows with focus preservation and locked-screen safety.
- **Offline Voice Input**: Local voice-to-text prompt transcription powered by Sherpa-ONNX.
- **100% Upstream Compatible**: Direct interoperability with `pi` JSONL sessions, custom providers (Anthropic, OpenAI, OpenRouter, Ollama, DeepSeek, etc.), skills, and extensions.

---

## 2. Lineage & Ethical Attribution

`pi-frame` is built upon the contributions of the open-source community:

1. **[`pi-gui`](https://github.com/minghinmatthewlam/pi-gui)**
   - *Creator*: **Matthew Lam** ([@minghinmatthewlam](https://github.com/minghinmatthewlam))
   - *Contribution*: Established the foundational Electron desktop architecture, UI timeline layout, state contracts, and initial session interaction patterns for `pi`.
2. **[`pi-desktop`](https://github.com/mshen6666/pi-desktop)**
   - *Creator*: **mshen6666** ([@mshen6666](https://github.com/mshen6666))
   - *Contribution*: Evolved the project with Windows Computer Use desktop automation, offline voice recognition, Git worktree orchestration, and release packaging pipelines.
3. **[`pi`](https://github.com/earendil-works/pi)**
   - *Creator*: **Earendil Works** ([@earendil-works](https://github.com/earendil-works))
   - *Contribution*: The core AI coding agent runtime (`@earendil-works/pi-coding-agent`), tool protocols, provider APIs, and skill system.

`pi-frame` maintains clear attribution under the **MIT License** and preserves backward compatibility with upstream session and provider formats.

---

## 3. Monorepo Structure & Package Inventory

The repository is managed as a `pnpm` workspace (`pnpm@10.25.0`) with TypeScript:

```text
PI-FRAME/
├── apps/
│   ├── desktop/                 # Primary Electron application
│   │   ├── electron/            # Main process, preload bridge, background services
│   │   ├── src/                 # React 19 renderer process (UI, state, views)
│   │   ├── tests/               # Playwright E2E test suites (core, live, native, prod)
│   │   ├── scripts/             # Build, packaging, and helper scripts
│   │   └── package.json         # @pi-frame/desktop
│   └── website/                 # Marketing and documentation website (Next.js)
│       └── package.json         # @pi-frame/website
├── packages/
│   ├── session-driver/          # Durable session types, events, and driver contracts
│   │   └── package.json         # @pi-frame/session-driver
│   ├── pi-sdk-driver/           # Thin adapter bridging @earendil-works/pi-coding-agent
│   │   └── package.json         # @pi-frame/pi-sdk-driver
│   └── catalogs/                # Workspace, session, and metadata catalog management
│       └── package.json         # @pi-frame/catalogs
├── scripts/                     # Monorepo-level test, release, and packaging automation
├── tools/                       # Platform-specific utilities and build shims
├── docs/                        # Architecture documentation, design plans, and assets
├── plans/                       # Task implementation plans and technical specifications
├── AGENTS.md                    # Core instructions and behavioral rules for AI agents
├── CONTRIBUTING.md               # Contributor guide and PR requirements
├── LICENSE                      # MIT License with full attribution
├── package.json                 # Monorepo root package.json
└── pnpm-workspace.yaml          # pnpm workspace definition
```

---

## 4. System Architecture & Boundaries

```
 ┌──────────────────────────────────────────────────────────────┐
 │                     Renderer Process (React 19)              │
 │  - Timelines, Composer, Worktrees, Diffs, Terminal   │
 └──────────────────────────────┬───────────────────────────────┘
                                │ Typed IPC (window.electronAPI)
 ┌──────────────────────────────▼───────────────────────────────┐
 │                   Preload Script (Bridge Layer)              │
 │  - Context isolation enabled, strictly typed IPC channels    │
 └──────────────────────────────┬───────────────────────────────┘
                                │ IPC Handlers (app-store.ts)
 ┌──────────────────────────────▼───────────────────────────────┐
 │                     Electron Main Process                    │
 │  - Window Lifecycle, Worktree Manager, MCP, Native Dialogs   │
 └──────────────┬───────────────────────────────┬───────────────┘
                │                               │
 ┌──────────────▼──────────────┐ ┌──────────────▼───────────────┐
 │   packages/session-driver   │ │   packages/pi-sdk-driver     │
 │  - State & Event Contracts  │ │  - SessionSupervisor        │
 │  - Lease Management         │ │  - RuntimeSupervisor        │
 └─────────────────────────────┘ └──────────────┬───────────────┘
                                                │ Calls upstream SDK
                                 ┌──────────────▼───────────────┐
                                 │ @earendil-works/             │
                                 │ pi-coding-agent              │
                                 │  - Core Agent Execution Loop │
                                 │  - JSONL Session Storage     │
                                 └──────────────────────────────┘
```

### Critical Architectural Invariants

1. **Strict Renderer/Preload/Main Boundary**:
   - The React renderer runs with `contextIsolation: true` and `nodeIntegration: false`.
   - The renderer **never** imports Node.js built-ins (`fs`, `child_process`, `path`, etc.) or `@earendil-works/*` packages directly.
   - All renderer communication flows through typed methods on `window.electronAPI` exposed via `apps/desktop/electron/preload.ts`.

2. **Thin `pi-sdk-driver` Layer**:
   - `packages/pi-sdk-driver` is an adapter over `@earendil-works/pi-coding-agent`.
   - Never fork, duplicate, or reimplement the core agent execution loop, tool execution, or model dispatch logic. Use the official SDK APIs.

3. **JSONL as Single Source of Truth**:
   - All session transcripts are persisted in standard `pi` `.jsonl` files within `.pi/` directories.
   - In-memory catalogs and UI state are views over these durable transcripts.

4. **Durable Session Leases**:
   - `session-lease.ts` prevents multiple runtime supervisors or windows from concurrently writing to the same session file.

---

## 5. Core Subsystems Deep Dive

### 5.1. Session Management & Timeline
- **Supervisor**: `SessionSupervisor` in `packages/pi-sdk-driver` manages live agent streaming, tool output rendering, prompt queuing, model switching, and session pause/abort.
- **Events**: Events flow from the agent loop -> `SessionSupervisor` -> Electron Main IPC -> React state store (`app-store-session-state.ts`).
- **Resilience**: Full support for session forking, rollbacks to previous steps, and automatic session restoration upon app restart.

### 5.2. Git Worktree Isolation
- Managed by `apps/desktop/electron/worktree-manager.ts`.
- Allows users to create **Local** threads (running directly in the workspace root) or **Worktree** threads (running in an isolated Git worktree under `.claude/worktrees/` or `.codex/worktrees/`).
- Prevents file collisions when running multiple agents in parallel on different features.

### 5.3. Visual Diff & File Review
- Computes real-time Git diffs against `HEAD` or target branches.
- Provides unified and split diff viewers, hunk-level staging/unstaging, and direct file editing.

### 5.4. Integrated Terminal
- Embeds `xterm.js` backed by `node-pty` in the Electron main process.
- Synchronized working directory with the active thread's workspace or worktree path.

### 5.5. Browser & DevTools Automation
- Embedded Chromium webview controlled via Chrome DevTools Protocol (CDP).
- Allows agents to navigate URLs, inspect DOM trees, capture element screenshots, and execute client-side JavaScript.

### 5.6. Computer Use Automation
- Supports native desktop automation on macOS (via Accessibility APIs) and Windows (via UI Automation / Win32 APIs).
- Focus-safe background probes prevent disruptive foreground stealing.
- Strict safety guards: coordinate fallback rejections, target-focus confirmation, and locked-screen protocols.


### 5.7. Voice Input
- Local, offline speech-to-text powered by Sherpa-ONNX.
- Supports voice prompting directly into the composer.

---

## 6. Technology Stack

| Layer | Technologies |
| --- | --- |
| **Runtime & Monorepo** | Node.js 20+, TypeScript 5.9+, pnpm 10.25.0 |
| **Desktop Framework** | Electron 35+, electron-vite, electron-builder |
| **Frontend UI** | React 19, Tailwind CSS, Lucide Icons, Radix UI |
| **Terminal & Editor** | xterm.js, node-pty, Monaco/Diff viewers |
| **3D & Graphics** | CSS, SVG, Canvas |
| **Audio & Speech** | Sherpa-ONNX, Web Audio API |
| **Testing** | Playwright (Electron fixture), Node Test Runner |

---

## 7. Setup & Development Guide

### Prerequisites
- **Node.js**: 20.x or higher
- **pnpm**: 10.25.0 (`corepack enable && corepack prepare pnpm@10.25.0 --activate`)

### Standard Workflow

```bash
# 1. Install dependencies
pnpm install

# 2. Run the desktop app in development mode (hot-reloading enabled)
pnpm dev

# 3. Typecheck all packages
pnpm typecheck

# 4. Lint codebase
pnpm lint

# 5. Build all packages and desktop app
pnpm build
```

### Packaging Commands

```bash
pnpm package:win     # Package Windows NSIS setup installer & portable executable
pnpm package:win:dir # Build unpacked Windows directory (fast local iteration)
pnpm package:mac     # Package macOS DMG and ZIP
pnpm package:linux   # Package Linux AppImage
```

---

## 8. Testing Strategy & Playwright Test Lanes

Testing runs against the **real Electron application surface** using Playwright.

### Test Lanes

| Lane | Command | Description & Scope |
| --- | --- | --- |
| **`core`** | `pnpm --filter @pi-frame/desktop run test:e2e:core` | **Default Lane**. Background-friendly in-window UI tests (threads, composer, settings, sidebar, persistence, worktrees). |
| **`live`** | `pnpm --filter @pi-frame/desktop run test:e2e:live` | Real agent execution and tool-calling flows against AI providers. |
| **`native`** | `pnpm --filter @pi-frame/desktop run test:e2e:native` | Focus-sensitive OS dialogs (file pickers, clipboard paste, notifications). |
| **`production`** | `pnpm --filter @pi-frame/desktop run test:prod:*` | Packaged app launch, installer smokes, real-auth verification. |

### Running Targeted Tests
Always prefer targeted specs during development rather than running all lanes:
```bash
# Test worktree UI
pnpm --filter @pi-frame/desktop run test:core:worktrees

# Test session persistence
pnpm --filter @pi-frame/desktop run test:core:persistence

# Run specific Playwright file
pnpm --filter @pi-frame/desktop run test:e2e:runner -- apps/desktop/tests/core/composer-controls.spec.ts
```

---

## 9. Golden Rules for AI Coding Agents

When working on this repository, all AI agents **MUST** follow these rules:

1. **Verify on the Real Electron Surface**: Unit tests alone are insufficient for desktop UX. Validate UI and state changes against the appropriate Playwright test lane.
2. **Preserve Security Boundaries**: Never expose Node.js `fs`, `child_process`, or internal system APIs directly to the React renderer. Always go through `apps/desktop/electron/preload.ts` and validate IPC inputs in the main process.
3. **Keep `pi-sdk-driver` Thin**: Do not duplicate upstream `pi` logic. Wrap and adapt `@earendil-works/pi-coding-agent`.
4. **Never Destroy User Data**: Never delete `.pi/` session files, transcripts, or user worktrees without explicit instruction.
5. **No Regressions on Test Lanes**: Before closing a task, ensure `pnpm typecheck` passes and affected Playwright specs pass cleanly.
6. **Maintain Ethical Lineage**: Preserve all license notices and attributions to `pi-gui`, `pi-desktop`, and `pi`.
