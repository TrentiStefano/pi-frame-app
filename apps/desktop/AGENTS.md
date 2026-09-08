# Desktop Guidelines

Apply these rules for changes under `apps/desktop/`.

- Preserve Codex-style information architecture and polish; avoid generic dashboard UI.
- Treat Windows and macOS as real desktop targets. Verify platform-specific work on its target OS; Linux CI is not desktop truth for either target.
- Verify desktop changes on the real Electron surface, and prefer Playwright coverage for repeatable proofs.
- Use `apps/desktop/README.md` for lane/setup commands, and `apps/desktop/tests/AGENTS.md` for test-surface rules under the test tree.
- Keep the main pane conversation-first: transcript, tool timeline, composer, and session state are the priority.
- Don’t expose broad filesystem/process APIs through preload; add only narrow IPC needed by the renderer.
- Prefer shared helpers over duplicating Electron test harness or IPC glue.
- Keep composer and timeline behavior fast on hot paths; avoid full-state disk writes for keystrokes if a narrower path works.
- Measure streaming changes before and after on the real Electron surface. Track event-queue lag, IPC payload/rate, renderer long tasks, input latency, memory, and crashes; do not accept a subjective "feels faster" result.
- Treat response streaming as a bounded hot path. Do not perform per-token durable writes, full-state cloning, full-transcript IPC, or whole-timeline recomputation when a batched or incremental path preserves the contract.
- Batching may reduce presentation frequency, never correctness: preserve per-session order, exact final text, tool lifecycle boundaries, background-session isolation, and a forced final flush before completion, failure, close, selection, or shutdown.
- Keep diagnostics content-safe. Record timings, counts, sizes, sequence numbers, and process state; never log prompt, transcript, tool-output, credential, or attachment content for profiling.
- Streaming/stability work must prove the composer, cancel action, scrolling, session switching, and parallel background runs stay responsive under load.
