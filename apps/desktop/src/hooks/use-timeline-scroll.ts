import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import type { AppView, SelectedTranscriptRecord } from "../desktop-state";
import { VIRTUALIZATION_THRESHOLD } from "../conversation-timeline";

export type SidePanelMode = "changes" | "files" | "browser" | "plan";

const TIMELINE_SCROLL_INTENT_WINDOW_MS = 750;

interface TimelineOffBottomState {
  readonly scrollTop: number;
  readonly transcriptMarker: string;
}

interface UseTimelineScrollOptions {
  readonly selectedSessionKey: string;
  readonly activeTranscript: SelectedTranscriptRecord["transcript"];
  readonly selectedSession: unknown;
  readonly selectedTranscriptForSession: unknown;
  readonly activeView: AppView | undefined;
  readonly sidePanelMode: SidePanelMode | null;
  readonly timelinePaneRef: MutableRefObject<HTMLDivElement | null>;
}

export function useTimelineScroll({
  selectedSessionKey,
  activeTranscript,
  selectedSession,
  selectedTranscriptForSession,
  activeView,
  sidePanelMode,
  timelinePaneRef,
}: UseTimelineScrollOptions) {
  const hasSelectedSession = Boolean(selectedSession);
  const isTranscriptLoading = Boolean(selectedSession) && !selectedTranscriptForSession;
  const lastTranscriptMarkerRef = useRef("");
  const pinnedToBottomRef = useRef(true);
  const previousTimelinePaneSizeRef = useRef<{ width: number; height: number } | null>(null);
  const lastTimelineScrollTopBySessionRef = useRef(new Map<string, number>());
  const lastTimelinePinnedBySessionRef = useRef(new Map<string, boolean>());
  const lastTimelineOffBottomStateBySessionRef = useRef(new Map<string, TimelineOffBottomState>());
  const preserveBottomOnNextPaneResizeRef = useRef(false);
  const exactBottomRestoreSessionKeyRef = useRef<string | null>(null);
  const deferredPinnedBottomAlignmentRef = useRef(false);
  const pendingPinnedBottomBehaviorRef = useRef<ScrollBehavior>("auto");
  const bottomAlignmentGenerationRef = useRef(0);
  const offBottomRestoreGenerationRef = useRef(0);
  const restoredTimelineScrollSessionKeyRef = useRef("");
  const protectedTimelineScrollSessionKeysRef = useRef(new Set<string>());
  const timelineScrollSaveGuardRef = useRef<string | null>(null);
  const timelineScrollIntentUntilRef = useRef(0);
  const selectedSessionKeyRef = useRef("");
  const timelinePrevViewRef = useRef<AppView | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [timelinePaneMountVersion, setTimelinePaneMountVersion] = useState(0);
  const [disableTimelineVirtualization, setDisableTimelineVirtualization] = useState(false);

  selectedSessionKeyRef.current = selectedSessionKey;

  const resetExactBottomRestoreState = (nextSessionKey: string | null = null) => {
    exactBottomRestoreSessionKeyRef.current = nextSessionKey;
    deferredPinnedBottomAlignmentRef.current = false;
    pendingPinnedBottomBehaviorRef.current = "auto";
  };
  const clearTimelineOffBottomState = (sessionKey: string) => {
    lastTimelineOffBottomStateBySessionRef.current.delete(sessionKey);
  };
  const hasTimelineOffBottomState = (sessionKey: string) =>
    lastTimelineOffBottomStateBySessionRef.current.has(sessionKey);
  const saveTimelineOffBottomState = (sessionKey: string, pane: HTMLDivElement) => {
    lastTimelineOffBottomStateBySessionRef.current.set(sessionKey, {
      scrollTop: pane.scrollTop,
      transcriptMarker: buildTranscriptChangeMarker(sessionKey, activeTranscript),
    });
  };
  const restoreTimelineOffBottomState = (sessionKey: string, pane: HTMLDivElement) => {
    const savedState = lastTimelineOffBottomStateBySessionRef.current.get(sessionKey);
    if (!savedState) {
      return false;
    }

    pane.scrollTop = savedState.scrollTop;
    return true;
  };
  const cancelPendingTimelineOffBottomRestore = (sessionKey: string) => {
    if (!sessionKey || !protectedTimelineScrollSessionKeysRef.current.has(sessionKey)) {
      return;
    }
    offBottomRestoreGenerationRef.current += 1;
    protectedTimelineScrollSessionKeysRef.current.delete(sessionKey);
  };
  // Two useLayoutEffect cleanups both save timeline scroll on a session switch; they fire in the
  // same commit, so dedupe by session key to run the save (and consume the single-use protection
  // guard) exactly once. Otherwise the second, unguarded save clobbers the saved off-bottom read
  // position.
  const saveTimelineScrollStateOnLeave = (sessionKey: string) => {
    const pane = timelinePaneRef.current;
    if (!pane || !sessionKey) {
      return;
    }
    if (timelineScrollSaveGuardRef.current === sessionKey) {
      return;
    }
    timelineScrollSaveGuardRef.current = sessionKey;
    queueMicrotask(() => {
      if (timelineScrollSaveGuardRef.current === sessionKey) {
        timelineScrollSaveGuardRef.current = null;
      }
    });
    if (protectedTimelineScrollSessionKeysRef.current.has(sessionKey)) {
      // Keep the protection through the pane transition. The old pane can emit
      // a final programmatic scroll while the next session is mounting; that
      // event must not erase the saved off-bottom position.
      return;
    }
    const pinned = isNearBottom(pane);
    lastTimelineScrollTopBySessionRef.current.set(sessionKey, pane.scrollTop);
    lastTimelinePinnedBySessionRef.current.set(sessionKey, pinned);
    // A pane cleanup can observe a programmatic alignment from the next
    // session. Only an active user scroll to the bottom should discard the
    // saved off-bottom position.
    if (pinned && window.performance.now() <= timelineScrollIntentUntilRef.current) {
      clearTimelineOffBottomState(sessionKey);
    }
  };

  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior = "auto", maxChecks = 6) => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return;
    }

    if (
      selectedSessionKey &&
      hasTimelineOffBottomState(selectedSessionKey) &&
      !pinnedToBottomRef.current
    ) {
      return;
    }

    const alignmentGeneration = bottomAlignmentGenerationRef.current + 1;
    bottomAlignmentGenerationRef.current = alignmentGeneration;

    const align = (remainingChecks: number) => {
      if (alignmentGeneration !== bottomAlignmentGenerationRef.current) {
        return;
      }
      if (behavior === "auto") {
        pane.scrollTop = pane.scrollHeight;
      } else {
        pane.scrollTo({ top: pane.scrollHeight, behavior });
      }
      pinnedToBottomRef.current = true;
      lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
      lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, true);
      if (!protectedTimelineScrollSessionKeysRef.current.has(selectedSessionKey)) {
        clearTimelineOffBottomState(selectedSessionKey);
      }
      setShowJumpToLatest(false);

      if (remainingChecks <= 0) {
        return;
      }

      window.requestAnimationFrame(() => {
        if (alignmentGeneration !== bottomAlignmentGenerationRef.current) {
          return;
        }
        const remaining = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
        if (remaining > 1 || remainingChecks > 1) {
          align(remainingChecks - 1);
        }
      });
    };

    align(maxChecks);
  }, [selectedSessionKey]);

  const requestPinnedBottomAlignment = useCallback((
    behavior: ScrollBehavior = "auto",
    options?: { readonly preferExactRestore?: boolean; readonly maxChecks?: number },
  ) => {
    if (
      selectedSessionKey &&
      hasTimelineOffBottomState(selectedSessionKey) &&
      !pinnedToBottomRef.current
    ) {
      return;
    }

    if (exactBottomRestoreSessionKeyRef.current === selectedSessionKey && selectedSessionKey) {
      pendingPinnedBottomBehaviorRef.current = behavior;
      deferredPinnedBottomAlignmentRef.current = true;
      return;
    }

    if (options?.preferExactRestore && selectedSessionKey && activeTranscript.length > VIRTUALIZATION_THRESHOLD) {
      exactBottomRestoreSessionKeyRef.current = selectedSessionKey;
      pendingPinnedBottomBehaviorRef.current = behavior;
      preserveBottomOnNextPaneResizeRef.current = true;
      setDisableTimelineVirtualization(true);
      return;
    }

    scrollTimelineToBottom(behavior, options?.maxChecks ?? 6);
  }, [activeTranscript.length, scrollTimelineToBottom, selectedSessionKey]);

  const finalizeTimelineVirtualizationDisable = useCallback(() => {
    const pane = timelinePaneRef.current;
    const restoreSessionKey = exactBottomRestoreSessionKeyRef.current;
    if (!pane || activeView !== "threads") {
      resetExactBottomRestoreState();
      setDisableTimelineVirtualization(false);
      return;
    }

    if (restoreSessionKey !== selectedSessionKey || !restoreSessionKey) {
      setDisableTimelineVirtualization(false);
      return;
    }

    const shouldRestoreBottom =
      pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current || deferredPinnedBottomAlignmentRef.current;
    if (!shouldRestoreBottom) {
      resetExactBottomRestoreState();
      setDisableTimelineVirtualization(false);
      return;
    }

    const finishRestore = (remainingChecks: number, stableChecks: number) => {
      window.requestAnimationFrame(() => {
        if (timelinePaneRef.current !== pane || exactBottomRestoreSessionKeyRef.current !== restoreSessionKey) {
          return;
        }

        if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
          scrollTimelineToBottom();
        }

        const remaining = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
        const nextStableChecks = remaining <= 16 ? stableChecks + 1 : 0;
        if (remainingChecks <= 1 || nextStableChecks >= 2) {
          const shouldApplyDeferredAlignment = deferredPinnedBottomAlignmentRef.current;
          resetExactBottomRestoreState();
          if (shouldApplyDeferredAlignment) {
            scrollTimelineToBottom();
          }
          preserveBottomOnNextPaneResizeRef.current = false;
          return;
        }

        finishRestore(remainingChecks - 1, nextStableChecks);
      });
    };

    if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
      scrollTimelineToBottom();
    }

    window.requestAnimationFrame(() => {
      if (timelinePaneRef.current !== pane || exactBottomRestoreSessionKeyRef.current !== restoreSessionKey) {
        return;
      }
      setDisableTimelineVirtualization(false);
      scrollTimelineToBottom(pendingPinnedBottomBehaviorRef.current);
      pendingPinnedBottomBehaviorRef.current = "auto";
      finishRestore(6, 0);
    });
  }, [scrollTimelineToBottom, selectedSessionKey, activeView]);

  const setTimelinePaneElement = useCallback((node: HTMLDivElement | null) => {
    timelinePaneRef.current = node;
    if (!node) {
      return;
    }

    setTimelinePaneMountVersion((current) => current + 1);

    const savedOffBottomState = lastTimelineOffBottomStateBySessionRef.current.get(selectedSessionKey);
    const savedPinned = lastTimelinePinnedBySessionRef.current.get(selectedSessionKey);
    const savedScrollTop = savedOffBottomState?.scrollTop ?? lastTimelineScrollTopBySessionRef.current.get(selectedSessionKey);

    if (!selectedSessionKey || activeView !== "threads") {
      setDisableTimelineVirtualization(false);
      return;
    }
    if (savedOffBottomState && isTranscriptLoading) {
      setDisableTimelineVirtualization(false);
      return;
    }

    const shouldRestoreBottom =
      !savedOffBottomState &&
      ((savedPinned ?? pinnedToBottomRef.current) || preserveBottomOnNextPaneResizeRef.current);
    if (shouldRestoreBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
      node.scrollTop = node.scrollHeight;
      window.requestAnimationFrame(() => {
        if (timelinePaneRef.current !== node) {
          return;
        }
        if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
          requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        }
      });
      return;
    }

    if (savedScrollTop == null && !savedOffBottomState) {
      setDisableTimelineVirtualization(false);
      return;
    }

    if (savedOffBottomState) {
      restoreTimelineOffBottomState(selectedSessionKey, node);
    } else {
      node.scrollTop = savedScrollTop ?? node.scrollTop;
    }
    const restoredPinned = isNearBottom(node);
    bottomAlignmentGenerationRef.current += 1;
    pinnedToBottomRef.current = restoredPinned;
    resetExactBottomRestoreState();
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, restoredPinned);
    if (restoredPinned && !protectedTimelineScrollSessionKeysRef.current.has(selectedSessionKey)) {
      clearTimelineOffBottomState(selectedSessionKey);
    }
    window.requestAnimationFrame(() => {
      if (timelinePaneRef.current !== node) {
        return;
      }
      setDisableTimelineVirtualization(false);
    });
  }, [isTranscriptLoading, requestPinnedBottomAlignment, selectedSessionKey, activeView]);

  const schedulePinnedBottomRealignment = useCallback((delayFrames = 0) => {
    const waitForFrames = (remainingFrames: number) => {
      window.requestAnimationFrame(() => {
        if (remainingFrames > 0) {
          waitForFrames(remainingFrames - 1);
          return;
        }
        requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        window.requestAnimationFrame(() => {
          preserveBottomOnNextPaneResizeRef.current = false;
          if (pinnedToBottomRef.current) {
            requestPinnedBottomAlignment("auto", { preferExactRestore: true });
          }
        });
      });
    };

    waitForFrames(delayFrames);
  }, [requestPinnedBottomAlignment]);

  useLayoutEffect(() => {
    const savedOffBottomState = selectedSessionKey
      ? lastTimelineOffBottomStateBySessionRef.current.get(selectedSessionKey)
      : undefined;
    const savedPinned = selectedSessionKey ? lastTimelinePinnedBySessionRef.current.get(selectedSessionKey) : undefined;
    const shouldRestorePinned = !savedOffBottomState
      ? savedPinned ?? true
      : false;
    setShowJumpToLatest(false);
    lastTranscriptMarkerRef.current = "";
    pinnedToBottomRef.current = shouldRestorePinned;
    timelineScrollIntentUntilRef.current = 0;
    previousTimelinePaneSizeRef.current = null;
    preserveBottomOnNextPaneResizeRef.current = false;
    restoredTimelineScrollSessionKeyRef.current = "";
    resetExactBottomRestoreState(shouldRestorePinned ? selectedSessionKey || null : null);
    setDisableTimelineVirtualization(false);

    return () => {
      saveTimelineScrollStateOnLeave(selectedSessionKey);
    };
  }, [selectedSessionKey]);

  useLayoutEffect(() => {
    if (activeView !== "threads" || !selectedSession || !selectedTranscriptForSession) {
      return;
    }
    if (exactBottomRestoreSessionKeyRef.current !== selectedSessionKey) {
      return;
    }
    if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) {
      return;
    }

    scrollTimelineToBottom();
  }, [
    activeTranscript,
    disableTimelineVirtualization,
    scrollTimelineToBottom,
    selectedSession,
    selectedSessionKey,
    selectedTranscriptForSession,
    activeView,
  ]);

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (
      !pane ||
      !selectedSessionKey ||
      activeView !== "threads" ||
      isTranscriptLoading ||
      restoredTimelineScrollSessionKeyRef.current === selectedSessionKey
    ) {
      return;
    }

    const savedOffBottomState = lastTimelineOffBottomStateBySessionRef.current.get(selectedSessionKey);
    if (!savedOffBottomState) {
      protectedTimelineScrollSessionKeysRef.current.delete(selectedSessionKey);
      restoredTimelineScrollSessionKeyRef.current = selectedSessionKey;
      return;
    }

    const restoreGeneration = offBottomRestoreGenerationRef.current + 1;
    offBottomRestoreGenerationRef.current = restoreGeneration;
    let shouldSuppressJumpForRestore = true;
    let restored = false;
    let protectionTimer: number | undefined;
    const applyRestore = () => {
      const currentPane = timelinePaneRef.current;
      if (
        offBottomRestoreGenerationRef.current !== restoreGeneration ||
        !currentPane ||
        selectedSessionKeyRef.current !== selectedSessionKey
      ) {
        return false;
      }
      const saved = lastTimelineOffBottomStateBySessionRef.current.get(selectedSessionKey);
      if (!saved) {
        return false;
      }
      // During session hydration the pane can still have the loading height.
      // Do not treat the clamped scrollTop=0 as a successful bottom restore;
      // that would clear the saved off-bottom position and pin the session to
      // the bottom when its transcript arrives a moment later.
      const maxScrollTop = Math.max(0, currentPane.scrollHeight - currentPane.clientHeight);
      if (saved.scrollTop > maxScrollTop + 1) {
        return false;
      }
      if (saved.scrollTop === 0 && maxScrollTop === 0) {
        return false;
      }
      currentPane.scrollTop = saved.scrollTop;
      const restoredPinned = isNearBottom(currentPane);
      bottomAlignmentGenerationRef.current += 1;
      pinnedToBottomRef.current = restoredPinned;
      preserveBottomOnNextPaneResizeRef.current = false;
      resetExactBottomRestoreState();
      lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, currentPane.scrollTop);
      lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, restoredPinned);
      if (restoredPinned && !protectedTimelineScrollSessionKeysRef.current.has(selectedSessionKey)) {
        clearTimelineOffBottomState(selectedSessionKey);
      }
      if (shouldSuppressJumpForRestore) {
        setShowJumpToLatest(false);
        shouldSuppressJumpForRestore = false;
      }
      restored = true;
      lastTranscriptMarkerRef.current = savedOffBottomState.transcriptMarker;
      restoredTimelineScrollSessionKeyRef.current = selectedSessionKey;
      setDisableTimelineVirtualization(false);
      protectionTimer = window.setTimeout(() => {
        if (
          offBottomRestoreGenerationRef.current === restoreGeneration &&
          selectedSessionKeyRef.current === selectedSessionKey
        ) {
          protectedTimelineScrollSessionKeysRef.current.delete(selectedSessionKey);
        }
      }, 300);
      return true;
    };

    const retryRestore = () => {
      if (restored) return;
      applyRestore();
    };
    const timers: number[] = [];
    retryRestore();
    const rafId = window.requestAnimationFrame(retryRestore);
    timers.push(window.setTimeout(retryRestore, 50));
    timers.push(window.setTimeout(retryRestore, 150));
    timers.push(window.setTimeout(retryRestore, 300));
    timers.push(window.setTimeout(retryRestore, 600));
    return () => {
      window.cancelAnimationFrame(rafId);
      for (const timerId of timers) {
        window.clearTimeout(timerId);
      }
      if (protectionTimer !== undefined) {
        window.clearTimeout(protectionTimer);
      }
    };
  }, [activeTranscript, isTranscriptLoading, selectedSessionKey, activeView]);

  useEffect(() => {
    if (activeView !== "threads") {
      previousTimelinePaneSizeRef.current = null;
      resetExactBottomRestoreState();
      timelinePrevViewRef.current = activeView ?? null;
      return;
    }

    if (timelinePrevViewRef.current !== "threads" && hasSelectedSession) {
      if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
        preserveBottomOnNextPaneResizeRef.current = true;
        schedulePinnedBottomRealignment(1);
      }
    }

    timelinePrevViewRef.current = activeView;
  }, [activeView, hasSelectedSession, schedulePinnedBottomRealignment]);

  const handleComposerHeightChange = useCallback(() => {
    const pane = timelinePaneRef.current;
    const shouldPreserveBottom = pane
      ? isNearBottom(pane) || pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current
      : pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current;
    if (!shouldPreserveBottom) {
      return;
    }

    preserveBottomOnNextPaneResizeRef.current = true;
    requestPinnedBottomAlignment("auto", { preferExactRestore: true });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        preserveBottomOnNextPaneResizeRef.current = false;
        if (pinnedToBottomRef.current) {
          requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        }
      });
    });
  }, [requestPinnedBottomAlignment, timelinePaneRef]);

  useLayoutEffect(() => {
    if (activeView !== "threads" || !selectedSession) {
      return undefined;
    }

    return () => {
      saveTimelineScrollStateOnLeave(selectedSessionKey);
    };
  }, [selectedSession, selectedSessionKey, activeView]);

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || !selectedSession || activeView !== "threads") {
      previousTimelinePaneSizeRef.current = null;
      return undefined;
    }

    const stickToBottomAfterLayoutChange = () => {
      preserveBottomOnNextPaneResizeRef.current = false;
      pinnedToBottomRef.current = true;
      window.requestAnimationFrame(() => {
        requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        window.requestAnimationFrame(() => {
          if (pinnedToBottomRef.current) {
            requestPinnedBottomAlignment("auto", { preferExactRestore: true });
          }
        });
      });
    };

    const updateMeasuredSize = (nextSize: { width: number; height: number }) => {
      const previousSize = previousTimelinePaneSizeRef.current;
      previousTimelinePaneSizeRef.current = nextSize;
      const shouldStickToBottom = preserveBottomOnNextPaneResizeRef.current || pinnedToBottomRef.current;
      const widthChanged = previousSize ? Math.abs(nextSize.width - previousSize.width) >= 1 : false;
      const heightChanged = previousSize ? Math.abs(nextSize.height - previousSize.height) >= 1 : false;
      if (!previousSize || (!widthChanged && !heightChanged) || !shouldStickToBottom) {
        return;
      }

      stickToBottomAfterLayoutChange();
    };

    const paneRect = pane.getBoundingClientRect();
    updateMeasuredSize({ width: paneRect.width, height: paneRect.height });

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      updateMeasuredSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });

    resizeObserver.observe(pane);
    return () => {
      resizeObserver.disconnect();
      previousTimelinePaneSizeRef.current = null;
    };
  }, [requestPinnedBottomAlignment, selectedSessionKey, sidePanelMode, activeView, timelinePaneMountVersion]);

  useEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || !selectedSession) {
      return;
    }

    const marker = buildTranscriptChangeMarker(selectedSessionKey, activeTranscript);
    if (marker === lastTranscriptMarkerRef.current) {
      return;
    }
    lastTranscriptMarkerRef.current = marker;

    if (pinnedToBottomRef.current) {
      requestPinnedBottomAlignment("auto", { maxChecks: 1 });
      return;
    }

    setShowJumpToLatest(true);
  }, [activeTranscript, requestPinnedBottomAlignment, selectedSession, selectedSessionKey]);

  const handleTimelineContentHeightChange = useCallback((state?: { readonly wasAtBottom: boolean }) => {
    if (state?.wasAtBottom) {
      pinnedToBottomRef.current = true;
    }
    if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) {
        return;
      }
      requestPinnedBottomAlignment("auto", { maxChecks: 1 });
    });
  }, [requestPinnedBottomAlignment]);

  const saveCurrentTimelineScrollState = () => {
    const pane = timelinePaneRef.current;
    if (!pane || !selectedSessionKey) {
      return;
    }
    const pinned = isNearBottom(pane);
    lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, pinned);
    if (pinned) {
      clearTimelineOffBottomState(selectedSessionKey);
    } else {
      preserveBottomOnNextPaneResizeRef.current = false;
      resetExactBottomRestoreState();
      bottomAlignmentGenerationRef.current += 1;
      saveTimelineOffBottomState(selectedSessionKey, pane);
      protectedTimelineScrollSessionKeysRef.current.add(selectedSessionKey);
    }
  };

  const handleTimelineScroll = () => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return;
    }

    const pinned = isNearBottom(pane);
    const hasRecentScrollIntent = window.performance.now() <= timelineScrollIntentUntilRef.current;
    if (
      !pinned &&
      !hasRecentScrollIntent &&
      (pinnedToBottomRef.current ||
        preserveBottomOnNextPaneResizeRef.current ||
        exactBottomRestoreSessionKeyRef.current === selectedSessionKey ||
        deferredPinnedBottomAlignmentRef.current)
    ) {
      pinnedToBottomRef.current = true;
      preserveBottomOnNextPaneResizeRef.current = true;
      lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, true);
      if (!protectedTimelineScrollSessionKeysRef.current.has(selectedSessionKey)) {
        clearTimelineOffBottomState(selectedSessionKey);
      }
      setShowJumpToLatest(false);
      requestPinnedBottomAlignment("auto", { preferExactRestore: true });
      return;
    }

    if (!pinned) {
      preserveBottomOnNextPaneResizeRef.current = false;
      resetExactBottomRestoreState();
      bottomAlignmentGenerationRef.current += 1;
    }

    pinnedToBottomRef.current = pinned;
    lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, pinned);
    if (pinned) {
      if (
        window.performance.now() <= timelineScrollIntentUntilRef.current &&
        !protectedTimelineScrollSessionKeysRef.current.has(selectedSessionKey)
      ) {
        clearTimelineOffBottomState(selectedSessionKey);
      }
    } else if (selectedSessionKey) {
      saveTimelineOffBottomState(selectedSessionKey, pane);
      protectedTimelineScrollSessionKeysRef.current.add(selectedSessionKey);
    }
    if (pinned) {
      setShowJumpToLatest(false);
    }
  };

  const handleTimelineScrollIntent = () => {
    timelineScrollIntentUntilRef.current = window.performance.now() + TIMELINE_SCROLL_INTENT_WINDOW_MS;
    cancelPendingTimelineOffBottomRestore(selectedSessionKey);
  };

  const jumpToLatest = () => {
    cancelPendingTimelineOffBottomRestore(selectedSessionKey);
    if (selectedSessionKey) {
      clearTimelineOffBottomState(selectedSessionKey);
    }
    pinnedToBottomRef.current = true;
    requestPinnedBottomAlignment("smooth", { preferExactRestore: true });
  };

  // Capture the current pinned state before a layout change (e.g. toggling a side panel) so the
  // caller can restore the bottom-pinned position after the resize settles.
  const beginPreserveTimelineBottom = useCallback((): boolean => {
    const pane = timelinePaneRef.current;
    const shouldPreserveBottom = pane ? isNearBottom(pane) || pinnedToBottomRef.current : pinnedToBottomRef.current;
    if (shouldPreserveBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
    }
    return shouldPreserveBottom;
  }, [timelinePaneRef]);

  return {
    setTimelinePaneElement,
    disableTimelineVirtualization,
    finalizeTimelineVirtualizationDisable,
    handleTimelineScroll,
    handleTimelineScrollIntent,
    handleTimelineContentHeightChange,
    handleComposerHeightChange,
    showJumpToLatest,
    jumpToLatest,
    saveCurrentTimelineScrollState,
    beginPreserveTimelineBottom,
    schedulePinnedBottomRealignment,
  };
}

function buildTranscriptChangeMarker(sessionKey: string, transcript: SelectedTranscriptRecord["transcript"]): string {
  const lastItem = transcript.at(-1);
  if (!lastItem) {
    return `${sessionKey}:0`;
  }
  let itemVersion: string;
  switch (lastItem.kind) {
    case "message":
      itemVersion = `${lastItem.role}:${lastItem.text.length}:${lastItem.attachments?.length ?? 0}`;
      break;
    case "tool":
      itemVersion = `${lastItem.status}:${lastItem.detail ?? ""}:${lastItem.metadata ?? ""}`;
      break;
    case "activity":
      itemVersion = `${lastItem.label}:${lastItem.detail ?? ""}:${lastItem.metadata ?? ""}`;
      break;
    case "summary":
      itemVersion = `${lastItem.label}:${lastItem.metadata ?? ""}`;
      break;
  }
  return `${sessionKey}:${transcript.length}:${lastItem.id}:${itemVersion}`;
}

function isNearBottom(element: HTMLDivElement): boolean {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining < 32;
}
