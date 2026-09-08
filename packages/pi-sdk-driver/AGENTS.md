# Driver Guidelines

Apply these rules for changes under `packages/pi-sdk-driver/`.

- Keep this package a thin compatibility layer over `pi-mono`; reuse `pi` session/runtime behavior instead of reimplementing it.
- Preserve event ordering and per-session isolation; desktop parallel sessions must not bleed state across sessions.
- Keep the live-event queue bounded and recoverable. Content deltas must remain exact and ordered, while redundant metadata snapshots and catalog writes should be coalesced off the per-token path.
- Do not await atomic catalog persistence for every assistant or tool delta. Persist at safe lifecycle boundaries or through a trailing flush, and force completion before close, shutdown, or any transition that requires durable metadata.
- Treat session config as session-local unless `pi` itself defines broader scope.
- Preserve durable session leases; never allow two runtimes or windows to write the same JSONL concurrently.
- Prefer cache-first desktop reopen behavior; raw session-log reprocessing is a fallback, not the default path.
- Don’t pull desktop-only presentation concerns into driver contracts unless they are required for correctness.
- Performance instrumentation must expose only timings, counts, payload sizes, queue depth, and sequence metadata; never prompt, transcript, tool-output, auth, or attachment content.
