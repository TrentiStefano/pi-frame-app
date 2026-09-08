import { expect, test } from "@playwright/test";
import type { SessionDriverEvent, SessionRef } from "@pi-frame/session-driver";
import { createNamedThread, getDesktopState, getSelectedTranscript, launchDesktop, makeUserDataDir, makeWorkspace, selectSession } from "../helpers/electron-app";

type StreamDiagnostics = {
  eventCounts: Record<string, number>; eventSequence: string[]; maxQueueDepth: number;
  publishCount: number; emitSnapshotConstructionCount: number; emitSnapshotConstructionElapsedMs: number;
  stateListenerInvocationCount: number; stateListenerFanoutElapsedMs: number;
  stateIpcPublicationCount: number; stateIpcPublicationElapsedMs: number;
  streamPublishCount: number; streamBatchCount: number;
  maxPendingStreamEvents: number; streamDroppedEventCount: number; streamResyncCount: number;
  streamDeliveredEventCount: number; sessionEventDeliverySequence: string[]; streamQueuedDeliverySequence: string[]; maxPendingStreamSessions: number; pendingStreamResync: boolean;
  pendingStreamSessions: number; pipelineDrainElapsedMs?: number; rendererConvergenceElapsedMs?: number; elapsedMs: number;
  eventQueueWaitCount: number; eventQueueWaitTotalMs: number; eventQueueWaitMaxMs: number; maxQueueBytesBySession: Record<string, number>;
  eventHandlerCount: number; eventHandlerElapsedMs: number; eventHandlerMaxElapsedMs: number;
  assistantDeltaApplyCount: number; assistantDeltaApplyElapsedMs: number;
  sessionStateApplyCount: number; sessionStateApplyElapsedMs: number;
  selectedTranscriptBuildCount: number; selectedTranscriptBuildElapsedMs: number;
  selectedTranscriptItemCount: number; selectedTranscriptEstimatedBytes: number;
  assistantDeltaBytesTotal: number; assistantDeltaBytesMax: number; assistantToTerminalElapsedMsBySession: Record<string, number>;
  stateIpcPayloadBytes: number; stateIpcMaxPayloadBytes: number;
  stateProjectionCount: number; stateProjectionElapsedMs: number;
  selectedTranscriptIpcPublicationCount: number; selectedTranscriptIpcPublicationElapsedMs: number;
  selectedTranscriptIpcPayloadBytes: number; selectedTranscriptIpcMaxPayloadBytes: number;
  assistantStreamPatchCount: number; assistantStreamPatchPayloadBytes: number;
};

type Hooks = {
  emitSessionEvents?: (events: readonly SessionDriverEvent[]) => Promise<void>;
  emitAssistantStreamPatch?: (patch: unknown) => void;
  suspendStreamPublishTimerForTest?: () => void;
  resumeStreamPublishTimerForTest?: () => Promise<void>;
  waitForSessionEventIdle?: () => Promise<void>;
  resetStreamDiagnostics?: () => void;
  getStreamDiagnostics?: () => StreamDiagnostics;
  getSelectedTranscriptPublicationCounts?: () => Record<string, number>;
  installSessionEventFailureFixture?: (eventType: SessionDriverEvent["type"]) => void;
  getSessionEventFailureSequence?: () => string[];
  invokeRendererRecoveryForTest?: () => void;
  recordRendererConvergence?: () => void;
  getPlatformEvidence?: () => { mainProcessPlatform: string; isPackaged: boolean };
};

async function callHook<T = void>(harness: Awaited<ReturnType<typeof launchDesktop>>, name: keyof Hooks, payload?: unknown): Promise<T> {
  return harness.electronApp.evaluate(async (_, value) => {
    const hooks = (globalThis as { __PI_APP_TEST_HOOKS?: Hooks }).__PI_APP_TEST_HOOKS;
    const fn = hooks?.[value.name] as ((arg?: unknown) => unknown) | undefined;
    if (!fn) throw new Error(`stream hook unavailable: ${value.name}`);
    return (await fn(value.payload)) as T;
  }, { name, payload }) as Promise<T>;
}

async function rendererDiagnostics(window: Awaited<ReturnType<Awaited<ReturnType<typeof launchDesktop>>["firstWindow"]>>): Promise<NonNullable<Window["__piAppTestRenderDiagnostics"]>> {
  return window.evaluate(() => {
    const diagnostics = window.__piAppTestRenderDiagnostics;
    if (!diagnostics) throw new Error("renderer diagnostics unavailable");
    return diagnostics;
  });
}

async function resetRendererDiagnostics(window: Awaited<ReturnType<Awaited<ReturnType<typeof launchDesktop>>["firstWindow"]>>): Promise<void> {
  await window.evaluate(() => {
    if (window.__piAppTestResetRenderDiagnostics) {
      window.__piAppTestResetRenderDiagnostics();
      return;
    }
    const diagnostics = window.__piAppTestRenderDiagnostics;
    if (diagnostics) {
      for (const [key, value] of Object.entries(diagnostics)) {
        if (typeof value === "number") {
          (diagnostics as unknown as Record<string, number>)[key] = 0;
        }
      }
    }
  });
}

async function diagnostics(harness: Awaited<ReturnType<typeof launchDesktop>>): Promise<StreamDiagnostics> {
  return harness.electronApp.evaluate(() => {
    const hooks = (globalThis as { __PI_APP_TEST_HOOKS?: Hooks }).__PI_APP_TEST_HOOKS;
    if (!hooks?.getStreamDiagnostics) throw new Error("stream diagnostics hook unavailable");
    return hooks.getStreamDiagnostics();
  });
}

function snapshot(sessionRef: SessionRef, title: string, workspacePath: string, status: "running" | "idle", runId?: string) {
  return { ref: sessionRef, workspace: { workspaceId: sessionRef.workspaceId, path: workspacePath, displayName: "streaming-performance-workspace" }, title, status, updatedAt: new Date().toISOString(), preview: "content-safe benchmark preview", ...(runId ? { runningRunId: runId } : {}) };
}

function sessionKeyForTest(ref: SessionRef): string {
  return `${ref.workspaceId}:${ref.sessionId}`;
}

function diagnosticToken(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return `d${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function deliveryIdentity(event: SessionDriverEvent): string {
  const callId = "callId" in event && typeof event.callId === "string" ? event.callId : "";
  const runId = "runId" in event && typeof event.runId === "string" ? event.runId : "";
  const textLength = "text" in event && typeof event.text === "string" ? event.text.length : "";
  const snapshotStatus = "snapshot" in event && event.snapshot ? event.snapshot.status : "";
  const runningRunId = "snapshot" in event && event.snapshot ? event.snapshot.runningRunId ?? "" : "";
  const session = diagnosticToken(`${event.sessionRef.workspaceId}:${event.sessionRef.sessionId}`);
  return `${session}|${event.type}|${event.timestamp}|${runId ? diagnosticToken(runId) : ""}|${callId ? diagnosticToken(callId) : ""}|${textLength}|${snapshotStatus}|${runningRunId ? diagnosticToken(runningRunId) : ""}`;
}

test("real driver-shaped stream preserves exact text/order and drains bounded queues", async () => {
  test.skip(process.platform !== "win32", "Windows Electron streaming baseline only.");
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("streaming-performance-workspace");
  const harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  let rendererCrashed = false;
  let rendererNavigations = 0;
  try {
    const window = await harness.firstWindow();
    window.on("crash", () => { rendererCrashed = true; });
    window.on("framenavigated", () => { rendererNavigations += 1; });
    const initialUrl = window.url();
    await createNamedThread(window, "Streaming performance regression");
    const state = await getDesktopState(window);
    if (!state.selectedWorkspaceId || !state.selectedSessionId) throw new Error("Expected selected session");
    const sessionRef = { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
    const runId = "phase0-stream-run";
    const chunks = Array.from({ length: 80 }, (_, index) => `chunk-${index}|`);
    const expected = chunks.join("");
    const expectedAssistantSegments = [
      chunks.slice(0, 21).join(""),
      chunks.slice(21, 51).join(""),
      chunks.slice(51).join(""),
    ];
    const events: SessionDriverEvent[] = [{ type: "sessionUpdated", sessionRef, runId, timestamp: new Date().toISOString(), snapshot: snapshot(sessionRef, "Streaming performance regression", workspacePath, "running", runId) }];
    for (const [index, text] of chunks.entries()) {
      const timestamp = new Date(Date.now() + index).toISOString();
      events.push({ type: "assistantDelta", sessionRef, runId, timestamp, text });
      events.push({ type: "sessionUpdated", sessionRef, runId, timestamp, snapshot: snapshot(sessionRef, `Streaming performance regression ${index}`, workspacePath, "running", runId) });
      if (index === 20 || index === 50) {
        const toolNumber = index === 20 ? "one" : "two";
        const toolName = `benchmark-tool-${toolNumber}`;
        const callId = `phase0-tool-${toolNumber}`;
        events.push({ type: "toolStarted", sessionRef, runId, timestamp, toolName, callId, input: { opaque: true, toolNumber } });
        events.push({ type: "sessionUpdated", sessionRef, runId, timestamp, snapshot: snapshot(sessionRef, "Streaming performance regression", workspacePath, "running", runId) });
        events.push({ type: "toolUpdated", sessionRef, runId, timestamp, callId, text: `${toolName} progress`, progress: 0.5 });
        events.push({ type: "sessionUpdated", sessionRef, runId, timestamp, snapshot: snapshot(sessionRef, "Streaming performance regression", workspacePath, "running", runId) });
        events.push({ type: "toolFinished", sessionRef, runId, timestamp, callId, success: true, output: { opaque: true, toolNumber } });
        events.push({ type: "sessionUpdated", sessionRef, runId, timestamp, snapshot: snapshot(sessionRef, "Streaming performance regression", workspacePath, "running", runId) });
      }
    }
    events.push({ type: "runCompleted", sessionRef, runId, timestamp: new Date().toISOString(), snapshot: snapshot(sessionRef, "Streaming performance regression", workspacePath, "idle") });
    expect(events.length).toBe(174);
    await callHook(harness, "resetStreamDiagnostics");
    await resetRendererDiagnostics(window);
    await window.evaluate(() => {
      const target = window as typeof window & {
        __phase4MetadataPatches?: {
          items: {
            revision: number;
            title: string;
            preview: string;
            status: string;
            hasUnseenUpdate: boolean;
          }[];
          stop?: () => void;
        };
      };
      const patches: {
        revision: number;
        title: string;
        preview: string;
        status: string;
        hasUnseenUpdate: boolean;
      }[] = [];
      const stop = window.piApp?.onSessionMetadataPatch((patch) => {
        patches.push({
          revision: patch.revision,
          title: patch.title,
          preview: patch.preview,
          status: patch.status,
          hasUnseenUpdate: patch.hasUnseenUpdate,
        });
      });
      target.__phase4MetadataPatches = { items: patches, stop };
    });
    await callHook(harness, "emitSessionEvents", events);
    await callHook(harness, "waitForSessionEventIdle");
    const pipeline = await diagnostics(harness);
    const metadataPatches = await window.evaluate(() => {
      const target = window as typeof window & {
        __phase4MetadataPatches?: {
          items: {
            revision: number;
            title: string;
            preview: string;
            status: string;
            hasUnseenUpdate: boolean;
          }[];
          stop?: () => void;
        };
      };
      const metadataPatches = target.__phase4MetadataPatches;
      metadataPatches?.stop?.();
      return metadataPatches?.items ?? [];
    });
    expect(metadataPatches.length).toBeGreaterThan(0);
    expect(metadataPatches.at(-1)?.title).toBe("Streaming performance regression 79");
    expect(metadataPatches.at(-1)?.preview.length).toBeGreaterThan(0);
    expect(metadataPatches.at(-1)?.status).toBe("running");
    expect(typeof metadataPatches.at(-1)?.hasUnseenUpdate).toBe("boolean");
    expect(metadataPatches.at(-1)?.revision).toBeGreaterThan(0);
    expect(pipeline.pipelineDrainElapsedMs).toBeDefined();
    expect(pipeline.rendererConvergenceElapsedMs).toBeUndefined();
    const platformEvidence = await window.evaluate(() => ({
      rendererProcessPlatform: window.piApp?.platform,
    }));
    const mainPlatform = await callHook<{ mainProcessPlatform: string; isPackaged: boolean }>(harness, "getPlatformEvidence");
    expect(mainPlatform).toEqual({ mainProcessPlatform: "win32", isPackaged: false });
    expect(platformEvidence.rendererProcessPlatform).toBe("win32");
    await expect(window.locator(".timeline-item--assistant .message__content")).toHaveText(expectedAssistantSegments);
    const toolMetadata = window.locator(".timeline-tool__meta-inline");
    await expect(toolMetadata).toHaveText(["benchmark-tool-one · done", "benchmark-tool-two · done"]);
    await callHook(harness, "recordRendererConvergence");
    const transcript = await getSelectedTranscript(window);
    if (!transcript) throw new Error("Expected selected transcript");
    const assistantText = transcript.transcript.filter((item): item is Extract<(typeof transcript.transcript)[number], { kind: "message" }> => item.kind === "message" && item.role === "assistant").map((item) => item.text).join("");
    expect(assistantText).toBe(expected);
    expect(rendererCrashed).toBe(false);
    expect(window.url()).toBe(initialUrl);
    expect(rendererNavigations).toBe(0);
    const observed = await diagnostics(harness);
    const expectedTypes = events.map((event) => event.type);
    expect(observed.pipelineDrainElapsedMs).toBe(pipeline.pipelineDrainElapsedMs);
    expect(observed.eventSequence).toHaveLength(174);
    expect(observed.eventSequence).toEqual(expectedTypes);
    // This recorder runs inside emitSessionEvent(), after the queued transport
    // reaches the real subscribeToSessionEvents() boundary. Metadata is content-safe.
    expect(observed.sessionEventDeliverySequence).toEqual(events.map(deliveryIdentity));
    expect(observed.sessionEventDeliverySequence).toHaveLength(174);
    expect(Object.values(observed.eventCounts).reduce((sum, count) => sum + count, 0)).toBe(174);
    expect(observed.publishCount).toBeLessThan(20);
    expect(observed.emitSnapshotConstructionCount).toBe(observed.publishCount);
    expect(observed.stateListenerInvocationCount).toBeGreaterThanOrEqual(observed.publishCount);
    expect(observed.stateIpcPublicationCount).toBe(observed.publishCount);
    expect(observed.stateIpcPublicationCount).toBeLessThan(20);
    expect(observed.emitSnapshotConstructionElapsedMs).toBeGreaterThanOrEqual(0);
    expect(observed.stateListenerFanoutElapsedMs).toBeGreaterThanOrEqual(0);
    expect(observed.stateIpcPublicationElapsedMs).toBeGreaterThanOrEqual(0);
    expect(observed.stateIpcPayloadBytes).toBeGreaterThan(0);
    expect(observed.stateIpcMaxPayloadBytes).toBeGreaterThan(0);
    expect(observed.stateProjectionCount).toBe(observed.stateIpcPublicationCount);
    expect(observed.stateProjectionElapsedMs).toBeGreaterThanOrEqual(0);
    expect(observed.selectedTranscriptIpcPublicationCount).toBeGreaterThan(0);
    expect(observed.selectedTranscriptIpcPublicationCount).toBeLessThan(174);
    expect(observed.selectedTranscriptIpcPayloadBytes).toBeGreaterThan(0);
    expect(observed.assistantStreamPatchCount).toBeGreaterThan(0);
    expect(observed.assistantStreamPatchPayloadBytes).toBeGreaterThan(0);
    expect(observed.selectedTranscriptIpcMaxPayloadBytes).toBeGreaterThan(0);
    expect(observed.selectedTranscriptBuildCount).toBeGreaterThan(0);
    expect(observed.selectedTranscriptItemCount).toBeGreaterThan(0);
    expect(observed.eventQueueWaitCount).toBe(174);
    expect(observed.eventHandlerCount).toBe(174);
    expect(observed.eventQueueWaitTotalMs).toBeGreaterThanOrEqual(0);
    expect(Object.values(observed.maxQueueBytesBySession)).toHaveLength(1);
    expect(Object.values(observed.maxQueueBytesBySession)[0]).toBeGreaterThan(0);
    expect(observed.eventHandlerElapsedMs).toBeGreaterThanOrEqual(0);
    expect(observed.assistantDeltaApplyCount).toBe(80);
    expect(observed.assistantDeltaBytesTotal).toBeGreaterThan(0);
    expect(observed.assistantDeltaBytesMax).toBeGreaterThan(0);
    expect(Object.values(observed.assistantToTerminalElapsedMsBySession)).toHaveLength(1);
    expect(Object.values(observed.assistantToTerminalElapsedMsBySession)[0]).toBeGreaterThanOrEqual(0);
    expect(observed.sessionStateApplyCount).toBe(174);
    const renderer = await rendererDiagnostics(window);
    expect(renderer.stateReceiptCount).toBe(observed.stateIpcPublicationCount);
    expect(renderer.rafScheduledCount).toBe(renderer.rafFlushCount);
    expect(renderer.rafFlushCount).toBeGreaterThan(0);
    expect(renderer.stateReceiptElapsedMs).toBeGreaterThanOrEqual(0);
    expect(renderer.rafFlushElapsedMs).toBeGreaterThanOrEqual(0);
    expect(renderer.reactCommitCount).toBeGreaterThan(0);
    expect(renderer.reactRenderToLayoutElapsedMs).toBeGreaterThanOrEqual(0);
    expect(renderer.markdownRenderCount).toBeGreaterThan(0);
    expect(renderer.markdownRenderCount).toBeLessThan(chunks.length);
    expect(renderer.markdownRenderToLayoutElapsedMs).toBeGreaterThanOrEqual(0);
    expect(renderer.eventLoopSampleCount).toBeGreaterThan(0);
    expect(renderer.streamPatchGapCount).toBe(0);
    expect(observed.streamPublishCount).toBe(164);
    expect(observed.streamBatchCount).toBeLessThan(82);
    expect(observed.streamBatchCount).toBeGreaterThan(0);
    expect(observed.eventCounts.assistantDelta).toBe(chunks.length);
    expect(observed.eventCounts.sessionUpdated).toBe(chunks.length + 1 + 6);
    expect(observed.eventCounts.toolStarted).toBe(2);
    expect(observed.eventCounts.toolUpdated).toBe(2);
    expect(observed.eventCounts.toolFinished).toBe(2);
    expect(observed.eventCounts.runCompleted).toBe(1);
    expect(observed.maxQueueDepth).toBe(174);
    expect(observed.pendingStreamSessions).toBe(0);
    expect(observed.maxPendingStreamEvents).toBeGreaterThan(0);
    expect(observed.maxPendingStreamEvents).toBeLessThanOrEqual(2048);
    expect(observed.streamDroppedEventCount).toBe(0);
    expect(observed.streamResyncCount).toBe(0);
    expect(observed.streamBatchCount).toBeLessThan(82);
    const cursor = transcript.streamCursors?.[0];
    if (!cursor) throw new Error("Expected streamed assistant cursor");
    const assistantMessage = transcript.transcript.find((item) => item.id === cursor.assistantMessageId);
    if (!assistantMessage || assistantMessage.kind !== "message") throw new Error("Expected streamed assistant message");
    await callHook(harness, "emitAssistantStreamPatch", {
      workspaceId: transcript.workspaceId,
      sessionId: transcript.sessionId,
      ...(cursor.runId ? { runId: cursor.runId } : {}),
      assistantMessageId: cursor.assistantMessageId,
      assistantMessageCreatedAt: assistantMessage.createdAt,
      sequence: cursor.sequence + 2,
      deltaCount: 1,
      text: "GAP_SHOULD_NOT_RENDER",
    });
    await expect.poll(async () => (await rendererDiagnostics(window)).streamPatchGapCount).toBe(1);
    await expect.poll(async () => (await getSelectedTranscript(window))?.transcript
      .filter((item) => item.kind === "message" && item.role === "assistant")
      .map((item) => item.kind === "message" ? item.text : "")
      .join(""), { timeout: 15_000 }).toBe(expected);
    const skippedBefore = (await rendererDiagnostics(window)).streamPatchSkippedCount;
    const duplicatePatch = {
      workspaceId: transcript.workspaceId,
      sessionId: transcript.sessionId,
      ...(cursor.runId ? { runId: cursor.runId } : {}),
      assistantMessageId: cursor.assistantMessageId,
      assistantMessageCreatedAt: assistantMessage.createdAt,
      sequence: cursor.sequence,
      deltaCount: 1,
      text: "DUPLICATE_SHOULD_NOT_RENDER",
    };
    await callHook(harness, "emitAssistantStreamPatch", duplicatePatch);
    await expect.poll(async () => (await rendererDiagnostics(window)).streamPatchSkippedCount).toBe(skippedBefore + 1);
    await callHook(harness, "emitAssistantStreamPatch", { ...duplicatePatch, sequence: Math.max(0, cursor.sequence - 1) });
    await expect.poll(async () => (await rendererDiagnostics(window)).streamPatchSkippedCount).toBe(skippedBefore + 2);
    const gapsBeforeIdentityCheck = (await rendererDiagnostics(window)).streamPatchGapCount;
    await callHook(harness, "emitAssistantStreamPatch", {
      ...duplicatePatch,
      sequence: cursor.sequence + 1,
      assistantMessageCreatedAt: "2000-01-01T00:00:00.000Z",
      text: "IDENTITY_MISMATCH_SHOULD_NOT_RENDER",
    });
    await expect.poll(async () => (await rendererDiagnostics(window)).streamPatchGapCount).toBe(gapsBeforeIdentityCheck + 1);
    await expect.poll(async () => (await getSelectedTranscript(window))?.transcript

      .filter((item) => item.kind === "message" && item.role === "assistant")
      .map((item) => item.kind === "message" ? item.text : "")
      .join(""), { timeout: 15_000 }).toBe(expected);
    console.log(JSON.stringify({ scenario: "phase3-patch-stream", chunks: chunks.length, platformEvidence: { ...mainPlatform, ...platformEvidence }, pipeline, rendererConvergenceElapsedMs: observed.rendererConvergenceElapsedMs, diagnostics: observed }));
  } finally { await harness.close(); }
});

test("keeps active raw streaming text across notify activity and settles Markdown at completion", async () => {
  test.skip(process.platform !== "win32", "Windows Electron streaming presentation only.");
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("streaming-markdown-workspace");
  const harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Markdown streaming regression");
    const state = await getDesktopState(window);
    const sessionRef = { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
    const runId = "phase5-markdown-run";
    const running = snapshot(sessionRef, "Markdown streaming regression", workspacePath, "running", runId);
    const events: SessionDriverEvent[] = [
      { type: "sessionUpdated", sessionRef, runId, timestamp: new Date().toISOString(), snapshot: running },
      { type: "assistantDelta", sessionRef, runId, timestamp: new Date().toISOString(), text: "**before" },
      {
        type: "hostUiRequest",
        sessionRef,
        runId,
        timestamp: new Date().toISOString(),
        request: { kind: "notify", requestId: "phase5-notify", message: "safe activity" },
      },
      { type: "assistantDelta", sessionRef, runId, timestamp: new Date().toISOString(), text: "** after\n  next" },
    ];
    await callHook(harness, "emitSessionEvents", events);
    await callHook(harness, "waitForSessionEventIdle");
    await expect(window.locator(".message__content--streaming")).toHaveText("**before** after\n  next");
    expect(await window.locator(".message__content--streaming").evaluate((element) => element.textContent)).toBe("**before** after\n  next");
    await expect(window.locator(".message__content--streaming p")).toHaveCount(0);

    await callHook(harness, "emitSessionEvents", [
      { type: "runCompleted", sessionRef, runId, timestamp: new Date().toISOString(), snapshot: snapshot(sessionRef, "Markdown streaming regression", workspacePath, "idle") },
    ]);
    await callHook(harness, "waitForSessionEventIdle");
    await expect(window.locator(".timeline-item--assistant strong")).toHaveText("before");
    await expect(window.locator(".message__content--streaming")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("publishes selected transcript once on selection transition and render-process-gone recovery", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("selected-transcript-publication-lifecycle");
  const harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Lifecycle session one");
    const firstState = await getDesktopState(window);
    if (!firstState.selectedWorkspaceId || !firstState.selectedSessionId) throw new Error("Expected first selected session");
    const firstRef = { workspaceId: firstState.selectedWorkspaceId, sessionId: firstState.selectedSessionId };
    const firstTimestamp = new Date().toISOString();
    await callHook(harness, "emitSessionEvents", [
      { type: "sessionUpdated", sessionRef: firstRef, runId: "lifecycle-first-run", timestamp: firstTimestamp, snapshot: snapshot(firstRef, "Lifecycle session one", workspacePath, "running", "lifecycle-first-run") },
      { type: "assistantDelta", sessionRef: firstRef, runId: "lifecycle-first-run", timestamp: firstTimestamp, text: "LIFECYCLE_FIRST" },
    ] satisfies SessionDriverEvent[]);
    await callHook(harness, "waitForSessionEventIdle");

    await createNamedThread(window, "Lifecycle session two");
    const secondState = await getDesktopState(window);
    if (!secondState.selectedWorkspaceId || !secondState.selectedSessionId) throw new Error("Expected second selected session");
    const secondRef = { workspaceId: secondState.selectedWorkspaceId, sessionId: secondState.selectedSessionId };
    const secondTimestamp = new Date().toISOString();
    await callHook(harness, "emitSessionEvents", [
      { type: "sessionUpdated", sessionRef: secondRef, runId: "lifecycle-second-run", timestamp: secondTimestamp, snapshot: snapshot(secondRef, "Lifecycle session two", workspacePath, "running", "lifecycle-second-run") },
      { type: "assistantDelta", sessionRef: secondRef, runId: "lifecycle-second-run", timestamp: secondTimestamp, text: "LIFECYCLE_SECOND" },
    ] satisfies SessionDriverEvent[]);
    await callHook(harness, "waitForSessionEventIdle");

    await callHook(harness, "resetStreamDiagnostics");
    await selectSession(window, "Lifecycle session one");
    await callHook(harness, "waitForSessionEventIdle");
    const assistant = window.locator(".timeline-item--assistant .message__content");
    await expect(assistant).toHaveText(["LIFECYCLE_FIRST"]);
    const transitionPublications = await callHook<Record<string, number>>(harness, "getSelectedTranscriptPublicationCounts");
    expect(Object.values(transitionPublications).reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(Object.entries(transitionPublications).filter(([key]) => key.endsWith("/selected-transcript"))).toHaveLength(1);

    await callHook(harness, "resetStreamDiagnostics");
    // Exercise the production render-process-gone recovery handler through its narrow test hook.
    await callHook(harness, "invokeRendererRecoveryForTest");
    const recoveredWindow = (await harness.electronApp.windows())[0];
    if (!recoveredWindow) throw new Error("Expected recovered renderer window");
    await expect.poll(() => recoveredWindow.url(), { timeout: 15_000 }).toContain("index.html");
    await callHook(harness, "waitForSessionEventIdle");
    await recoveredWindow.waitForFunction(() => Boolean(window.piApp), undefined, { timeout: 15_000 });
    expect(await getSelectedTranscript(recoveredWindow)).toMatchObject({ sessionId: firstRef.sessionId });
    await expect.poll(async () => (await getSelectedTranscript(recoveredWindow))?.transcript.filter((item) => item.kind === "message").map((item) => item.kind === "message" ? item.text : "")).toEqual(["LIFECYCLE_FIRST"]);
    const recoveryPublications = await callHook<Record<string, number>>(harness, "getSelectedTranscriptPublicationCounts");
    expect(Object.values(recoveryPublications).reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(Object.entries(recoveryPublications).filter(([key]) => key.endsWith("/recovery"))).toHaveLength(1);
  } finally { await harness.close(); }
});

test("overflow drops only bounded transport work and resyncs authoritative selected state", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("streaming-overflow-regression");
  const harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Overflow session one");
    const firstState = await getDesktopState(window);
    if (!firstState.selectedWorkspaceId || !firstState.selectedSessionId) throw new Error("Expected first selected session");
    const firstRef = { workspaceId: firstState.selectedWorkspaceId, sessionId: firstState.selectedSessionId };
    await createNamedThread(window, "Overflow session two");
    const secondState = await getDesktopState(window);
    if (!secondState.selectedWorkspaceId || !secondState.selectedSessionId) throw new Error("Expected second selected session");
    const secondRef = { workspaceId: secondState.selectedWorkspaceId, sessionId: secondState.selectedSessionId };
    const streamEvents: SessionDriverEvent[] = [];
    const perSession = 2050;
    for (const [sessionRef, prefix] of [[firstRef, "A"], [secondRef, "B"]] as const) {
      for (let index = 0; index < perSession; index += 1) {
        const timestamp = new Date(Date.now() + index).toISOString();
        streamEvents.push({ type: "assistantDelta", sessionRef, runId: `overflow-${prefix}`, timestamp, text: `${prefix}${index}|` });
        if (index % 500 === 0) streamEvents.push({ type: "toolUpdated", sessionRef, runId: `overflow-${prefix}`, timestamp, callId: `overflow-tool-${prefix}`, text: `progress-${prefix}`, progress: index / perSession });
      }
      streamEvents.push({ type: "runCompleted", sessionRef, runId: `overflow-${prefix}`, timestamp: new Date().toISOString(), snapshot: snapshot(sessionRef, `Overflow session ${prefix}`, workspacePath, "idle") });
    }
    await callHook(harness, "resetStreamDiagnostics");
    await callHook(harness, "suspendStreamPublishTimerForTest");
    await callHook(harness, "emitSessionEvents", streamEvents);
    await expect.poll(async () => (await diagnostics(harness)).streamPublishCount, { timeout: 30_000 }).toBe(4110);
    const beforeDrain = await diagnostics(harness);
    expect(beforeDrain.maxPendingStreamEvents).toBeLessThanOrEqual(2048);
    expect(beforeDrain.pendingStreamSessions).toBeLessThanOrEqual(2);
    expect(beforeDrain.maxPendingStreamSessions).toBeLessThanOrEqual(2);
    expect(Object.keys(beforeDrain.maxQueueBytesBySession)).toHaveLength(2);
    expect(Object.values(beforeDrain.maxQueueBytesBySession).every((bytes) => bytes > 0)).toBe(true);
    expect(beforeDrain.streamDroppedEventCount).toBe(4098);
    expect(beforeDrain.streamResyncCount).toBe(2);
    expect(beforeDrain.streamDroppedEventCount + beforeDrain.streamDeliveredEventCount).toBe(beforeDrain.streamPublishCount);
    await callHook(harness, "resumeStreamPublishTimerForTest");
    await callHook(harness, "waitForSessionEventIdle");
    const observed = await diagnostics(harness);
    expect(observed.pendingStreamSessions).toBe(0);
    expect(observed.pendingStreamResync).toBe(false);
    expect(observed.streamDroppedEventCount + observed.streamDeliveredEventCount).toBe(observed.streamPublishCount);
    expect(observed.sessionEventDeliverySequence).toHaveLength(streamEvents.length);
    for (const sessionRef of [firstRef, secondRef]) {
      const prefix = `${diagnosticToken(`${sessionRef.workspaceId}:${sessionRef.sessionId}`)}|`;
      const expected = streamEvents
        .filter((event) => sessionKeyForTest(event.sessionRef) === sessionKeyForTest(sessionRef))
        .map(deliveryIdentity);
      const actual = observed.sessionEventDeliverySequence.filter((identity) => identity.startsWith(prefix));
      expect(actual).toEqual(expected);
    }
    expect(observed.eventSequence.filter((type) => type === "runCompleted")).toHaveLength(2);
    const transcript = await getSelectedTranscript(window);
    if (!transcript) throw new Error("Expected selected transcript after resync");
    const selectedText = transcript.transcript.filter((item): item is Extract<(typeof transcript.transcript)[number], { kind: "message" }> => item.kind === "message" && item.role === "assistant").map((item) => item.text).join("");
    expect(selectedText).toBe(Array.from({ length: perSession }, (_, index) => `B${index}|`).join(""));
    const finalState = await getDesktopState(window);
    const finalWorkspace = finalState.workspaces.find((workspace) => workspace.id === firstRef.workspaceId);
    expect(finalWorkspace?.sessions.find((session) => session.id === firstRef.sessionId)?.status).toBe("idle");
    expect(finalWorkspace?.sessions.find((session) => session.id === secondRef.sessionId)?.status).toBe("idle");
  } finally { await harness.close(); }
});

test("isolates a failing subscribed listener and delivers later lifecycle events", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("streaming-listener-failure-regression");
  const harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Listener failure regression");
    const state = await getDesktopState(window);
    if (!state.selectedWorkspaceId || !state.selectedSessionId) throw new Error("Expected selected session");
    const sessionRef = { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
    const runId = "listener-failure-run";
    const timestamp = new Date().toISOString();
    const events: SessionDriverEvent[] = [
      { type: "sessionUpdated", sessionRef, runId, timestamp, snapshot: snapshot(sessionRef, "Listener failure regression", workspacePath, "running", runId) },
      { type: "assistantDelta", sessionRef, runId, timestamp, text: "SAFE_FAILURE_FIXTURE" },
      { type: "runCompleted", sessionRef, runId, timestamp, snapshot: snapshot(sessionRef, "Listener failure regression", workspacePath, "idle") },
    ];
    await callHook(harness, "installSessionEventFailureFixture", "assistantDelta");
    await callHook(harness, "resetStreamDiagnostics");
    await callHook(harness, "emitSessionEvents", events);
    await callHook(harness, "waitForSessionEventIdle");
    const recorded = await callHook<string[]>(harness, "getSessionEventFailureSequence");
    expect(recorded).toEqual(events.map(deliveryIdentity));
    expect(recorded).toHaveLength(3);
    expect(recorded.at(-1)).toBe(deliveryIdentity(events[2]));
    await expect(window.locator(".timeline-item--assistant .message__content")).toHaveText(["SAFE_FAILURE_FIXTURE"]);
    const finalState = await getDesktopState(window);
    const session = finalState.workspaces.flatMap((workspace) => workspace.sessions).find((item) => item.id === sessionRef.sessionId);
    expect(session?.status).toBe("idle");
  } finally { await harness.close(); }
});
