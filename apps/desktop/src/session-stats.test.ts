import test from "node:test";
import assert from "node:assert/strict";
import { computeSessionStats, formatCost, formatTokenCount } from "./session-stats";
import type { TranscriptMessage } from "./desktop-state";
import type { RuntimeSnapshot } from "@pi-frame/session-driver/runtime-types";

test("computeSessionStats computes zero for empty transcript", () => {
  const stats = computeSessionStats([]);
  assert.strictEqual(stats.totalCost, 0);
  assert.strictEqual(stats.totalTokens, 0);
  assert.strictEqual(stats.contextPercentage, 0);
  assert.strictEqual(stats.hasStats, false);
});

test("computeSessionStats aggregates token counts, cost, and context percentage", () => {
  const mockTranscript: TranscriptMessage[] = [
    {
      kind: "message",
      id: "u1",
      role: "user",
      text: "Hello",
      createdAt: "2026-09-02T10:00:00Z",
    },
    {
      kind: "message",
      id: "a1",
      role: "assistant",
      text: "Hi there!",
      createdAt: "2026-09-02T10:00:05Z",
      usage: {
        input: 1000,
        output: 200,
        cacheRead: 500,
        cacheWrite: 0,
        totalTokens: 1700,
        cost: {
          input: 0.003,
          output: 0.003,
          cacheRead: 0.0005,
          total: 0.0065,
        },
      },
    },
    {
      kind: "message",
      id: "u2",
      role: "user",
      text: "Can you help me?",
      createdAt: "2026-09-02T10:01:00Z",
    },
    {
      kind: "message",
      id: "a2",
      role: "assistant",
      text: "Sure!",
      createdAt: "2026-09-02T10:01:05Z",
      usage: {
        input: 2500,
        output: 400,
        cacheRead: 1500,
        cacheWrite: 0,
        totalTokens: 4400,
        cost: {
          input: 0.0075,
          output: 0.006,
          cacheRead: 0.0015,
          total: 0.015,
        },
      },
    },
  ];

  const mockRuntime: RuntimeSnapshot = {
    workspace: { workspaceId: "ws1", path: "/test" },
    providers: [],
    models: [
      {
        providerId: "anthropic",
        providerName: "Anthropic",
        modelId: "claude-3-5-sonnet-20241022",
        label: "Claude 3.5 Sonnet",
        available: true,
        authType: "api_key",
        reasoning: false,
        supportsImages: true,
        contextWindow: 200000,
      },
    ],
    skills: [],
    settings: { enabledModelPatterns: [], enableSkillCommands: true },
    extensions: [],
  };

  const stats = computeSessionStats(
    mockTranscript,
    mockRuntime,
    "anthropic",
    "claude-3-5-sonnet-20241022",
  );

  assert.strictEqual(stats.totalTokens, 6100);
  assert.strictEqual(stats.inputTokens, 3500);
  assert.strictEqual(stats.outputTokens, 600);
  assert.strictEqual(stats.cacheReadTokens, 2000);
  assert.strictEqual(stats.turnCount, 2);
  assert.strictEqual(Math.abs(stats.totalCost - 0.0215) < 0.0001, true);
  // Latest turn context = input(2500) + cacheRead(1500) = 4000
  // Context limit = 200000 -> 4000 / 200000 = 2%
  assert.strictEqual(stats.contextTokens, 4000);
  assert.strictEqual(stats.contextWindowLimit, 200000);
  assert.strictEqual(stats.contextPercentage, 2);
  assert.strictEqual(stats.hasStats, true);
});

test("formatTokenCount formats numbers gracefully", () => {
  assert.strictEqual(formatTokenCount(500), "500");
  assert.strictEqual(formatTokenCount(1200), "1.2k");
  assert.strictEqual(formatTokenCount(15000), "15k");
  assert.strictEqual(formatTokenCount(128000), "128k");
  assert.strictEqual(formatTokenCount(1500000), "1.5M");
});

test("formatCost formats dollar amounts gracefully", () => {
  assert.strictEqual(formatCost(0), "$0.00");
  assert.strictEqual(formatCost(0.0024), "$0.0024");
  assert.strictEqual(formatCost(0.12), "$0.12");
  assert.strictEqual(formatCost(1.5), "$1.50");
});
