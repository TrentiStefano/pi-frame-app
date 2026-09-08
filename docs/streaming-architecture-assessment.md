# Desktop Response Streaming Architecture Assessment

## Reason for Existence
This document explains why pi-frame response streaming falls behind terminal pi, identifies source-proven bottlenecks, and defines a safe implementation and verification plan.

**Status:** assessment complete; implementation not started by this document.
**Scope:** pi runtime events, SDK driver, Electron main/preload IPC, renderer state, React timeline, Markdown, layout, scrolling.
**Out of scope:** model/provider generation speed, visual redesign, unrelated capability/model work.
## Success Criteria
Streaming work is complete only when real Windows Electron evidence proves:
- Assistant text stays byte-exact and ordered.
- Text never crosses tool or lifecycle boundaries.
- Completion, failure, abort, selection, close, and shutdown force final flush.
- Background sessions stay isolated; one session cannot starve another.
- Renderer recovery and overflow restore authoritative state.
- Composer, cancel, scroll, session switch, and parallel runs stay responsive.
- Event-loop lag, IPC volume, long tasks, memory, and input latency beat baseline.
## Executive Finding
System processes delta stream as repeated full application/transcript snapshots. Correctness guards are strong; per-delta copying, publication, serialization, parsing, and layout are not bounded well enough.

Dominant error:
```text
one pi message_update
  -> assistantDelta + sessionUpdated
  -> sessionUpdated forces pending-delta flush
  -> full state + full selected transcript
  -> sessionUpdated publishes full state + full selected transcript again
```
Intended 30 ms batching is defeated by metadata immediately following each delta.
## Current Dataflow
```text
AgentSession
  -> SessionSupervisor map + per-session FIFO
  -> DesktopAppStore per-session FIFO
  -> append text; clone/scan transcript; rebuild derived state
  -> stream drain
       -> clone full DesktopAppState
       -> clone/project per BrowserWindow
       -> stateChanged IPC
       -> build/send full selected transcript IPC
  -> renderer RAF
  -> root React transition
  -> full timeline derivation
  -> complete active-message Markdown parse
  -> measurement + scroll correction
```
## Existing Strengths — Preserve
- Driver and AppStore enforce per-session FIFO order.
- Ordinary deltas avoid catalog writes; persistence occurs at safe boundaries.
- Terminal events flush pending stream output first.
- Renderer coalesces pushed payloads through `requestAnimationFrame`.
- Publication queue is capped at 2,048 events with authoritative resync.
- Timeline uses stable IDs, memoized rows, and long-history virtualization.
- Renderer recovery republishes state and selected transcript.
## Findings
### F1 — Critical: Metadata defeats batching
Every assistant update becomes `assistantDelta` plus `sessionUpdated`:
- `packages/pi-sdk-driver/src/session-supervisor.ts:2485-2508`
- `packages/pi-sdk-driver/src/session-supervisor.ts:3338-3345`
Only `assistantDelta`/`toolUpdated` batch. Other events force flush:
- `apps/desktop/electron/app-store.ts:2768-2775`
Existing benchmark models this shape. 80 deltas produce 87 `sessionUpdated`, 82 batchable events, 82 batches, 174 full state emits/IPC publications:
- `apps/desktop/tests/core/streaming-performance.spec.ts:98-178`
**Impact:** very high CPU, IPC, visible lag.
**Fix:** combine adjacent same-session/same-run text; retain latest equivalent running metadata; flush at semantic boundaries only.

### F2 — High: Per-event transcript clone is discarded
`applySessionEventState()` clones every transcript item:
- `apps/desktop/electron/app-store-session-state.ts:17-44`
`updateSessionRecord()` uses transcript only for preview/unseen derivation; `SessionRecord` does not retain it:
- `apps/desktop/electron/app-store-session-state.ts:48-78`
- `apps/desktop/src/desktop-state.ts:65-79`
**Impact:** O(history) CPU/allocation per event.
**Fix:** derive from readonly cache; clone only at ownership/publication boundaries.

### F3 — High: Growing text and history are repeatedly copied/scanned
`appendAssistantDelta()` copies transcript array and concatenates complete accumulated text per delta:
- `apps/desktop/electron/app-store-timeline.ts:95-128`
Preview/activity helpers scan history:
- `apps/desktop/electron/app-store-utils.ts:231-245`
- `apps/desktop/electron/app-store-utils.ts:597-613`
Small deltas can approach quadratic total text processing.
**Fix:** per-session chunk buffer; incremental preview/activity metadata; immutable materialization at presentation/finalization.

### F4 — High: Complete selected transcript is retransmitted
Each affected stream publication creates a complete transcript array:
- `apps/desktop/electron/app-store.ts:3225-3236`
- `apps/desktop/electron/app-store.ts:2855-2861`
Main sends it through Electron IPC; renderer replaces complete pending record:
- `apps/desktop/electron/main.ts:671-702`
- `apps/desktop/src/app/desktop-app-state.ts:106-110`
Electron serializes all prior messages/tool data again. Cost grows with history. This is separate from `stateChanged`; ordinary app state excludes transcript.
**Fix:** sequenced selected-session append patches. Full snapshot only for load, selection, recovery, overflow, tree changes, and final reconciliation.

### F5 — High: Stream ticks clone/project full app state
Every `emit()` clones `DesktopAppState`; each BrowserWindow projection clones again before IPC:
- `apps/desktop/electron/app-store.ts:3266-3290`
- `apps/desktop/electron/app-store.ts:334-355`
- `apps/desktop/electron/main.ts:633-668`
State excludes ordinary transcripts but includes all workspace/session/runtime/extension/worktree/orchestration/settings data. Windows multiply work. Checked-in development-Electron evidence recorded roughly 361–387 ms state cloning, 586–628 ms listener fan-out, and 219–232 ms IPC send time for 174 events; these are historical, not new measurements.
**Fix:** separate control-state publication from transcript hot path. Text-only ticks must not publish global state.

### F6 — High: Complete growing Markdown is reparsed
Every text update invalidates `MessageMarkdown` memoization and reparses complete answer:
- `apps/desktop/src/message-markdown.tsx:19-34`
- `apps/desktop/src/timeline-item.tsx:100-151`
Lists, tables, code fences, and incomplete blocks increase cost.
**Fix:** exact raw text remains authoritative while active; lightweight stream render; Markdown at measured cadence/stable boundary; forced final parse. Never parse independent token fragments.

### F7 — Medium: Renderer re-derives full timeline
Every transcript replacement rebuilds message index, display timeline, turn boundaries, tool groups, and virtual offsets:
- `apps/desktop/src/conversation-timeline.tsx:67-80`
- `apps/desktop/src/conversation-timeline.tsx:318-499`
- `apps/desktop/src/timeline-turns.ts:48-130`
Virtualization limits DOM, not full-array derivation.
**Fix:** preserve unchanged refs; update active assistant only; move transcript state below root `App`; incrementally extend display metadata.

### F8 — Medium: Measurement and scroll correction pressure layout
Active row uses `ResizeObserver` + `getBoundingClientRect`; layout effects read/write scroll geometry; bottom alignment schedules repeated RAF checks:
- `apps/desktop/src/conversation-timeline.tsx:400-455`
- `apps/desktop/src/conversation-timeline.tsx:502-548`
- `apps/desktop/src/hooks/use-timeline-scroll.ts:126-176`
- `apps/desktop/src/hooks/use-timeline-scroll.ts:207-268`
- `apps/desktop/src/hooks/use-timeline-scroll.ts:619-633`
Repeated work is proven; unconditional feedback loop is not.
**Fix:** active row only; one measurement/alignment read-write cycle per frame. Optimize after transport/Markdown.

### F9 — Medium: Queues before publication cap are unbounded
2,048 cap protects final publication queue. Earlier driver/AppStore Promise chains have no event/byte bound:
- `packages/pi-sdk-driver/src/session-supervisor.ts:2379-2429`
- `apps/desktop/electron/app-store.ts:2141-2185`
Overload accumulates lag/memory before capped queue. Driver callback enqueues and returns; this is lag accumulation, not direct provider backpressure.
**Fix:** coalesce text before heavy processing; track per-session events/bytes; bound with session-local resync.

### F10 — Medium: Publication scheduling is global
Timer, pending events, and flush queue are app-wide:
- `apps/desktop/electron/app-store.ts:170-172`
- `apps/desktop/electron/app-store.ts:2780-2880`
One session can delay another despite isolated mutation queues.
**Fix:** per-session accumulators plus fair global frame scheduler.
## Why Terminal pi Is Faster
Terminal pi updates one streaming component per `message_update`:
- `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:2337-2360`

TUI coalesces renders at about 16 ms and writes changed terminal lines:
- `node_modules/@earendil-works/pi-tui/dist/tui.js:500-544`
- `node_modules/@earendil-works/pi-tui/dist/tui.js:1084-1203`

It bypasses Electron IPC, global snapshots, full transcript transport, React root updates, DOM layout/paint, and timeline measurement. This proves cheaper presentation, not faster model generation.
## Target Architecture
```text
AgentSession raw events
  -> per-session semantic accumulator
       -> assistant text chunks
       -> latest redundant running metadata
       -> exact control/tool/terminal boundaries
  -> fair frame scheduler
  -> narrow IPC
       -> assistantAppend(sessionKey, runId, itemId, sequence, text)
       -> controlEvent(...)
       -> authoritativeTranscriptSnapshot(...) when required
  -> renderer session-local stream store
       -> append exact text
       -> update active row only
       -> lightweight active render
       -> final Markdown + authoritative reconciliation
```

### Non-Negotiable Patch Rules
- Identity: session key, run ID, assistant item ID, monotonic sequence.
- Merge adjacent text only for same identity.
- Flush before tool, retry, host UI, completion, failure, abort, close, selection, shutdown.
- Reject stale identity/sequence; gap triggers resync.
- Bound by event count and bytes.
- Keep full snapshot/resync path.
- Route selected transcript only to matching windows.
- Completion/failure cannot overtake text.
## Recommended Implementation Plan
### Phase 0 — Baseline
Instrument content-safe timings/counts: runtime arrival; driver/AppStore queue wait; delta bytes; history/answer length; clone/scan time; state/transcript payload bytes; per-window projection/IPC; renderer receipt/RAF; React commit; Markdown parse; measurement/scroll calls; event-loop lag; long tasks; memory/GC; composer/cancel latency.
Matrix: short/medium/long history; plain text/lists/tables/code; 1/5/20-token chunks; selected/unselected session; one/multiple windows; one/multiple sessions; tool/retry/abort/completion.
**Exit:** median, p95, max, sample count, exact fixture invariants recorded on Windows Electron.

### Phase 1 — Remove low-risk waste
1. Remove discarded transcript clone.
2. Read readonly cache in metadata helpers.
3. Cache preview/latest activity incrementally.
4. Skip no-op viewed/derived-state rebuilds.
5. Add per-session queue wait/byte diagnostics.
**Exit:** current correctness suite passes; clone count/time drops; IPC unchanged.

### Phase 2 — Restore semantic batching
1. Classify text, redundant running metadata, control/tool, terminal events.
2. Coalesce adjacent same-identity text before publication.
3. Keep latest equivalent running metadata per presentation batch.
4. Flush once per frame/bounded timer and at every boundary.
5. Replace tests locking one batch per delta with bounded-rate assertions.
**Exit:** 80 deltas no longer cause 82 batches/174 state publications; exact order remains.

### Phase 3 — Incremental transcript IPC
1. Define versioned append-patch and snapshot contracts.
2. Route patches to matching selected windows only.
3. Apply through renderer session-local store.
4. Validate sequence and stale identity.
5. Resync on gap, overflow, recovery, selection.
6. Final authoritative reconcile on completion/failure.
**Exit:** normal transcript IPC bytes scale with appended text, not history.

### Phase 4 — Decouple global state
1. Stop full `DesktopAppState` emit for text-only ticks.
2. Throttle sidebar preview/status separately.
3. Keep full state for meaningful control/config/selection changes.
**Exit:** text-only batch causes zero full-state IPC unless visible metadata changed.

### Phase 5 — Reduce renderer work
1. Keep exact raw active text in session-local store.
2. Use lightweight active streaming component.
3. Parse Markdown at measured cadence or stable/final boundary.
4. Preserve inactive row refs; update display metadata incrementally.
**Exit:** Markdown parse count bounded independently of raw delta count; final DOM exact.

### Phase 6 — Tune layout/scroll
1. Measure active changing row only.
2. Coalesce observer handling to one frame.
3. Remove avoidable unconditional layout reads.
4. One pinned-bottom read/write cycle per frame.
**Exit:** no pinned/off-bottom/session-switch regression; forced layout falls.

### Phase 7 — Fairness and bounds
1. Per-session event/byte bounds.
2. Round-robin ready sessions within frame budget.
3. Affected-session/window resync only.
4. Terminal events cannot starve behind another session.
**Exit:** parallel load keeps bounded queues and input latency.
## Verification Matrix

### Correctness
- Random two-session interleaving yields exact text per session.
- Text around tool start/update/finish never crosses boundaries.
- Completion/failure/abort cannot overtake pending text.
- Suspended timer + final flush loses no bytes.
- Selection rejects detached old-session payloads.
- Recovery restores authoritative transcript/state.
- Gap/overflow triggers bounded resync.
- Multiple windows receive intended selected session only.

### Responsiveness
During long stream measure composer/cancel/scroll latency, session-switch convergence, main/renderer event-loop lag, renderer long tasks/dropped frames, queue depth/bytes, memory, and GC.

### Performance Gates
Set numeric budgets after Phase 0. Always require:
- Publication rate bounded by presentation frames, not raw tokens.
- Normal transcript IPC proportional to appended text.
- No text-only global-state IPC.
- No per-delta full transcript clone or complete Markdown parse.
- All queues zero after terminal flush.
- No overflow in normal matrix.

### Required Windows Surfaces
1. Targeted development Electron benchmark.
2. Full affected core specs.
3. Live real-provider stream.
4. Packaged/unpacked Windows Electron benchmark.
5. Installed Windows final smoke.
## Current Test Gaps
Current spec proves ordering/recovery, not responsiveness. It uses 80 short chunks and short history; injects synthetic events; accepts 174 state publications; lacks latency limits, payload bytes, Markdown time, input latency, event-loop lag, long tasks, GC, and memory growth.

Keep correctness assertions. Change publication expectations after batching. Add long-history and live-runtime lanes.
## Risks
- Incremental IPC corrupts order without sequence/resync.
- Mutable buffers leak later mutations unless ownership is strict.
- Deferred Markdown changes active appearance; final output must stay exact.
- Over-coalescing hides tool/lifecycle transitions.
- Global-state decoupling can stale sidebar status without separate cadence.
- Scroll tuning can regress pinned/off-bottom restoration.
## Recommended First Slice
Implement Phase 0 and Phase 1. Then isolate Phase 2 event-amplification change before patch IPC or renderer work.

Decisive target:
> 80 assistant deltas must not cause 82 stream batches and 174 full state publications.
## Verification Commands
```bash
test -f docs/streaming-architecture-assessment.md
rg -n "^## (Findings|Target Architecture|Recommended Implementation Plan|Verification Matrix)$" docs/streaming-architecture-assessment.md
rg -n "F1 — Critical|Non-Negotiable Patch Rules|Phase 0|Phase 7" docs/streaming-architecture-assessment.md
git diff --check -- docs/streaming-architecture-assessment.md
```

Focused Electron correctness lane:
```bash
pnpm --filter @pi-frame/desktop run build
PI_APP_TEST_MODE=background pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/core/streaming-performance.spec.ts
```

Final verification follows `apps/desktop/AGENTS.md`, `apps/desktop/tests/AGENTS.md`, and `.agents/skills/verify/SKILL.md`.
## Next Step
Approve Phase 0 measurement scope and numeric budgets before implementation.
