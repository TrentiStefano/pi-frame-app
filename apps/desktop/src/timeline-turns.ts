import type { DisplayTimelineItem, TimelineToolCall, TranscriptMessage } from "./timeline-types";

const MIN_WORKED_DURATION_MS = 1_000;

interface TurnMarkerItem {
  readonly kind: "turn-marker";
  readonly id: string;
  readonly durationMs: number;
}

interface ToolGroupItem {
  readonly kind: "tool-group";
  readonly id: string;
  readonly calls: readonly TimelineToolCall[];
}

const turnMarkerCache = new Map<string, TurnMarkerItem>();
const toolGroupCache = new Map<string, ToolGroupItem>();

function getOrCreateTurnMarker(id: string, durationMs: number): TurnMarkerItem {
  const cached = turnMarkerCache.get(id);
  if (cached && cached.durationMs === durationMs) {
    return cached;
  }
  const created: TurnMarkerItem = { kind: "turn-marker", id, durationMs };
  turnMarkerCache.set(id, created);
  if (turnMarkerCache.size > 200) {
    const oldestKey = turnMarkerCache.keys().next().value;
    if (oldestKey) turnMarkerCache.delete(oldestKey);
  }
  return created;
}

function getOrCreateToolGroup(id: string, calls: TimelineToolCall[]): ToolGroupItem {
  const cached = toolGroupCache.get(id);
  if (
    cached &&
    cached.calls.length === calls.length &&
    cached.calls.every((call, index) => call === calls[index])
  ) {
    return cached;
  }
  const created: ToolGroupItem = { kind: "tool-group", id, calls };
  toolGroupCache.set(id, created);
  if (toolGroupCache.size > 200) {
    const oldestKey = toolGroupCache.keys().next().value;
    if (oldestKey) toolGroupCache.delete(oldestKey);
  }
  return created;
}

/**
 * Insert turn timing markers and compact consecutive tool calls in one linear
 * pass. Both additions are view-only; the persisted transcript remains exact.
 */
export function buildDisplayTimelineItems(transcript: readonly TranscriptMessage[]): readonly DisplayTimelineItem[] {
  const result: DisplayTimelineItem[] = [];
  let index = 0;

  while (index < transcript.length) {
    const item = transcript[index];
    if (!item) {
      index += 1;
      continue;
    }

    if (item.kind !== "message" || item.role !== "user") {
      let segmentEnd = index + 1;
      while (segmentEnd < transcript.length) {
        const nextItem = transcript[segmentEnd];
        if (nextItem?.kind === "message" && nextItem.role === "user") {
          break;
        }
        segmentEnd += 1;
      }
      appendSegment(result, transcript, index, segmentEnd);
      index = segmentEnd;
      continue;
    }

    let turnEnd = index + 1;
    let endMs: number | null = null;
    while (turnEnd < transcript.length) {
      const nextItem = transcript[turnEnd];
      if (nextItem?.kind === "message" && nextItem.role === "user") {
        break;
      }
      if (nextItem) {
        const nextMs = Date.parse(nextItem.createdAt);
        if (!Number.isNaN(nextMs)) {
          endMs = endMs == null ? nextMs : Math.max(endMs, nextMs);
        }
      }
      turnEnd += 1;
    }

    result.push(item);
    const startMs = Date.parse(item.createdAt);
    if (!Number.isNaN(startMs) && endMs != null && endMs - startMs >= MIN_WORKED_DURATION_MS) {
      result.push(getOrCreateTurnMarker(`turn-marker:${item.id}`, endMs - startMs));
    }

    appendSegment(result, transcript, index + 1, turnEnd);
    index = turnEnd;
  }

  return result;
}

function appendSegment(
  result: DisplayTimelineItem[],
  transcript: readonly TranscriptMessage[],
  start: number,
  end: number,
): void {
  let index = start;
  while (index < end) {
    const item = transcript[index];
    if (!item) {
      index += 1;
      continue;
    }
    if (item.kind !== "tool") {
      result.push(item);
      index += 1;
      continue;
    }

    const calls: TimelineToolCall[] = [item];
    let next = index + 1;
    while (next < end) {
      const nextItem = transcript[next];
      if (nextItem?.kind !== "tool") {
        break;
      }
      calls.push(nextItem);
      next += 1;
    }

    if (calls.length === 1) {
      result.push(item);
    } else {
      result.push(getOrCreateToolGroup(`tool-group:${item.id}`, calls));
    }
    index = next;
  }
}

