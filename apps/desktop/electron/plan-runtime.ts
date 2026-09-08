import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";

export const updatePlanToolName = "update_plan";
export const requestUserInputToolName = "request_user_input";

export const PLAN_MODE_SYSTEM_PROMPT = `You are in Plan mode.

Your job is to investigate the user's request and produce a clear, implementation-ready plan. Do not implement the plan while this mode is active.

- You may inspect files, search the repository, and run read-only diagnostic commands.
- Do not edit files, create commits, install dependencies, or run commands that mutate the workspace or external state.
- Use request_user_input for concise clarifying questions when a material product or implementation decision cannot be inferred safely.
- Use the update_plan tool once you have enough context, and keep it current as your understanding changes.
- Keep exactly one plan step in_progress while work is being planned; use pending for later steps and completed only for planning work already finished.
- In your final response, summarize the proposed approach and tell the user they can run /plan to return to Default mode before implementation.`;

interface PlanStep {
  readonly step: string;
  readonly status: "pending" | "in_progress" | "completed";
}

interface UpdatePlanDetails {
  readonly explanation?: string;
  readonly plan: readonly PlanStep[];
}

interface PlanQuestionOption {
  readonly label: string;
  readonly description: string;
}

interface PlanQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly options: readonly PlanQuestionOption[];
}

export function createPlanTools(): readonly ToolDefinition[] {
  return [
    {
      name: updatePlanToolName,
      label: "Update plan",
      description: "Create or update the implementation plan shown to the user.",
      promptSnippet: "update_plan: publish the current structured implementation plan.",
      promptGuidelines: [
        "Use update_plan after investigating enough context to propose concrete implementation steps.",
        "Update the plan when scope or sequencing changes.",
      ],
      parameters: {
        type: "object",
        properties: {
          explanation: {
            type: "string",
            description: "Optional short Markdown context explaining the plan or a material change.",
          },
          plan: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                step: { type: "string", description: "A concise implementation step." },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              },
              required: ["step", "status"],
              additionalProperties: false,
            },
          },
        },
        required: ["plan"],
        additionalProperties: false,
      },
      async execute(_toolCallId, params): Promise<AgentToolResult<UpdatePlanDetails>> {
        const details = normalizePlan(params);
        return {
          content: [{ type: "text", text: `Plan updated with ${details.plan.length} step${details.plan.length === 1 ? "" : "s"}.` }],
          details,
        };
      },
    },
    {
      name: requestUserInputToolName,
      label: "Request user input",
      description: "Ask the user one to three structured planning questions and wait for their answers.",
      promptSnippet: "request_user_input: ask focused multiple-choice questions while planning.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                header: { type: "string" },
                question: { type: "string" },
                options: {
                  type: "array",
                  minItems: 2,
                  maxItems: 3,
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      description: { type: "string" },
                    },
                    required: ["label", "description"],
                  },
                },
              },
              required: ["id", "header", "question", "options"],
            },
          },
        },
        required: ["questions"],
      },
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const questions = normalizeQuestions(params);
        const answers: Record<string, string> = {};
        for (const question of questions) {
          const displayOptions = [
            ...question.options.map((option) => `${option.label} - ${option.description}`),
            "Other - Enter a different answer",
          ];
          const selected = await ctx.ui.select(question.question, displayOptions, { signal });
          if (!selected) {
            answers[question.id] = "Cancelled";
            continue;
          }
          if (selected === displayOptions.at(-1)) {
            answers[question.id] = (await ctx.ui.input(question.header, "Enter your answer", { signal }))?.trim() || "Cancelled";
            continue;
          }
          answers[question.id] = question.options[displayOptions.indexOf(selected)]?.label ?? selected;
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ answers }) }],
          details: { answers },
        };
      },
    },
  ];
}

function normalizePlan(value: unknown): UpdatePlanDetails {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const plan = Array.isArray(input.plan)
    ? input.plan.flatMap((entry): PlanStep[] => {
        if (!entry || typeof entry !== "object") return [];
        const candidate = entry as Record<string, unknown>;
        const step = typeof candidate.step === "string" ? candidate.step.trim() : "";
        const status = candidate.status;
        if (!step || (status !== "pending" && status !== "in_progress" && status !== "completed")) return [];
        return [{ step, status }];
      })
    : [];
  if (plan.length === 0) {
    throw new Error("update_plan requires at least one valid plan step.");
  }
  const explanation = typeof input.explanation === "string" ? input.explanation.trim() : "";
  return { ...(explanation ? { explanation } : {}), plan };
}

function normalizeQuestions(value: unknown): readonly PlanQuestion[] {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (!Array.isArray(input.questions)) throw new Error("request_user_input requires questions.");
  const questions = input.questions.slice(0, 3).flatMap((entry): PlanQuestion[] => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const header = typeof candidate.header === "string" ? candidate.header.trim() : "";
    const question = typeof candidate.question === "string" ? candidate.question.trim() : "";
    const options = Array.isArray(candidate.options)
      ? candidate.options.slice(0, 3).flatMap((option): PlanQuestionOption[] => {
          if (!option || typeof option !== "object") return [];
          const record = option as Record<string, unknown>;
          const label = typeof record.label === "string" ? record.label.trim() : "";
          const description = typeof record.description === "string" ? record.description.trim() : "";
          return label && description ? [{ label, description }] : [];
        })
      : [];
    return id && header && question && options.length >= 2 ? [{ id, header, question, options }] : [];
  });
  if (questions.length === 0) throw new Error("request_user_input requires at least one valid question.");
  return questions;
}
