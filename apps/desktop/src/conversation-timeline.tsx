import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type RefCallback, type RefObject } from "react";
import type { TranscriptMessage } from "./desktop-state";
import type { DisplayTimelineItem } from "./timeline-types";
import { buildDisplayTimelineItems } from "./timeline-turns";
import { ThreadSearchBar } from "./thread-search";
import { TimelineItem } from "./timeline-item";
import { SparkIcon } from "./icons";
import { useTranslation } from "react-i18next";
import type { BrowserElementAttachment } from "./browser-types";
import { recordRendererCommit } from "./test-performance-diagnostics";
import { useElasticScroll } from "./use-elastic-scroll";

const OVERSCAN_PX = 720;
const ROW_GAP_PX = 14;
export const VIRTUALIZATION_THRESHOLD = 20;
const EMPTY_EXPANDED_TOOL_ITEMS = new Set<string>();

interface ThreadSearchModel {
  readonly isOpen: boolean;
  readonly query: string;
  readonly matchCount: number;
  readonly activeIndex: number;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly search: (query: string) => void;
  readonly goToMatch: (direction: 1 | -1) => void;
  readonly close: () => void;
}

interface ConversationTimelineProps {
  readonly transcript: readonly TranscriptMessage[];
  readonly sessionKey: string;
  readonly isTranscriptLoading: boolean;
  readonly streamingAssistantMessageId?: string;
  readonly timelinePaneRef: MutableRefObject<HTMLDivElement | null>;
  readonly timelinePaneElementRef?: RefCallback<HTMLDivElement>;
  readonly disableVirtualization?: boolean;
  readonly onDisableVirtualizationReady?: () => void;
  readonly onTimelineScroll: () => void;
  readonly onTimelineScrollIntent?: () => void;
  readonly threadSearch: ThreadSearchModel;
  readonly showJumpToLatest: boolean;
  readonly onJumpToLatest: () => void;
  readonly onContentHeightChange: (state?: { readonly wasAtBottom: boolean }) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onViewPlan?: () => void;
  readonly onForkFromMessage?: (messageIndex: number, preview?: string) => void;
  readonly onOpenBrowserAttachment?: (attachment: BrowserElementAttachment) => void;
  readonly hideThinking?: boolean;
}

export function ConversationTimeline({
  transcript,
  sessionKey,
  isTranscriptLoading,
  streamingAssistantMessageId,
  timelinePaneRef,
  timelinePaneElementRef,
  disableVirtualization = false,
  onDisableVirtualizationReady,
  onTimelineScroll,
  onTimelineScrollIntent,
  threadSearch,
  showJumpToLatest,
  onJumpToLatest,
  onContentHeightChange,
  onViewFileInDiff,
  onViewPlan,
  onForkFromMessage,
  onOpenBrowserAttachment,
  hideThinking = false,
}: ConversationTimelineProps) {
  const { t } = useTranslation();
  const renderStartedAtRef = useRef<number | null>(null);
  renderStartedAtRef.current = window.__piAppTestMode ? performance.now() : null;
  useLayoutEffect(() => {
    const startedAt = renderStartedAtRef.current;
    if (startedAt === null) {
      return;
    }
    recordRendererCommit("react", performance.now() - startedAt);
    renderStartedAtRef.current = null;
  });
  const renderedMessageIndexById = useMemo(() => {
    const map = new Map<string, number>();
    let messageIndex = 0;
    for (const item of transcript) {
      if (item.kind !== "message") {
        continue;
      }
      map.set(item.id, messageIndex);
      messageIndex += 1;
    }
    return map;
  }, [transcript]);

  const displayItems = useMemo(() => buildDisplayTimelineItems(transcript), [transcript]);
  const shouldVirtualize =
    !threadSearch.isOpen &&
    transcript.length > VIRTUALIZATION_THRESHOLD;
  const [expandedToolItemState, setExpandedToolItemState] = useState<{
    readonly sessionKey: string;
    readonly ids: Set<string>;
  }>(() => ({ sessionKey, ids: new Set() }));
  const expandedToolItemIds = expandedToolItemState.sessionKey === sessionKey
    ? expandedToolItemState.ids
    : EMPTY_EXPANDED_TOOL_ITEMS;
  const measuredHeightsBySessionRef = useRef(new Map<string, Map<string, number>>());
  let measuredHeights = measuredHeightsBySessionRef.current.get(sessionKey);
  if (!measuredHeights) {
    measuredHeights = new Map<string, number>();
    measuredHeightsBySessionRef.current.set(sessionKey, measuredHeights);
    if (measuredHeightsBySessionRef.current.size > 12) {
      const oldestKey = measuredHeightsBySessionRef.current.keys().next().value as string | undefined;
      if (oldestKey && oldestKey !== sessionKey) {
        measuredHeightsBySessionRef.current.delete(oldestKey);
      }
    }
  }
  const measuredHeightsRef = useRef(measuredHeights);
  measuredHeightsRef.current = measuredHeights;
  const [measurementVersion, setMeasurementVersion] = useState(0);

  useLayoutEffect(() => {
    const availableToolItemIds = new Set(
      displayItems.flatMap((item) => {
        if (item.kind === "tool") {
          return [item.callId];
        }
        if (item.kind === "tool-group") {
          return [item.id];
        }
        return [];
      }),
    );
    setExpandedToolItemState((current) => {
      if (current.sessionKey !== sessionKey) {
        return { sessionKey, ids: new Set() };
      }
      if (current.ids.size === 0) {
        return current;
      }
      let changed = false;
      const next = new Set<string>();
      for (const itemId of current.ids) {
        if (!availableToolItemIds.has(itemId)) {
          changed = true;
          continue;
        }
        next.add(itemId);
      }
      return changed ? { sessionKey, ids: next } : current;
    });
  }, [displayItems, sessionKey]);

  useLayoutEffect(() => {
    const knownIds = new Set(displayItems.map((item) => item.id));
    let removedAny = false;
    for (const id of measuredHeightsRef.current.keys()) {
      if (knownIds.has(id)) {
        continue;
      }
      measuredHeightsRef.current.delete(id);
      removedAny = true;
    }
    if (removedAny) {
      setMeasurementVersion((current) => current + 1);
    }
  }, [displayItems]);

  useLayoutEffect(() => {
    if (!disableVirtualization || isTranscriptLoading || transcript.length === 0) {
      return;
    }
    if (shouldVirtualize) {
      const frame = window.requestAnimationFrame(() => onDisableVirtualizationReady?.());
      return () => window.cancelAnimationFrame(frame);
    }
    const allRowsMeasured = displayItems.every((item) => measuredHeightsRef.current.has(item.id));
    if (!allRowsMeasured) {
      return;
    }
    onDisableVirtualizationReady?.();
  }, [disableVirtualization, displayItems, isTranscriptLoading, measurementVersion, onDisableVirtualizationReady, shouldVirtualize, transcript.length]);

  const toggleToolItem = useCallback((itemId: string) => {
    setExpandedToolItemState((current) => {
      const ids = current.sessionKey === sessionKey ? current.ids : EMPTY_EXPANDED_TOOL_ITEMS;
      const next = new Set(ids);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return { sessionKey, ids: next };
    });
  }, [sessionKey]);

  const updateMeasuredHeight = useCallback((id: string, height: number) => {
    const nextHeight = Math.max(1, Math.ceil(height));
    const currentHeight = measuredHeightsRef.current.get(id);
    if (currentHeight === nextHeight) {
      return;
    }
    measuredHeightsRef.current.set(id, nextHeight);
    if (shouldVirtualize || disableVirtualization) {
      setMeasurementVersion((current) => current + 1);
    }
  }, [disableVirtualization, shouldVirtualize]);

  const assignTimelinePaneRef = useCallback((node: HTMLDivElement | null) => {
    timelinePaneRef.current = node;
    timelinePaneElementRef?.(node);
  }, [timelinePaneElementRef, timelinePaneRef]);

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return undefined;
    }

    pane.addEventListener("scroll", onTimelineScroll, { passive: true });
    return () => {
      pane.removeEventListener("scroll", onTimelineScroll);
    };
  }, [onTimelineScroll, timelinePaneRef]);

  const elasticWrapperRef = useRef<HTMLDivElement | null>(null);
  useElasticScroll(timelinePaneRef, elasticWrapperRef, {
    disabled: Boolean(streamingAssistantMessageId),
  });

  return (
    <div
      className="timeline-pane timeline-pane--thread"
      data-testid="timeline-pane"
      ref={assignTimelinePaneRef}
      onPointerDown={onTimelineScrollIntent}
      onWheel={onTimelineScrollIntent}
    >
      {threadSearch.isOpen ? (
        <ThreadSearchBar
          query={threadSearch.query}
          matchCount={threadSearch.matchCount}
          activeIndex={threadSearch.activeIndex}
          inputRef={threadSearch.inputRef}
          onSearch={threadSearch.search}
          onNext={() => threadSearch.goToMatch(1)}
          onPrev={() => threadSearch.goToMatch(-1)}
          onClose={threadSearch.close}
        />
      ) : null}
      <div className="timeline-elastic-wrapper" ref={elasticWrapperRef}>
        {isTranscriptLoading ? (
          <div className="timeline" data-testid="transcript">
            <TranscriptSkeleton />
          </div>
        ) : transcript.length === 0 ? (
          <div className="timeline" data-testid="transcript">
            <TranscriptEmptyState />
          </div>
        ) : shouldVirtualize ? (
          <VirtualizedTranscriptList
            displayItems={displayItems}
            timelinePaneRef={timelinePaneRef}
            onContentHeightChange={onContentHeightChange}
            measuredHeightsRef={measuredHeightsRef}
            measurementVersion={measurementVersion}
            expandedToolCallIds={expandedToolItemIds}
            streamingAssistantMessageId={streamingAssistantMessageId}
            onHeightChange={updateMeasuredHeight}
            onToggleToolCall={toggleToolItem}
            onViewFileInDiff={onViewFileInDiff}
            onViewPlan={onViewPlan}
            renderedMessageIndexById={renderedMessageIndexById}
            onForkFromMessage={onForkFromMessage}
            onOpenBrowserAttachment={onOpenBrowserAttachment}
            hideThinking={hideThinking}
          />
        ) : (
          <div className="timeline" data-testid="transcript">
            {displayItems.map((item) => (
              <MeasuredTimelineItem
                item={item}
                key={item.id}
                onHeightChange={updateMeasuredHeight}
                expanded={isToolItemExpanded(item, expandedToolItemIds)}
                streaming={item.id === streamingAssistantMessageId}
                onToggleToolCall={toggleToolItem}
                onViewFileInDiff={onViewFileInDiff}
                onViewPlan={onViewPlan}
                sourceMessageIndex={renderedMessageIndexById.get(item.id)}
                onForkFromMessage={onForkFromMessage}
                onOpenBrowserAttachment={onOpenBrowserAttachment}
                hideThinking={hideThinking}
              />
            ))}
          </div>
        )}
      </div>
      {showJumpToLatest ? (
        <button className="timeline-jump" data-testid="timeline-jump" type="button" onClick={onJumpToLatest}>
          {t("conversation.newActivityBelow")}
        </button>
      ) : null}
    </div>
  );
}

function TranscriptSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="transcript-skeleton" data-testid="transcript-skeleton" aria-hidden="true">
      <div className="transcript-skeleton__row transcript-skeleton__row--user">
        <span className="skeleton-line" style={{ width: "42%" }} />
      </div>
      <div className="transcript-skeleton__row">
        <span className="skeleton-line" style={{ width: "88%" }} />
        <span className="skeleton-line" style={{ width: "94%" }} />
        <span className="skeleton-line" style={{ width: "66%" }} />
      </div>
      <div className="transcript-skeleton__row transcript-skeleton__row--tool">
        <span className="skeleton-line skeleton-line--tool" style={{ width: "38%" }} />
      </div>
      <div className="transcript-skeleton__row">
        <span className="skeleton-line" style={{ width: "80%" }} />
        <span className="skeleton-line" style={{ width: "72%" }} />
      </div>
      <span className="sr-only">{t("conversation.loadingTranscript")}</span>
    </div>
  );
}

function TranscriptEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="transcript-empty" data-testid="transcript-empty">
      <span className="transcript-empty__glyph" aria-hidden="true">
        <SparkIcon />
      </span>
      <p className="transcript-empty__title">{t("conversation.emptyTitle")}</p>
      <p className="transcript-empty__hint">{t("conversation.emptyDescription")}</p>
    </div>
  );
}

function VirtualizedTranscriptList({
  displayItems,
  timelinePaneRef,
  onContentHeightChange,
  measuredHeightsRef,
  measurementVersion,
  expandedToolCallIds,
  streamingAssistantMessageId,
  onHeightChange,
  onToggleToolCall,
  onViewFileInDiff,
  onViewPlan,
  renderedMessageIndexById,
  onForkFromMessage,
  onOpenBrowserAttachment,
  hideThinking,
}: {
  readonly displayItems: readonly DisplayTimelineItem[];
  readonly timelinePaneRef: MutableRefObject<HTMLDivElement | null>;
  readonly onContentHeightChange: (state?: { readonly wasAtBottom: boolean }) => void;
  readonly measuredHeightsRef: MutableRefObject<Map<string, number>>;
  readonly measurementVersion: number;
  readonly expandedToolCallIds: ReadonlySet<string>;
  readonly streamingAssistantMessageId?: string;
  readonly onHeightChange: (id: string, height: number) => void;
  readonly onToggleToolCall: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onViewPlan?: () => void;
  readonly renderedMessageIndexById: ReadonlyMap<string, number>;
  readonly onForkFromMessage?: (messageIndex: number, preview?: string) => void;
  readonly onOpenBrowserAttachment?: (attachment: BrowserElementAttachment) => void;
  readonly hideThinking?: boolean;
}) {
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  const previousTotalHeightRef = useRef(0);
  const previousLayoutRef = useRef<{
    readonly offsets: readonly number[];
    readonly heights: readonly number[];
    readonly totalHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    const syncViewport = () => {
      const pane = timelinePaneRef.current;
      if (!pane) {
        return;
      }
      const nextScrollTop = pane.scrollTop;
      const nextHeight = pane.clientHeight;
      setViewport((current) =>
        current.scrollTop === nextScrollTop && current.height === nextHeight
          ? current
          : { scrollTop: nextScrollTop, height: nextHeight },
      );
    };

    syncViewport();
    // Listen above the pane so this remains attached when the timeline pane is
    // remounted during session/view changes. Scroll is captured because it
    // does not bubble.
    window.addEventListener("scroll", syncViewport, { passive: true, capture: true });
    window.addEventListener("wheel", syncViewport, { passive: true, capture: true });
    const resizeObserver = new ResizeObserver(syncViewport);
    const pane = timelinePaneRef.current;
    if (pane) {
      resizeObserver.observe(pane);
    }

    return () => {
      window.removeEventListener("scroll", syncViewport, true);
      window.removeEventListener("wheel", syncViewport, true);
      resizeObserver.disconnect();
    };
  }, [timelinePaneRef]);

  const rowHeights = displayItems.map((item) => measuredHeightsRef.current.get(item.id) ?? estimateTimelineItemHeight(item));
  const rowOffsets: number[] = [];
  let totalHeight = 0;
  for (const [index, rowHeight] of rowHeights.entries()) {
    rowOffsets[index] = totalHeight;
    totalHeight += rowHeight;
    if (index < rowHeights.length - 1) {
      totalHeight += ROW_GAP_PX;
    }
  }

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return;
    }
    const nextScrollTop = pane.scrollTop;
    const nextHeight = pane.clientHeight;
    setViewport((current) =>
      current.scrollTop === nextScrollTop && current.height === nextHeight
        ? current
        : { scrollTop: nextScrollTop, height: nextHeight },
    );
  });

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    const previousLayout = previousLayoutRef.current;
    if (previousLayout && pane && previousLayout.totalHeight !== totalHeight) {
      const wasAtBottom = previousLayout.totalHeight - pane.scrollTop - pane.clientHeight < 32;
      if (!wasAtBottom && previousLayout.offsets.length > 0) {
        const anchorIndex = findStartIndex(
          previousLayout.offsets,
          previousLayout.heights,
          pane.scrollTop,
        );
        const previousAnchorOffset = previousLayout.offsets[anchorIndex] ?? 0;
        const nextAnchorOffset = rowOffsets[anchorIndex] ?? previousAnchorOffset;
        pane.scrollTop += nextAnchorOffset - previousAnchorOffset;
      }
    }

    previousLayoutRef.current = {
      offsets: [...rowOffsets],
      heights: [...rowHeights],
      totalHeight,
    };

    const previousTotalHeight = previousTotalHeightRef.current;
    if (previousTotalHeight === totalHeight) {
      return;
    }
    previousTotalHeightRef.current = totalHeight;
    const wasAtBottom = pane
      ? previousTotalHeight > 0
        ? previousTotalHeight - pane.scrollTop - pane.clientHeight < 32
        : false
      : false;
    if (wasAtBottom && pane) {
      // Keep the native scroll position exact before the parent schedules its
      // follow-up alignment. This closes the frame where late measurement
      // growth could leave a pinned transcript a few hundred pixels above the
      // true bottom.
      pane.scrollTop = pane.scrollHeight;
    }
    onContentHeightChange({ wasAtBottom });
  }, [displayItems, measurementVersion, onContentHeightChange, timelinePaneRef, totalHeight]);

  // Read the current pane position after the scroll listener has scheduled a
  // render. The global listener above keeps this component reactive even when
  // the pane was remounted; the live read also preserves programmatic scroll
  // restoration performed by the parent hook.
  const pane = timelinePaneRef.current;
  const currentScrollTop = pane?.scrollTop ?? viewport.scrollTop;
  const currentViewportHeight = pane?.clientHeight ?? viewport.height;
  const startOffset = Math.max(0, currentScrollTop - OVERSCAN_PX);
  const endOffset = currentScrollTop + currentViewportHeight + OVERSCAN_PX;
  const calculatedStartIndex = findStartIndex(rowOffsets, rowHeights, startOffset);
  const calculatedEndIndex = findEndIndex(rowOffsets, endOffset);
  // Keep a non-empty render window even while row measurements and scroll
  // state settle. A virtualized transcript must never expose a blank pane for
  // a non-empty transcript.
  const startIndex = Math.min(calculatedStartIndex, Math.max(0, displayItems.length - 1));
  const endIndex = Math.max(
    calculatedEndIndex,
    Math.min(displayItems.length, startIndex + 1),
  );

  return (
    <div className="timeline timeline--virtualized" data-testid="transcript" style={{ height: `${totalHeight}px` }}>
      {displayItems.slice(startIndex, endIndex).map((item, offsetIndex) => {
        const index = startIndex + offsetIndex;
        return (
          <MeasuredTimelineItem
            item={item}
            key={item.id}
            className="timeline__virtual-row"
            top={rowOffsets[index] ?? 0}
            onHeightChange={onHeightChange}
            expanded={isToolItemExpanded(item, expandedToolCallIds)}
            streaming={item.id === streamingAssistantMessageId}
            onToggleToolCall={onToggleToolCall}
            onViewFileInDiff={onViewFileInDiff}
            onViewPlan={onViewPlan}
            sourceMessageIndex={renderedMessageIndexById.get(item.id)}
            onForkFromMessage={onForkFromMessage}
            onOpenBrowserAttachment={onOpenBrowserAttachment}
            hideThinking={hideThinking}
          />
        );
      })}
    </div>
  );
}

const MeasuredTimelineItem = memo(function MeasuredTimelineItem({
  item,
  className,
  top,
  onHeightChange,
  expanded,
  streaming,
  onToggleToolCall,
  onViewFileInDiff,
  onViewPlan,
  sourceMessageIndex,
  onForkFromMessage,
  onOpenBrowserAttachment,
  hideThinking,
}: {
  readonly item: DisplayTimelineItem;
  readonly className?: string;
  readonly top?: number;
  readonly onHeightChange: (id: string, height: number) => void;
  readonly expanded: boolean;
  readonly streaming?: boolean;
  readonly onToggleToolCall: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onViewPlan?: () => void;
  readonly sourceMessageIndex?: number;
  readonly onForkFromMessage?: (messageIndex: number, preview?: string) => void;
  readonly onOpenBrowserAttachment?: (attachment: BrowserElementAttachment) => void;
  readonly hideThinking?: boolean;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return undefined;
    }

    const measure = () => {
      onHeightChange(item.id, element.getBoundingClientRect().height);
    };

    measure();
    const resizeObserver = new ResizeObserver(() => {
      measure();
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [item.id, onHeightChange]);

  return (
    <div
      className={className}
      ref={rowRef}
      data-message-id={item.id}
      style={top == null ? undefined : { transform: `translateY(${top}px)` }}
    >
      <TimelineItem
        item={item}
        streaming={streaming}
        expanded={expanded}
        onToggleToolCall={onToggleToolCall}
        onViewFileInDiff={onViewFileInDiff}
        onViewPlan={onViewPlan}
        sourceMessageIndex={sourceMessageIndex}
        onForkFromMessage={onForkFromMessage}
        onOpenBrowserAttachment={onOpenBrowserAttachment}
        hideThinking={hideThinking}
      />
    </div>
  );
}, (previous, next) => (
  previous.item === next.item &&
  previous.className === next.className &&
  previous.top === next.top &&
  previous.expanded === next.expanded &&
  previous.streaming === next.streaming &&
  previous.hideThinking === next.hideThinking &&
  previous.sourceMessageIndex === next.sourceMessageIndex &&
  Boolean(previous.onViewFileInDiff) === Boolean(next.onViewFileInDiff) &&
  Boolean(previous.onViewPlan) === Boolean(next.onViewPlan) &&
  Boolean(previous.onForkFromMessage) === Boolean(next.onForkFromMessage)
  && Boolean(previous.onOpenBrowserAttachment) === Boolean(next.onOpenBrowserAttachment)
));

function findStartIndex(offsets: readonly number[], heights: readonly number[], targetOffset: number): number {
  let low = 0;
  let high = offsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const end = (offsets[mid] ?? 0) + (heights[mid] ?? 0);
    if (end < targetOffset) {
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  return Math.max(0, Math.min(offsets.length - 1, low));
}

function findEndIndex(offsets: readonly number[], targetOffset: number): number {
  if (offsets.length === 0) {
    return 0;
  }

  let low = 0;
  let high = offsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if ((offsets[mid] ?? 0) <= targetOffset) {
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  const lastVisibleIndex = Math.max(0, low);
  return Math.min(offsets.length, Math.max(lastVisibleIndex + 1, 1));
}

function isToolItemExpanded(item: DisplayTimelineItem, expandedIds: ReadonlySet<string>): boolean {
  if (item.kind === "tool") {
    return expandedIds.has(item.callId);
  }
  return item.kind === "tool-group" && expandedIds.has(item.id);
}

function estimateTimelineItemHeight(item: DisplayTimelineItem): number {
  if (item.kind === "turn-marker") {
    return 32;
  }
  if (item.kind === "message") {
    const attachmentHeight = item.attachments?.some((attachment) => attachment.kind === "image")
      ? 120
      : item.attachments?.length
        ? 56
        : 0;
    const visualLines = item.text.split("\n").reduce(
      (total, line) => total + Math.max(1, Math.ceil(line.length / 90)),
      0,
    );
    return 48 + attachmentHeight + visualLines * 20;
  }
  if (item.kind === "tool-group") {
    return 46;
  }
  if (item.kind === "tool") {
    return 52;
  }
  if (item.kind === "summary") {
    return item.presentation === "divider" ? 44 : 38;
  }
  return 38;
}
