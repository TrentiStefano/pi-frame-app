import type { PiDesktopApi } from "./ipc";

export {};

declare global {
  interface Window {
    piApp?: PiDesktopApi;
    __piAppTestMode?: boolean;
    __piAppTestResetRenderDiagnostics?: () => void;
    __piAppTestRenderDiagnostics?: {
      stateReceiptCount: number;
      stateReceiptElapsedMs: number;
      rafScheduledCount: number;
      rafFlushCount: number;
      rafFlushElapsedMs: number;
      longTaskSupported: boolean;
      longTaskCount: number;
      longTaskTotalMs: number;
      longTaskMaxMs: number;
      eventLoopSampleCount: number;
      eventLoopLagTotalMs: number;
      eventLoopLagMaxMs: number;
      memorySampleSupported: boolean;
      memorySampleCount: number;
      memoryUsedHeapBytes: number;
      memoryTotalHeapBytes: number;
      memoryHeapLimitBytes: number;
      memoryMaxUsedHeapBytes: number;
      composerInputCount: number;
      composerInputLatencyTotalMs: number;
      composerInputLatencyMaxMs: number;
      sendControlInputCount: number;
      sendControlInputLatencyTotalMs: number;
      sendControlInputLatencyMaxMs: number;
      timelineInputCount: number;
      timelineInputLatencyTotalMs: number;
      timelineInputLatencyMaxMs: number;
      terminalDataEventCount: number;
      terminalDataChars: number;
      terminalWriteCount: number;
      terminalWriteChars: number;
      terminalWriteElapsedMs: number;
      terminalDataToWriteLatencyTotalMs: number;
      terminalDataToWriteLatencyMaxMs: number;
      reactCommitCount: number;
      reactRenderToLayoutElapsedMs: number;
      reactRenderToLayoutMaxMs: number;
      markdownRenderCount: number;
      markdownRenderToLayoutElapsedMs: number;
      markdownRenderToLayoutMaxMs: number;
      streamPatchAppliedCount: number;
      streamPatchSkippedCount: number;
      streamPatchGapCount: number;
      streamCursorUpdateCount: number;
    };
  }
}
