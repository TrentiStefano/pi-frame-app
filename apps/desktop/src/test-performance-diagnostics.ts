export type RendererTestPerformanceDiagnostics = NonNullable<Window["__piAppTestRenderDiagnostics"]>;

export function ensureRendererTestPerformanceDiagnostics(): RendererTestPerformanceDiagnostics | undefined {
  if (!window.__piAppTestMode) {
    return undefined;
  }
  return (window.__piAppTestRenderDiagnostics ??= {
    stateReceiptCount: 0,
    stateReceiptElapsedMs: 0,
    rafScheduledCount: 0,
    rafFlushCount: 0,
    rafFlushElapsedMs: 0,
    longTaskSupported: false,
    longTaskCount: 0,
    longTaskTotalMs: 0,
    longTaskMaxMs: 0,
    eventLoopSampleCount: 0,
    eventLoopLagTotalMs: 0,
    eventLoopLagMaxMs: 0,
    memorySampleSupported: false,
    memorySampleCount: 0,
    memoryUsedHeapBytes: 0,
    memoryTotalHeapBytes: 0,
    memoryHeapLimitBytes: 0,
    memoryMaxUsedHeapBytes: 0,
    composerInputCount: 0,
    composerInputLatencyTotalMs: 0,
    composerInputLatencyMaxMs: 0,
    sendControlInputCount: 0,
    sendControlInputLatencyTotalMs: 0,
    sendControlInputLatencyMaxMs: 0,
    timelineInputCount: 0,
    timelineInputLatencyTotalMs: 0,
    timelineInputLatencyMaxMs: 0,
    terminalDataEventCount: 0,
    terminalDataChars: 0,
    terminalWriteCount: 0,
    terminalWriteChars: 0,
    terminalWriteElapsedMs: 0,
    terminalDataToWriteLatencyTotalMs: 0,
    terminalDataToWriteLatencyMaxMs: 0,
    reactCommitCount: 0,
    reactRenderToLayoutElapsedMs: 0,
    reactRenderToLayoutMaxMs: 0,
    markdownRenderCount: 0,
    markdownRenderToLayoutElapsedMs: 0,
    markdownRenderToLayoutMaxMs: 0,
    streamPatchAppliedCount: 0,
    streamPatchSkippedCount: 0,
    streamPatchGapCount: 0,
    streamCursorUpdateCount: 0,
  });
}

export function recordTerminalData(chars: number): void {
  const diagnostics = ensureRendererTestPerformanceDiagnostics();
  if (!diagnostics) {
    return;
  }
  diagnostics.terminalDataEventCount += 1;
  diagnostics.terminalDataChars += chars;
}

export function recordTerminalWrite(
  chars: number,
  receivedAt: number,
  writeStartedAt: number,
  writeCompletedAt: number,
): void {
  const diagnostics = ensureRendererTestPerformanceDiagnostics();
  if (!diagnostics) {
    return;
  }
  diagnostics.terminalWriteCount += 1;
  diagnostics.terminalWriteChars += chars;
  diagnostics.terminalWriteElapsedMs += writeCompletedAt - writeStartedAt;
  const deliveryLatency = Math.max(0, writeStartedAt - receivedAt);
  diagnostics.terminalDataToWriteLatencyTotalMs += deliveryLatency;
  diagnostics.terminalDataToWriteLatencyMaxMs = Math.max(
    diagnostics.terminalDataToWriteLatencyMaxMs,
    deliveryLatency,
  );
}

export function recordStreamPatchApplied(): void {
  const diagnostics = ensureRendererTestPerformanceDiagnostics();
  if (diagnostics) diagnostics.streamPatchAppliedCount += 1;
}

export function recordStreamPatchSkipped(): void {
  const diagnostics = ensureRendererTestPerformanceDiagnostics();
  if (diagnostics) diagnostics.streamPatchSkippedCount += 1;
}

export function recordStreamPatchGap(): void {
  const diagnostics = ensureRendererTestPerformanceDiagnostics();
  if (diagnostics) diagnostics.streamPatchGapCount += 1;
}

export function recordStreamCursorUpdate(): void {
  const diagnostics = ensureRendererTestPerformanceDiagnostics();
  if (diagnostics) diagnostics.streamCursorUpdateCount += 1;
}

export function recordRendererCommit(kind: "react" | "markdown", actualDurationMs: number): void {
  const diagnostics = ensureRendererTestPerformanceDiagnostics();
  if (!diagnostics) {
    return;
  }
  if (kind === "react") {
    diagnostics.reactCommitCount += 1;
    diagnostics.reactRenderToLayoutElapsedMs += actualDurationMs;
    diagnostics.reactRenderToLayoutMaxMs = Math.max(diagnostics.reactRenderToLayoutMaxMs, actualDurationMs);
    return;
  }
  diagnostics.markdownRenderCount += 1;
  diagnostics.markdownRenderToLayoutElapsedMs += actualDurationMs;
  diagnostics.markdownRenderToLayoutMaxMs = Math.max(diagnostics.markdownRenderToLayoutMaxMs, actualDurationMs);
}

export function installRendererTestPerformanceDiagnostics(): () => void {
  const diagnostics = ensureRendererTestPerformanceDiagnostics();
  if (!diagnostics) {
    return () => undefined;
  }

  let active = true;
  let eventLoopTimer: number | undefined;
  let longTaskObserver: PerformanceObserver | undefined;
  let expectedEventLoopAt = performance.now() + 50;
  const memoryPerformance = performance as Performance & {
    memory?: {
      readonly usedJSHeapSize: number;
      readonly totalJSHeapSize: number;
      readonly jsHeapSizeLimit: number;
    };
  };
  diagnostics.memorySampleSupported = Boolean(memoryPerformance.memory);

  const sampleMemory = () => {
    const memory = memoryPerformance.memory;
    if (!memory) {
      return;
    }
    diagnostics.memorySampleCount += 1;
    diagnostics.memoryUsedHeapBytes = memory.usedJSHeapSize;
    diagnostics.memoryTotalHeapBytes = memory.totalJSHeapSize;
    diagnostics.memoryHeapLimitBytes = memory.jsHeapSizeLimit;
    diagnostics.memoryMaxUsedHeapBytes = Math.max(diagnostics.memoryMaxUsedHeapBytes, memory.usedJSHeapSize);
  };

  const reset = () => {
    for (const [key, value] of Object.entries(diagnostics)) {
      if (typeof value === "number") {
        (diagnostics as unknown as Record<string, number>)[key] = 0;
      }
    }
    expectedEventLoopAt = performance.now() + 50;
  };
  window.__piAppTestResetRenderDiagnostics = reset;

  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        diagnostics.longTaskCount += 1;
        diagnostics.longTaskTotalMs += entry.duration;
        diagnostics.longTaskMaxMs = Math.max(diagnostics.longTaskMaxMs, entry.duration);
      }
    });
    longTaskObserver.observe({ type: "longtask", buffered: true });
    diagnostics.longTaskSupported = true;
  } catch {
    diagnostics.longTaskSupported = false;
  }

  const sampleEventLoop = () => {
    if (!active) {
      return;
    }
    const now = performance.now();
    const lag = Math.max(0, now - expectedEventLoopAt);
    sampleMemory();
    diagnostics.eventLoopSampleCount += 1;
    diagnostics.eventLoopLagTotalMs += lag;
    diagnostics.eventLoopLagMaxMs = Math.max(diagnostics.eventLoopLagMaxMs, lag);
    expectedEventLoopAt = now + 50;
    eventLoopTimer = window.setTimeout(sampleEventLoop, 50);
  };
  eventLoopTimer = window.setTimeout(sampleEventLoop, 50);

  const recordInput = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const kind = target.closest("textarea")
      ? "composer"
      : target.closest('[data-testid="send"], .button--cta-icon')
        ? "sendControl"
        : target.closest('[data-testid="timeline-pane"]')
          ? "timeline"
          : undefined;
    if (!kind) {
      return;
    }
    const startedAt = performance.now();
    window.requestAnimationFrame(() => {
      if (!active) {
        return;
      }
      const latency = Math.max(0, performance.now() - startedAt);
      if (kind === "composer") {
        diagnostics.composerInputCount += 1;
        diagnostics.composerInputLatencyTotalMs += latency;
        diagnostics.composerInputLatencyMaxMs = Math.max(diagnostics.composerInputLatencyMaxMs, latency);
      } else if (kind === "sendControl") {
        diagnostics.sendControlInputCount += 1;
        diagnostics.sendControlInputLatencyTotalMs += latency;
        diagnostics.sendControlInputLatencyMaxMs = Math.max(diagnostics.sendControlInputLatencyMaxMs, latency);
      } else {
        diagnostics.timelineInputCount += 1;
        diagnostics.timelineInputLatencyTotalMs += latency;
        diagnostics.timelineInputLatencyMaxMs = Math.max(diagnostics.timelineInputLatencyMaxMs, latency);
      }
    });
  };
  document.addEventListener("keydown", recordInput, true);
  document.addEventListener("input", recordInput, true);
  document.addEventListener("pointerdown", recordInput, true);
  document.addEventListener("click", recordInput, true);

  return () => {
    active = false;
    if (eventLoopTimer !== undefined) {
      window.clearTimeout(eventLoopTimer);
    }
    longTaskObserver?.disconnect();
    document.removeEventListener("keydown", recordInput, true);
    document.removeEventListener("input", recordInput, true);
    document.removeEventListener("pointerdown", recordInput, true);
    document.removeEventListener("click", recordInput, true);
    if (window.__piAppTestResetRenderDiagnostics === reset) {
      delete window.__piAppTestResetRenderDiagnostics;
    }
  };
}
