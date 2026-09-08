import type { TranscriptMessage } from "./desktop-state";
import type { RuntimeSnapshot } from "@pi-frame/session-driver/runtime-types";

export interface SessionStats {
  readonly totalCost: number;
  readonly totalTokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly contextTokens: number;
  readonly contextWindowLimit: number;
  readonly contextPercentage: number;
  readonly turnCount: number;
  readonly hasStats: boolean;
}

export function computeSessionStats(
  transcript: readonly TranscriptMessage[],
  selectedModelRuntime?: RuntimeSnapshot,
  resolvedProvider?: string,
  resolvedModelId?: string,
): SessionStats {
  let totalCost = 0;
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let latestContextTokens = 0;
  let turnCount = 0;
  let latestModel: string | undefined;

  for (const item of transcript) {
    if (item.kind === "message" && item.role === "user") {
      turnCount += 1;
    }
    if (item.kind === "message" && item.role === "assistant" && item.model) {
      latestModel = item.model;
    }
    const usage =
      (item.kind === "message" && item.role === "assistant") || item.kind === "tool"
        ? item.usage
        : undefined;

    if (usage) {
      const u = usage;
      const msgInput = u.input ?? 0;
      const msgOutput = u.output ?? 0;
      const msgCacheRead = u.cacheRead ?? 0;
      const msgCacheWrite = u.cacheWrite ?? 0;
      const msgTotalTokens = u.totalTokens ?? (msgInput + msgOutput + msgCacheRead + msgCacheWrite);

      inputTokens += msgInput;
      outputTokens += msgOutput;
      cacheReadTokens += msgCacheRead;
      cacheWriteTokens += msgCacheWrite;
      totalTokens += msgTotalTokens;

      if (u.cost) {
        totalCost +=
          u.cost.total ??
          (u.cost.input ?? 0) +
            (u.cost.output ?? 0) +
            (u.cost.cacheRead ?? 0) +
            (u.cost.cacheWrite ?? 0);
      }

      // Active context of the latest turn sent to the LLM (input + cached)
      latestContextTokens = msgInput + msgCacheRead + msgCacheWrite;
    }
  }

  // Resolve model context window limit
  const activeModelId = latestModel ?? resolvedModelId;
  const models = Array.isArray(selectedModelRuntime?.models) ? selectedModelRuntime.models : [];
  const matchedModel = models.find((m) =>
    (resolvedProvider ? m.providerId === resolvedProvider : true) &&
    (activeModelId
      ? m.modelId === activeModelId || (m.label ? m.label.toLowerCase() === activeModelId.toLowerCase() : false)
      : false),
  );

  const contextWindowLimit = matchedModel?.contextWindow ?? 128_000;
  const contextPercentage =
    contextWindowLimit > 0
      ? Math.min(100, Math.round((latestContextTokens / contextWindowLimit) * 100))
      : 0;

  const hasStats = totalTokens > 0 || totalCost > 0 || latestContextTokens > 0;

  return {
    totalCost,
    totalTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    contextTokens: latestContextTokens,
    contextWindowLimit,
    contextPercentage,
    turnCount,
    hasStats,
  };
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return count.toLocaleString();
}

export function formatCost(cost: number): string {
  if (cost === 0) {
    return "$0.00";
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  return `$${cost.toFixed(2)}`;
}
