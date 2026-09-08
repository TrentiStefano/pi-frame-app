import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TranscriptMessage } from "./desktop-state";
import type { RuntimeSnapshot } from "@pi-frame/session-driver/runtime-types";
import { computeSessionStats, formatCost, formatTokenCount } from "./session-stats";
import { CoinsIcon, MeterIcon, ReasoningIcon } from "./icons";

interface SessionStatsBarProps {
  readonly transcript: readonly TranscriptMessage[];
  readonly selectedModelRuntime?: RuntimeSnapshot;
  readonly resolvedProvider?: string;
  readonly resolvedModelId?: string;
  readonly hideThinking?: boolean;
  readonly onToggleHideThinking?: () => void;
}

export function SessionStatsBar({
  transcript,
  selectedModelRuntime,
  resolvedProvider,
  resolvedModelId,
  hideThinking = false,
  onToggleHideThinking,
}: SessionStatsBarProps) {
  const { t } = useTranslation();

  const stats = useMemo(
    () =>
      computeSessionStats(
        transcript,
        selectedModelRuntime,
        resolvedProvider,
        resolvedModelId,
      ),
    [transcript, selectedModelRuntime, resolvedProvider, resolvedModelId],
  );

  const tokenBreakdownTitle = [
    `${t("conversation.statsInputTokens", "Input")}: ${formatTokenCount(stats.inputTokens)}`,
    `${t("conversation.statsOutputTokens", "Output")}: ${formatTokenCount(stats.outputTokens)}`,
    stats.cacheReadTokens > 0
      ? `${t("conversation.statsCacheReadTokens", "Cache read")}: ${formatTokenCount(stats.cacheReadTokens)}`
      : null,
    stats.cacheWriteTokens > 0
      ? `${t("conversation.statsCacheWriteTokens", "Cache write")}: ${formatTokenCount(stats.cacheWriteTokens)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const contextTitle = `${formatTokenCount(stats.contextTokens)} / ${formatTokenCount(stats.contextWindowLimit)} tokens (${stats.contextPercentage}%)`;

  const meterTone =
    stats.contextPercentage >= 90
      ? "danger"
      : stats.contextPercentage >= 75
        ? "warning"
        : "normal";

  return (
    <div className="chat-header__stats" data-testid="chat-header-stats">
      {/* Total Cost */}
      <div
        className="stats-pill stats-pill--cost"
        data-testid="stats-cost"
        title={t("conversation.statsTotalCostHint", "Total cost for this session")}
      >
        <span className="stats-pill__icon" aria-hidden="true">
          <CoinsIcon />
        </span>
        <span className="stats-pill__label">{t("conversation.statsCost", "Cost")}:</span>
        <span className="stats-pill__value stats-pill__value--cost">{formatCost(stats.totalCost)}</span>
      </div>

      {/* Total Tokens */}
      <div
        className="stats-pill stats-pill--tokens"
        data-testid="stats-tokens"
        title={tokenBreakdownTitle || t("conversation.statsTokensHint", "Total tokens used")}
      >
        <span className="stats-pill__label">{t("conversation.statsTokens", "Tokens")}:</span>
        <span className="stats-pill__value">{formatTokenCount(stats.totalTokens)}</span>
      </div>

      {/* Context Window */}
      <div
        className="stats-pill stats-pill--context"
        data-testid="stats-context"
        title={contextTitle}
      >
        <span className="stats-pill__icon" aria-hidden="true">
          <MeterIcon />
        </span>
        <span className="stats-pill__label">{t("conversation.statsContext", "Context")}:</span>
        <span className="stats-pill__value">
          {stats.contextPercentage}%{" "}
          <span className="stats-pill__sub">{t("conversation.statsOf", "of")} {formatTokenCount(stats.contextWindowLimit)}</span>
        </span>
        <span className="stats-pill__meter" aria-hidden="true">
          <span
            className={`stats-pill__meter-fill stats-pill__meter-fill--${meterTone}`}
            style={{ width: `${Math.max(2, stats.contextPercentage)}%` }}
          />
        </span>
      </div>

      {/* Turns Count (if > 0) */}
      {stats.turnCount > 0 ? (
        <div className="stats-pill stats-pill--turns" data-testid="stats-turns">
          <span className="stats-pill__label">
            {stats.turnCount} {stats.turnCount === 1 ? t("conversation.statsTurn", "turn") : t("conversation.statsTurns", "turns")}
          </span>
        </div>
      ) : null}

      {/* Hide / Minimize Thinking Blocks Toggle */}
      {onToggleHideThinking ? (
        <button
          type="button"
          className={`stats-pill stats-pill--toggle ${hideThinking ? "stats-pill--active" : ""}`}
          data-testid="toggle-hide-thinking"
          onClick={onToggleHideThinking}
          aria-pressed={hideThinking}
          title={
            hideThinking
              ? t("conversation.thinkingMinimizedHint", "Thinking blocks are minimized. Click to expand by default.")
              : t("conversation.hideThinkingHint", "Click to minimize thinking blocks by default.")
          }
        >
          <span className="stats-pill__icon" aria-hidden="true">
            <ReasoningIcon />
          </span>
          <span className="stats-pill__label">
            {hideThinking
              ? t("conversation.thinkingMinimized", "Thinking minimized")
              : t("conversation.hideThinking", "Minimize thinking")}
          </span>
        </button>
      ) : null}
    </div>
  );
}
