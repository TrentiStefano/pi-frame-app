import { useCallback, useMemo, useState } from "react";
import type { SessionTranscriptMessage } from "@pi-frame/pi-sdk-driver";
import type { DisplayTimelineItem, TimelineActivity, TimelineToolCall, TimelineToolGroup, TimelineSummary, TimelineTurnMarker } from "./timeline-types";
import { MessageMarkdown } from "./message-markdown";
import { ThinkingBlock } from "./thinking-block";
import { parseMessageThinking } from "./thinking-parser";
import { InlineDiff, extractDiffFromOutput } from "./diff-inline";
import { BrowserPreviewIcon, ChevronRightIcon, CopyIcon, DiffIcon, FileIcon, ForkIcon, SparkIcon, TerminalIcon } from "./icons";
import { ListChecks } from "lucide-react";
import { isPlanTool } from "./plan-preview";
import { extensionToLanguage } from "./syntax-highlight";
import { useTranslation } from "react-i18next";
import type { BrowserElementAttachment } from "./browser-types";

export function TimelineItem({
  item,
  streaming = false,
  expanded = false,
  hideThinking = false,
  onToggleToolCall,
  onViewFileInDiff,
  onViewPlan,
  sourceMessageIndex,
  onForkFromMessage,
  onOpenBrowserAttachment,
}: {
  readonly item: DisplayTimelineItem;
  readonly streaming?: boolean;
  readonly expanded?: boolean;
  readonly hideThinking?: boolean;
  readonly onToggleToolCall?: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onViewPlan?: () => void;
  readonly sourceMessageIndex?: number;
  readonly onForkFromMessage?: (messageIndex: number, preview?: string) => void;
  readonly onOpenBrowserAttachment?: (attachment: BrowserElementAttachment) => void;
}) {
  switch (item.kind) {
    case "turn-marker":
      return <TimelineTurnMarkerItem item={item} />;
    case "message":
      return (
        <TimelineMessage
          item={item}
          streaming={streaming}
          hideThinking={hideThinking}
          sourceMessageIndex={sourceMessageIndex}
          onForkFromMessage={onForkFromMessage}
          onOpenBrowserAttachment={onOpenBrowserAttachment}
        />
      );
    case "activity":
      return <TimelineActivityItem item={item} />;
    case "tool":
      return (
        <TimelineToolCallItem
          item={item}
          expanded={expanded}
          onToggle={onToggleToolCall}
          onViewFileInDiff={onViewFileInDiff}
          onViewPlan={onViewPlan}
        />
      );
    case "tool-group":
      return (
        <TimelineToolGroupItem
          item={item}
          expanded={expanded}
          onToggle={onToggleToolCall}
          onViewFileInDiff={onViewFileInDiff}
          onViewPlan={onViewPlan}
        />
      );
    case "summary":
      return <TimelineSummaryItem item={item} />;
    default:
      return null;
  }
}

function TimelineMessage({
  item,
  streaming = false,
  hideThinking = false,
  sourceMessageIndex,
  onForkFromMessage,
  onOpenBrowserAttachment,
}: {
  readonly item: SessionTranscriptMessage;
  readonly streaming?: boolean;
  readonly hideThinking?: boolean;
  readonly sourceMessageIndex?: number;
  readonly onForkFromMessage?: (messageIndex: number, preview?: string) => void;
  readonly onOpenBrowserAttachment?: (attachment: BrowserElementAttachment) => void;
}) {
  const { t } = useTranslation();
  if (item.role === "user") {
    return (
      <article className="timeline-item timeline-item--user">
        <div className="timeline-item__bubble">
          {item.attachments?.length ? (
            <div className="timeline-item__attachments">
              {item.attachments.map((attachment, index) =>
                attachment.kind === "image" ? (
                  <img
                    alt={attachment.name ?? t("conversation.attachment", { number: index + 1 })}
                    className="timeline-item__attachment timeline-item__attachment--image"
                    key={`${item.id}:${index}`}
                    src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  />
                ) : attachment.kind === "browser-element" ? (
                  <button
                    className="timeline-item__attachment timeline-item__attachment--browser-element"
                    key={`${item.id}:${index}`}
                    title={`${attachment.page.title || attachment.page.url} / ${attachment.element.locator.value}`}
                    type="button"
                    onClick={() => onOpenBrowserAttachment?.(attachment)}
                  >
                    <span className="timeline-item__attachment-icon" aria-hidden="true">
                      <BrowserPreviewIcon />
                    </span>
                    <span className="timeline-item__attachment-name">{attachment.name}</span>
                  </button>
                ) : (
                  <div
                    className="timeline-item__attachment timeline-item__attachment--file"
                    key={`${item.id}:${index}`}
                    title={attachment.fsPath}
                  >
                    <span className="timeline-item__attachment-icon" aria-hidden="true">
                      <FileIcon />
                    </span>
                    <span className="timeline-item__attachment-name">{attachment.name}</span>
                  </div>
                ),
              )}
            </div>
          ) : null}
          <MessageMarkdown text={item.text} />
        </div>
      </article>
    );
  }

  if (item.role === "branchSummary" || item.role === "compactionSummary") {
    return (
      <article className="timeline-item timeline-item--summary-card">
        <div className="timeline-item__summary-eyebrow">
          {item.role === "branchSummary" ? t("timeline.branchSummary") : t("timeline.compactionSummary")}
        </div>
        <MessageMarkdown text={item.text} />
      </article>
    );
  }

  const canFork = onForkFromMessage != null && sourceMessageIndex !== undefined;
  const parsed = useMemo(
    () => parseMessageThinking(item.text, item.thinking, streaming),
    [item.text, item.thinking, streaming],
  );

  return (
    <article className="timeline-item timeline-item--assistant">
      {parsed.thinking ? (
        <ThinkingBlock
          thinking={parsed.thinking}
          defaultMinimized={hideThinking}
          streaming={streaming && parsed.isThinkingStreaming}
        />
      ) : null}
      {parsed.answer || (!parsed.thinking && !parsed.isThinkingStreaming) ? (
        <MessageMarkdown text={parsed.answer} streaming={streaming && !parsed.isThinkingStreaming} />
      ) : null}
      {canFork ? (
        <div className="timeline-item__actions">
          <button
            type="button"
            className="timeline-item__action"
            title={t("timeline.forkFromHere")}
            aria-label={t("timeline.forkFromHere")}
            data-testid="fork-from-message"
            onClick={() => onForkFromMessage(sourceMessageIndex, item.text)}
          >
            <ForkIcon />
            <span className="timeline-item__action-label">{t("timeline.fork")}</span>
          </button>
        </div>
      ) : null}
    </article>
  );
}

function TimelineActivityItem({ item }: { readonly item: TimelineActivity }) {
  const { t } = useTranslation();
  return (
    <div className={`timeline-activity timeline-activity--${item.tone ?? "neutral"}`}>
      <span className="timeline-activity__label">{translateTimelineLabel(item.label, t)}</span>
      {item.detail ? <span className="timeline-activity__detail">{item.detail}</span> : null}
      {item.metadata ? <span className="timeline-activity__meta">{item.metadata}</span> : null}
    </div>
  );
}

function TimelineToolGroupItem({
  item,
  expanded,
  onToggle,
  onViewFileInDiff,
  onViewPlan,
}: {
  readonly item: TimelineToolGroup;
  readonly expanded: boolean;
  readonly onToggle?: (itemId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onViewPlan?: () => void;
}) {
  const { t } = useTranslation();
  const [expandedCallIds, setExpandedCallIds] = useState<Set<string>>(() => new Set());
  const toggleCall = useCallback((callId: string) => {
    setExpandedCallIds((current) => {
      const next = new Set(current);
      if (next.has(callId)) {
        next.delete(callId);
      } else {
        next.add(callId);
      }
      return next;
    });
  }, []);
  const runningCount = item.calls.filter((call) => call.status === "running").length;
  const failedCount = item.calls.filter((call) => call.status === "error").length;
  const status = failedCount > 0 ? "error" : runningCount > 0 ? "running" : "success";
  const statusText = failedCount > 0
    ? t("timeline.toolCallsFailed", { count: failedCount })
    : runningCount > 0
      ? t("timeline.toolCallsRunning", { count: runningCount })
      : t("timeline.statusDone");

  return (
    <section className={`timeline-tool-group timeline-tool-group--${status}`}>
      <button
        aria-expanded={expanded}
        className="timeline-tool-group__header"
        type="button"
        onClick={() => onToggle?.(item.id)}
      >
        <span className={`timeline-tool__chevron ${expanded ? "timeline-tool__chevron--expanded" : ""}`} aria-hidden="true">
          <ChevronRightIcon />
        </span>
        <span className="timeline-tool-group__glyph" aria-hidden="true">
          <TerminalIcon />
        </span>
        <span className="timeline-tool-group__label">{t("timeline.toolCalls", { count: item.calls.length })}</span>
        <span className="timeline-tool-group__meta">
          <span className="timeline-tool__status-pip" aria-hidden="true" />
          {statusText}
        </span>
      </button>
      {expanded ? (
        <div className="timeline-tool-group__body">
          {item.calls.map((call) => (
            <TimelineToolCallItem
              key={call.callId}
              item={call}
              expanded={expandedCallIds.has(call.callId)}
              onToggle={toggleCall}
              onViewFileInDiff={onViewFileInDiff}
              onViewPlan={onViewPlan}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TimelineToolCallItem({
  item,
  expanded,
  onToggle,
  onViewFileInDiff,
  onViewPlan,
}: {
  readonly item: TimelineToolCall;
  readonly expanded: boolean;
  readonly onToggle?: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onViewPlan?: () => void;
}) {
  const { t } = useTranslation();
  const hasContent = item.input !== undefined || item.output !== undefined;
  const diffText = isWriteTool(item.toolName) ? extractDiffFromOutput(item.output) : undefined;
  const diffStats = diffText ? countDiffStats(diffText) : undefined;
  const compactLabel = buildCompactLabel(item, diffStats, t);
  const filePath = isWriteTool(item.toolName) ? extractFilename(item.input) || undefined : undefined;
  const diffLanguage = diffText && filePath ? extensionToLanguage(filePath) : undefined;
  const inlineDetail = item.status === "error" ? item.detail : undefined;

  const handleCopy = () => {
    const text = diffText ?? formatToolContent(item.toolName, item.input, item.output);
    void navigator.clipboard.writeText(text);
  };

  return (
    <article className={`timeline-tool timeline-tool--${item.status}`}>
      <div className="timeline-tool__header-row">
        <span className="timeline-tool__glyph" aria-hidden="true">
          {toolGlyph(item.toolName)}
        </span>
        <button
          className="timeline-tool__header"
          type="button"
          aria-expanded={expanded}
          disabled={!hasContent}
          onClick={() => onToggle?.(item.callId)}
        >
          {hasContent ? (
            <span className={`timeline-tool__chevron ${expanded ? "timeline-tool__chevron--expanded" : ""}`}>
              <ChevronRightIcon />
            </span>
          ) : null}
          <span className="timeline-tool__label">{compactLabel}</span>
          {inlineDetail ? <span className="timeline-tool__detail">{inlineDetail}</span> : null}
          {diffStats ? (
            <span className="timeline-tool__diff-stats">
              <span className="timeline-tool__stat-add">+{diffStats.added}</span>
              {" "}
              <span className="timeline-tool__stat-del">-{diffStats.removed}</span>
            </span>
          ) : null}
          <span className="timeline-tool__meta-inline">
            <span className="timeline-tool__status-pip" aria-hidden="true" />
            {`${item.toolName} \u00b7 ${t(statusLabelKey(item.status))}`}
          </span>
        </button>
        {filePath && onViewFileInDiff ? (
          <button
            aria-label={t("timeline.viewInChanges", { path: filePath })}
            className="icon-button timeline-tool__view-in-diff"
            data-testid="timeline-tool-view-in-diff"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onViewFileInDiff(filePath);
            }}
          >
            <DiffIcon />
          </button>
        ) : null}
        {isPlanTool(item.toolName) && onViewPlan ? (
          <button
            aria-label={t("timeline.viewPlan")}
            className="icon-button timeline-tool__view-in-diff"
            data-testid="timeline-tool-view-plan"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onViewPlan();
            }}
          >
            <ListChecks />
          </button>
        ) : null}
      </div>
      {expanded && hasContent ? (
        <div className="timeline-tool__body">
          {diffText ? (
            <>
              <div className="timeline-tool__diff-header">
                <span className="timeline-tool__diff-filename">
                  {extractFilename(item.input)}
                  {diffStats ? (
                    <span className="timeline-tool__diff-stats">
                      {" "}<span className="timeline-tool__stat-add">+{diffStats.added}</span>
                      {" "}<span className="timeline-tool__stat-del">-{diffStats.removed}</span>
                    </span>
                  ) : null}
                </span>
                <button className="icon-button timeline-tool__copy" type="button" onClick={handleCopy} aria-label={t("common.copy")}>
                  <CopyIcon />
                </button>
              </div>
              <InlineDiff diff={diffText} language={diffLanguage} />
            </>
          ) : (
            <>
              <div className="timeline-tool__body-actions">
                <button className="icon-button timeline-tool__copy" type="button" onClick={handleCopy} aria-label={t("common.copy")}>
                  <CopyIcon />
                </button>
              </div>
              <pre className="timeline-tool__pre">{formatToolContent(item.toolName, item.input, item.output)}</pre>
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}

function isWriteTool(toolName: string): boolean {
  return /write|edit|patch|apply/i.test(toolName);
}

function toolGlyph(toolName: string) {
  if (isPlanTool(toolName)) {
    return <ListChecks />;
  }
  if (toolName.startsWith("browser_")) {
    return <BrowserPreviewIcon />;
  }
  if (isWriteTool(toolName)) {
    return <DiffIcon />;
  }
  if (/bash|shell|exec|terminal|command|run/i.test(toolName)) {
    return <TerminalIcon />;
  }
  if (/read|view|cat|open|file|glob|grep|search|ls/i.test(toolName)) {
    return <FileIcon />;
  }
  return <SparkIcon />;
}

function buildCompactLabel(item: TimelineToolCall, diffStats: { added: number; removed: number } | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  const browserLabel = BROWSER_TOOL_LABEL_KEYS[item.toolName];
  if (browserLabel) return t(browserLabel);
  if (isPlanTool(item.toolName)) return t("timeline.updatedPlan");
  if (isWriteTool(item.toolName)) {
    const filename = extractFilename(item.input);
    if (filename) {
      return t("conversation.editedFile", { path: shortenPath(filename) });
    }
  }
  return item.label;
}

function extractFilename(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    const path = record.file_path ?? record.filePath ?? record.path ?? record.filename;
    if (typeof path === "string") {
      return path;
    }
  }
  return "";
}

function shortenPath(filePath: string): string {
  // Show last 2-3 path segments for readability
  const parts = filePath.split("/");
  if (parts.length <= 3) {
    return filePath;
  }
  return parts.slice(-3).join("/");
}

function countDiffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }
  return { added, removed };
}

const COMPACT_RESULT_TOOLS = new Set([
  "find_roots",
  "observe_ui",
  "search_ui",
  "expand_ui",
  "inspect_ui",
  "act_ui",
  "read_text",
  "wait_for",
  "launch_browser",
  "navigate_browser",
  "evaluate_browser",
]);

function formatToolContent(toolName: string, input: unknown, output: unknown): string {
  const parts: string[] = [];
  if (input !== undefined) {
    parts.push(typeof input === "string" ? input : JSON.stringify(input, null, 2));
  }
  if (output !== undefined) {
    parts.push(formatToolOutput(toolName, output));
  }
  return parts.join("\n\n");
}

const BROWSER_TOOL_LABEL_KEYS: Readonly<Record<string, string>> = {
  browser_list_tabs: "timeline.browserTools.listTabs",
  browser_open: "timeline.browserTools.open",
  browser_activate_tab: "timeline.browserTools.activateTab",
  browser_close_tab: "timeline.browserTools.closeTab",
  browser_navigate: "timeline.browserTools.navigate",
  browser_observe: "timeline.browserTools.observe",
  browser_screenshot: "timeline.browserTools.screenshot",
  browser_wait: "timeline.browserTools.wait",
  browser_click: "timeline.browserTools.click",
  browser_hover: "timeline.browserTools.hover",
  browser_type: "timeline.browserTools.type",
  browser_press: "timeline.browserTools.press",
  browser_select_option: "timeline.browserTools.select",
  browser_scroll: "timeline.browserTools.scroll",
};

function formatToolOutput(toolName: string, output: unknown): string {
  if (typeof output === "string") return output;
  if (!isRecord(output) || !Array.isArray(output.content)) return JSON.stringify(output, null, 2);
  if (!COMPACT_RESULT_TOOLS.has(toolName) && toolName !== "browser_screenshot") return JSON.stringify(output, null, 2);
  const content = output.content.flatMap((part) => {
    if (!isRecord(part)) return [];
    if (part.type === "text" && typeof part.text === "string") return [part.text];
    if (part.type === "image") return [`[${typeof part.mimeType === "string" ? part.mimeType : "image"}]`];
    return [];
  });
  return content.length > 0 ? content.join("\n") : JSON.stringify(output, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function statusLabel(status: "running" | "success" | "error") {
  if (status === "running") return "running";
  if (status === "success") return "done";
  return "failed";
}

function statusLabelKey(status: "running" | "success" | "error") {
  if (status === "running") return "timeline.statusRunning";
  if (status === "success") return "timeline.statusDone";
  return "timeline.statusFailed";
}

function translateTimelineLabel(label: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (label === "Working…") return t("timeline.working");
  if (label === "Resumed session") return t("timeline.resumed");
  if (label === "Completed") return t("timeline.completed");
  if (label === "Stopped") return t("timeline.stopped");
  if (label === "Started child thread") return t("timeline.startedChild");
  if (label.startsWith("Started child thread: ")) return t("timeline.startedChildDetail", { detail: label.slice(22) });
  if (label === "Listed threads") return t("timeline.listedThreads");
  if (label === "Read thread") return t("timeline.readThread");
  if (label.startsWith("Read thread: ")) return t("timeline.readThreadDetail", { detail: label.slice(13) });
  if (label === "Sent message to thread") return t("timeline.sentThread");
  if (label.startsWith("Sent message to thread: ")) return t("timeline.sentThreadDetail", { detail: label.slice(25) });
  if (label.startsWith("Worked for ")) return t("timeline.workedFor", { duration: label.slice(11) });
  return label;
}

function TimelineTurnMarkerItem({ item }: { readonly item: TimelineTurnMarker }) {
  const { t } = useTranslation();
  return (
    <div className="timeline-turn-marker" data-testid="timeline-turn-marker">
      <span className="timeline-turn-marker__label">{t("timeline.workedFor", { duration: formatWorkedDuration(item.durationMs) })}</span>
    </div>
  );
}

function formatWorkedDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

function TimelineSummaryItem({ item }: { readonly item: TimelineSummary }) {
  if (item.presentation === "divider") {
    return (
      <div className="timeline-summary">
        <span>{item.label}</span>
        {item.metadata ? <span className="timeline-summary__meta">{item.metadata}</span> : null}
      </div>
    );
  }

  return (
    <div className="timeline-activity timeline-activity--summary">
      <span className="timeline-activity__label">{item.label}</span>
      {item.metadata ? <span className="timeline-activity__meta">{item.metadata}</span> : null}
    </div>
  );
}
