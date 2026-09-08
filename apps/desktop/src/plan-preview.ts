import type { TranscriptMessage } from "./timeline-types";

export type PlanStepStatus = "pending" | "in_progress" | "completed";

export interface PlanStep {
  readonly step: string;
  readonly status: PlanStepStatus;
}

export interface PlanPreview {
  readonly callId: string;
  readonly explanation?: string;
  readonly steps: readonly PlanStep[];
}

export function isPlanTool(toolName: string): boolean {
  return /(^|[.:/])update_plan$/i.test(toolName);
}

export function planFromToolInput(callId: string, input: unknown): PlanPreview | undefined {
  if (!isRecord(input) || !Array.isArray(input.plan)) return undefined;

  const steps = input.plan.flatMap((entry): PlanStep[] => {
    if (!isRecord(entry) || typeof entry.step !== "string" || !entry.step.trim()) return [];
    const status = normalizeStatus(entry.status);
    return status ? [{ step: entry.step.trim(), status }] : [];
  });
  if (steps.length === 0) return undefined;

  return {
    callId,
    explanation: typeof input.explanation === "string" && input.explanation.trim()
      ? input.explanation.trim()
      : undefined,
    steps,
  };
}

export function latestPlanFromTranscript(transcript: readonly TranscriptMessage[]): PlanPreview | undefined {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item?.kind !== "tool" || !isPlanTool(item.toolName)) continue;
    const plan = planFromToolInput(item.callId, item.input);
    if (plan) return plan;
  }
  return undefined;
}

export function planPreviewKey(plan: PlanPreview): string {
  return JSON.stringify([plan.callId, plan.explanation, plan.steps]);
}

function normalizeStatus(value: unknown): PlanStepStatus | undefined {
  if (value === "pending" || value === "in_progress" || value === "completed") return value;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
