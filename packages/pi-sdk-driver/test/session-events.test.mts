import test from "node:test";
import assert from "node:assert/strict";
import { SessionSupervisor } from "../dist/session-supervisor.js";

function createRecord() {
  return {
    ref: { workspaceId: "workspace-1", sessionId: "session-1" },
    workspace: { workspaceId: "workspace-1", path: "C:\\workspace" },
        title: "Session model",
    runtime: undefined,
    session: undefined,
    sessionFile: undefined,
    status: "running",
    updatedAt: "2026-07-20T00:00:00.000Z",
    archivedAt: undefined,
    preview: undefined,
    config: { provider: "openai", modelId: "gpt-5.4", thinkingLevel: "high" },
    runningRunId: "run-1",
    queuedMessages: [],
    closed: false,
    listeners: new Set(),
    eventQueue: Promise.resolve(),
    unsubscribeAgent: undefined,
    pendingHostUiRequests: new Map(),
    extensionUiState: { statuses: {}, widgets: {} },
    bindingExtensions: false,
    sessionCommands: [],
    leasePath: undefined,
    transcriptDiskMtimeMs: undefined,
  };
}

function mapAgentEvent(record: ReturnType<typeof createRecord>, event: Record<string, unknown>) {
  const supervisor = Object.create(SessionSupervisor.prototype) as SessionSupervisor;
  return (supervisor as any).mapAgentEvent(record, event);
}

test("retryable agent_end keeps the run active until the successful terminal agent_end", () => {
  const record = createRecord();
  const retryEvents = mapAgentEvent(record, {
    type: "agent_end",
    willRetry: true,
    messages: [{ role: "assistant", stopReason: "error", errorMessage: "rate limited" }],
  });

  assert.equal(record.status, "running");
  assert.equal(record.runningRunId, "run-1");
  assert.equal(retryEvents.some((event: { type: string }) => event.type === "runFailed"), false);
  assert.equal(retryEvents[0].snapshot.title, "Session model");
  assert.equal(retryEvents[0].snapshot.runningRunId, "run-1");

  const retryStartEvents = mapAgentEvent(record, {
    type: "auto_retry_start",
    attempt: 1,
    maxAttempts: 3,
    delayMs: 100,
    errorMessage: "rate limited",
  });
  assert.equal(retryStartEvents[0].snapshot.runningRunId, "run-1");

  const retryEndEvents = mapAgentEvent(record, {
    type: "auto_retry_end",
    success: true,
    attempt: 1,
  });
  assert.equal(retryEndEvents[0].snapshot.runningRunId, "run-1");

  const completedEvents = mapAgentEvent(record, {
    type: "agent_end",
    willRetry: false,
    messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] }],
  });
  assert.equal(record.status, "idle");
  assert.equal(record.runningRunId, undefined);
  assert.equal(completedEvents[0].type, "runCompleted");
  assert.equal(completedEvents[0].runId, "run-1");
});

test("failed auto_retry_end terminalizes a pending retry exactly once", () => {
  const record = createRecord();
  mapAgentEvent(record, {
    type: "agent_end",
    willRetry: true,
    messages: [{ role: "assistant", stopReason: "error", errorMessage: "overloaded" }],
  });

  const failedEvents = mapAgentEvent(record, {
    type: "auto_retry_end",
    success: false,
    attempt: 1,
    finalError: "Retry cancelled",
  });
  assert.equal(record.status, "failed");
  assert.equal(record.runningRunId, undefined);
  assert.equal(failedEvents[0].type, "runFailed");
  assert.equal(failedEvents[0].runId, "run-1");
  assert.equal(failedEvents[0].error.code, "AUTO_RETRY_FAILED");
  assert.equal(failedEvents[1].snapshot.status, "failed");

  const duplicateEvents = mapAgentEvent(record, {
    type: "auto_retry_end",
    success: false,
    attempt: 1,
    finalError: "Retry cancelled",
  });
  assert.deepEqual(duplicateEvents, []);
});

test("session profile factory keeps session-scoped plan tools and shared runtime configuration", async () => {
  const createdOptions: Record<string, unknown>[] = [];
  const profileContexts: Array<Record<string, unknown>> = [];
  const modelRuntime = { marker: "shared-runtime" };
  const customTool = { name: "custom_tool" };
  const supervisor = new SessionSupervisor({
    agentDir: "C:\\pi-agent",
    modelRuntime: modelRuntime as any,
    createAgentSessionRuntimeImpl: async (options) => {
      createdOptions.push(options as Record<string, unknown>);
      return {} as any;
    },
    sessionProfileFactory: (context) => {
      profileContexts.push(context as unknown as Record<string, unknown>);
      return context.sessionRef
        ? {
            noTools: "builtin",
            tools: ["custom_tool"],
            excludeTools: ["excluded_tool"],
            customTools: [customTool as any],
            resourceLoaderOptions: { noSkills: true, systemPrompt: "profile-prompt" },
          }
        : undefined;
    },
  });
  const createRuntime = (supervisor as any).createRuntimeForSession.bind(supervisor);
  const workspace = { workspaceId: "workspace-1", path: "C:\\workspace" };
  const model = { provider: "openai", id: "gpt-5.4" };
  const sessionRef = { workspaceId: "workspace-1", sessionId: "session-1" };

  await createRuntime(workspace, { cwd: workspace.path, model, thinkingLevel: "high" });
  await createRuntime(workspace, { cwd: workspace.path, model, thinkingLevel: "high" }, sessionRef);

  assert.deepEqual(profileContexts, [
    { workspace: { workspaceId: "workspace-1", path: "C:\\workspace" } },
    { workspace: { workspaceId: "workspace-1", path: "C:\\workspace" }, sessionRef },
  ]);
  assert.equal(createdOptions[0].customTools, undefined);
  assert.equal(createdOptions[0].tools, undefined);
  assert.equal(createdOptions[0].model, model);
  assert.equal(createdOptions[0].thinkingLevel, "high");
  assert.equal(createdOptions[0].modelRuntime, modelRuntime);
  assert.equal(createdOptions[1].model, model);
  assert.equal(createdOptions[1].thinkingLevel, "high");
  assert.equal(createdOptions[1].noTools, "builtin");
  assert.deepEqual(createdOptions[1].tools, ["custom_tool"]);
  assert.deepEqual(createdOptions[1].excludeTools, ["excluded_tool"]);
  assert.deepEqual(createdOptions[1].customTools, [customTool]);
  assert.deepEqual(createdOptions[1].resourceLoaderOptions, { noSkills: true, systemPrompt: "profile-prompt" });
});

test("supervisor event queue preserves mapped event order", async () => {
  const record = createRecord();
  const delivered: string[] = [];
  const supervisor = Object.create(SessionSupervisor.prototype) as SessionSupervisor;
  (supervisor as any).emit = async (_record: unknown, event: { type: string }) => {
    delivered.push(event.type);
  };
  const queueDriverEvents = (supervisor as any).queueDriverEvents.bind(supervisor);
  queueDriverEvents(record, [{ type: "runStarted" }], { persistSnapshot: false });
  queueDriverEvents(record, [{ type: "runCompleted" }, { type: "sessionUpdated" }], { persistSnapshot: false });
  await record.eventQueue;
  assert.deepEqual(delivered, ["runStarted", "runCompleted", "sessionUpdated"]);
});

test("tool execution updates expose structured content, progress, and details", () => {
  const record = createRecord();
  const details = { phase: "validating", progress: 0.8 };
  const events = mapAgentEvent(record, {
    type: "tool_execution_update",
    toolCallId: "tool-1",
    toolName: "custom_tool",
    args: {},
    partialResult: {
      content: [{ type: "text", text: "Checking solid" }],
      details,
    },
  });

  assert.deepEqual(events[0], {
    type: "toolUpdated",
    sessionRef: record.ref,
    timestamp: events[0].timestamp,
    runId: "run-1",
    callId: "tool-1",
    text: "Checking solid",
    progress: 0.8,
    details,
  });
});
