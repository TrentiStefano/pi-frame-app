import test from "node:test";
import assert from "node:assert/strict";
import { applySessionEventState } from "./app-store-session-state";

const ref = { workspaceId: "workspace", sessionId: "session" };
const event = {
  type: "assistantDelta" as const,
  sessionRef: ref,
  runId: "run",
  timestamp: "2026-01-01T00:00:00.000Z",
  text: " next",
};

test("stream snapshot stays immutable when cache advances by replacement", () => {
  const source = {
    kind: "message" as const,
    id: "assistant",
    role: "assistant" as const,
    text: "before",
    createdAt: event.timestamp,
  };
  const cache = new Map([["workspace:session", [source]]]);
  const state = {
    revision: 1,
    workspaces: [{ id: "workspace", sessions: [{ id: "session", title: "Thread", updatedAt: event.timestamp, status: "running", preview: "", lastViewedAt: undefined, archivedAt: undefined, runningSince: undefined, hasUnseenUpdate: false, config: {} }], }],
  } as any;

  const next = applySessionEventState(state, event, cache, new Map(), new Map());
  const snapshotPreview = next.workspaces[0]?.sessions[0]?.preview;
  cache.set("workspace:session", [{ ...source, text: `${source.text} next` }]);

  assert.equal(snapshotPreview, "before");
  assert.equal(next.workspaces[0]?.sessions[0]?.preview, "before");
});
