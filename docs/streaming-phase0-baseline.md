# Phase 0 Streaming Baseline

## Status

Phase 0 development-Electron baseline complete. No streaming behavior was changed. No source files were modified by this run.

The repository already contains content-safe diagnostics for event counts, queue depth, snapshot cloning, listener fan-out, IPC publication, stream batching, renderer receipt, RAF flushes, drops, resync, and convergence. This run reused those diagnostics.

## Surface

- OS: Windows (`win32`)
- Electron: development Electron
- Packaged: no (`isPackaged: false`)
- Playwright: one worker
- Fixture: real driver-shaped event path
- Provider: synthetic deterministic fixture; no real model/auth involved

## Commands

Passed:

```text
./node_modules/.bin/tsc -p apps/desktop/tsconfig.electron.json --noEmit
./node_modules/.bin/tsc -p apps/desktop/tsconfig.json --noEmit
./node_modules/.bin/tsc -p packages/pi-sdk-driver/tsconfig.json --noEmit
cd apps/desktop && ../../node_modules/.bin/electron-vite build
PI_APP_TEST_MODE=background ./node_modules/.bin/playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/core/streaming-performance.spec.ts --repeat-each=5
```

Playwright result: **20/20 passed**, 1 worker, 4 specs repeated 5 times.

## Fixture Shape

The primary stream fixture contains:

- 80 assistant deltas;
- 87 `sessionUpdated` events;
- 2 tool starts;
- 2 tool updates;
- 2 tool finishes;
- 1 completion;
- 174 total events.

The test asserts exact assistant text, assistant segment order around tool boundaries, tool order, event order, selected transcript, renderer survival, queue drain, and no stream drops/resync.

## Measured Samples

Five repeated primary-stream samples after the current build:

| Sample | Pipeline drain (ms) | Renderer convergence (ms) | Transcript clone (ms) | Full state clone (ms) | Listener fan-out (ms) | State IPC send (ms) |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1468.371 | 2349.269 | 0.354 | 390.126 | 624.827 | 235.293 |
| 2 | 1231.065 | 2109.821 | 0.291 | 322.504 | 521.140 | 195.298 |
| 3 | 2186.141 | 3083.711 | 0.600 | 577.927 | 924.822 | 349.354 |
| 4 | 1954.205 | 3840.735 | 0.494 | 508.425 | 837.133 | 322.290 |
| 5 | 1514.332 | 1894.006 | 0.342 | 388.732 | 631.869 | 233.839 |

| Metric | Minimum | Median | Mean | Maximum | Range |
|---|---:|---:|---:|---:|---:|
| Pipeline drain | 1231.065 | 1514.332 | 1670.823 | 2186.141 | 955.076 |
| Renderer convergence | 1894.006 | 2349.269 | 2655.508 | 3840.735 | 1946.728 |
| Transcript clone aggregate | 0.291 | 0.354 | 0.416 | 0.600 | 0.308 |
| Full state clone aggregate | 322.504 | 390.126 | 437.543 | 577.927 | 255.423 |
| State listener fan-out aggregate | 521.140 | 631.869 | 707.958 | 924.822 | 403.682 |
| State IPC send aggregate | 195.298 | 235.293 | 267.215 | 349.354 | 154.056 |

## Invariant Diagnostics

Every primary-stream sample reported:

- 174 events processed in exact source order;
- 174 full state publications;
- 174 full state IPC publications/receipts;
- 174 snapshot constructions;
- 82 stream publications;
- 82 stream batches;
- 728 transcript-message clone operations;
- maximum AppStore event queue depth: 174;
- maximum pending stream events: 1;
- zero dropped stream events;
- zero resyncs;
- exact final assistant text and tool order;
- renderer remained alive with zero unexpected navigation.

The maximum pending stream queue of 1 is significant: the adjacent `sessionUpdated` event forces a drain immediately after each assistant delta. The stream batcher is not receiving a sustained run of adjacent deltas in this fixture.

## What This Proves

1. The real Windows development-Electron path completes the correctness fixture without loss or renderer crash.
2. The current event shape causes 174 full state publications for 80 assistant deltas.
3. The current stream path performs 82 stream batches for 82 batchable events.
4. Full-state clone, listener fan-out, and state IPC work are measurable portions of the pipeline.
5. Transcript cloning occurs 728 times for this 174-event fixture, despite the cloned transcript not being retained in `SessionRecord`.
6. Renderer convergence is slower and more variable than main pipeline drain in this fixture.

These results do not prove which individual renderer operation dominates real long responses. They establish a baseline for controlled before/after experiments.

## What This Does Not Prove

This run does not measure:

- real provider token arrival or model generation;
- actual live-runtime delta size/frequency;
- IPC payload byte sizes;
- React commit duration;
- ReactMarkdown parse duration;
- browser long tasks or forced reflow;
- composer keystroke latency during a stream;
- cancel click latency;
- memory growth or GC pauses;
- packaged/installed Electron performance;
- concurrent real-provider sessions.

The existing fixture is synthetic, short, and starts with a small transcript. It is suitable for event/order and baseline pipeline comparison, not final user-experience acceptance.

## Phase 0 Evidence Limits

The requested local-auth real-provider evidence is complete for development Electron and one packaged long-response run. The measurements are content-safe but test-mode measurements perturb the path because payload sizing uses `JSON.stringify`.

Known limits:

- Chromium exposes heap sampling here, but reported heap values remain coarse and unchanged across samples; treat them as availability evidence, not a memory-growth benchmark.
- The browser reported zero long tasks in development and packaged runs despite event-loop lag; keep both metrics because `longtask` support/reporting can vary by host.
- The long-response matrix uses one prompt shape and one provider/model configuration. Add more prompt/content classes before setting universal budgets.
- The stream-only metric is first assistant-delta enqueue to terminal enqueue. The broader pipeline clock includes setup and test synchronization; do not use it as model-generation latency.
- Packaged directory and isolated installed-executable smoke both passed on Windows. No user-installed application was overwritten.

## Added Phase 0 Diagnostics

Test-only diagnostics now cover:

- AppStore queue wait and event-handler duration;
- assistant-delta bytes and stream-only first-delta-to-terminal duration, keyed per session;
- delta mutation and session-state application duration;
- selected-transcript build count, item count, estimated bytes, and duration;
- full-state projection count/duration and estimated IPC payload bytes;
- selected-transcript IPC count/duration and estimated payload bytes;
- renderer long-task support/count/duration;
- event-loop lag samples;
- renderer heap-memory samples when Chromium exposes `performance.memory`;
- composer, send/cancel-control, and timeline input-to-next-frame latency;
- timeline and Markdown render-to-layout duration.

Diagnostics install observers/listeners only when `PI_APP_TEST_MODE` is enabled. Renderer observers, timers, listeners, and reset hooks clean up. Payload sizing records byte counts only; it does not log payload content.

## Real Provider Smoke

The authorized local auth directory was used:

```text
C:\Users\strenti\.pi\agent
```

Command:

```text
PI_APP_REAL_AUTH=1 PI_APP_REAL_AUTH_SOURCE_DIR=C:\Users\strenti\.pi\agent ./node_modules/.bin/playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/live/submit-run.spec.ts
```

Result: **1/1 passed in 1.5 minutes** on Windows development Electron. The test created a real thread, submitted a real provider prompt, observed `READY` in the transcript, and confirmed the session returned to `idle`.

This confirms the real provider-backed path works. The short diagnostic output captured 1 assistant delta of 5 bytes and 72.356 ms from first delta enqueue to terminal event. It produced 21 full-state publications (~9.58 MB estimated state IPC) and 17 selected-transcript publications (~9.75 KB estimated transcript IPC).

The prompt was intentionally short, so it is not representative of long Markdown-heavy output. A repeated long-response matrix follows below.

## Long-Response Matrix

Development Electron, real provider, `PI_APP_STREAMING_LONG=1`, three repeats:

| Sample | Assistant deltas | Delta chars | Delta-to-terminal (ms) | Full-state publications | Full-state IPC | Transcript IPC | React commits | Markdown renders | Max event-loop lag (ms) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 4540 | 22811 | 92165.644 | 9101 | 4.26 GB | 114.7 MB | 286 | 92 | 63.7 |
| 2 | 3139 | 17508 | 60632.252 | 6299 | 2.93 GB | 61.9 MB | 195 | 61 | 64.6 |
| 3 | 4269 | 22187 | 78497.374 | 8559 | 4.00 GB | 105.0 MB | 245 | 79 | 65.2 |

Median: **4,269 deltas**, **22,187 characters**, **78,497 ms**, **8,559 full-state publications**, **4.00 GB estimated full-state IPC**, **105.0 MB transcript IPC**, **245 React commits**, **79 Markdown renders**, **64.6 ms maximum event-loop lag**.

Packaged Windows Electron, real provider, one long-response sample:

- 5,981 assistant deltas / 31,278 characters;
- 140,152.629 ms delta-to-terminal;
- 11,983 full-state publications / 4.17 GB estimated full-state IPC;
- 11,979 selected-transcript publications / 201.3 MB estimated transcript IPC;
- 427 React commits / 141 Markdown renders;
- 4 observed long tasks (maximum 59 ms); 107.9 ms maximum event-loop lag.

## Terminal Comparison

Integrated terminal Windows development-Electron sample:

- 17 terminal data events;
- 846 characters received;
- 17 `xterm.write()` calls;
- 0.8 ms total write time;
- 0.1 ms maximum data-receipt-to-write latency.

This is not the same workload as the provider stream. It confirms the terminal path has direct low-latency presentation and avoids transcript/state processing.

## Phase 0 Decision

**Completed:** Phase 0 established the Windows development, packaged, installed, live-provider, long-response, and terminal baselines. Do not use the synthetic fixture as a user-experience budget; use it for deterministic before/after comparison.

## Phase 1 Result

Implemented low-risk hot-path cleanup:

- removed the discarded full-transcript deep clone from `applySessionEventState()`;
- assistant-delta preview uses the active transcript tail in the common case;
- skipped viewed-state and derived-state recomputation for `assistantDelta` and `toolUpdated`.

Development Electron repeat result: **12/12 passed** across three repeats of the four streaming specs. The 174-event fixture preserves exact event/text/tool ordering after the clone path removal. Full-state publication count remains unchanged; semantic batching is Phase 2.

## Phase 2 Result

Implemented semantic presentation batching without changing the IPC contract:

- redundant running `sessionUpdated` events batch with adjacent assistant/tool stream events;
- control, tool, retry, completion, failure, and close boundaries still flush first;
- all subscribed event callbacks remain exact and ordered;
- synthetic 174-event fixture reduced from 174 to **15** full-state publications and from 82 to **5** stream batches;
- real-provider development matrix passed **3/3**; median full-state publications fell to **1,016**, estimated full-state IPC to **475 MB**, and selected-transcript IPC to **12.9 MB**;
- post-callback-fix real-provider development smoke passed **1/1** with 4,377 deltas, 934 full-state publications, 437 MB estimated state IPC, 11.3 MB selected-transcript IPC, 151 React commits, and 47 Markdown renders;
- packaged Windows long-response verification passed **1/1** with 4,976 deltas, 995 full-state publications, 343 MB estimated state IPC, 13.5 MB selected-transcript IPC, 152 React commits, and 48 Markdown renders.

This phase reduces publication amplification. Incremental transcript patches and active-stream Markdown reduction remain future phases. Existing command-refresh coalescing is outside this slice and remains unchanged.

## Phase 3 Result

Implemented sequenced incremental transcript transport:

- assistant deltas become patches carrying session, run, assistant-message, sequence, delta-count, and creation metadata;
- adjacent patches coalesce before IPC and route only to windows viewing that session;
- full selected-transcript snapshots remain for load, selection, control boundaries, terminal state, recovery, and overflow resync;
- renderer rejects stale patches, detects sequence gaps, and requests a full transcript resync;
- development Electron real-provider long run passed **1/1** with 4,874 deltas, 17 full transcript publications (~140 KB), ~990 KB patch IPC, 2,680 applied patches, and zero gaps;
- packaged Windows real-provider long run passed **1/1** with 4,679 deltas, 14 full transcript publications (~136 KB), ~825 KB patch IPC, 2,559 applied patches, 33 already-covered patches skipped, and zero gaps;
- installed Windows smoke passed **1/1** from the same packaged build.

The selected-transcript transport now scales with appended output rather than complete conversation history. Full global-state publication and active Markdown reparsing remain later optimization targets.

## Phase 4 Result

Removed full `DesktopAppState` publication from normal stream drains. Normal drains now send one coalesced, revisioned session-metadata patch per affected session so sidebar title/preview/status stays live. Overflow recovery still emits authoritative global state; control, terminal, failure, completion, selection, and recovery paths remain unchanged.

Development Electron real-provider long matrix passed **3/3**:

- median full-state publications: **21**;
- median estimated full-state IPC: **9.7 MB**;
- median selected-transcript IPC: **137 KB**;
- median React commits: **172**;
- zero stream drops/resyncs.

The final packaged Windows real-provider long run passed **1/1** with 4,886 deltas, 21 full-state publications (~7.1 MB estimated state IPC), 16 selected-transcript publications (~144 KB), 2,711 patch publications, 2,698 applied patches, 161 React commits, 51 Markdown renders, and no stream drops/resyncs. Installed Windows smoke passed **1/1**.

## Phase 5 Result

During active assistant streaming, the trailing assistant message now renders escaped raw text with preserved whitespace instead of reparsing the complete growing Markdown document. Settled messages still use the existing `react-markdown` path, so final headings, lists, tables, links, and fenced code render unchanged.

Development Electron real-provider long matrix passed **3/3**:

- 3,945–5,515 assistant deltas per run;
- Markdown render count: **6, 47, 50**;
- React commit count: **93, 148, 171**;
- zero stream gaps; full-state publications remained bounded at **18–21**.

The final packaged Windows real-provider long run passed **1/1** with 4,621 assistant deltas, **2** Markdown renders, 162 React commits, 20 full-state publications, and 2,507 stream patches, plus exact completion-token and stream-patch assertions. Installed Windows smoke passed **1/1**.

## Verification

```bash
test -f docs/streaming-phase0-baseline.md
rg -n "^## (Surface|Measured Samples|Invariant Diagnostics|Phase 0 Evidence Limits|Phase 0 Decision|Phase 4 Result|Phase 5 Result)$" docs/streaming-phase0-baseline.md
git diff --check -- docs/streaming-phase0-baseline.md
```
