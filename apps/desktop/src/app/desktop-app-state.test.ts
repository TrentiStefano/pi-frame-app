import test from "node:test";
import assert from "node:assert/strict";
import { shouldCommitHydratedTranscript } from "./desktop-app-state";
import type { SelectedTranscriptRecord } from "../desktop-state";

function createMockTranscript(workspaceId: string, sessionId: string): SelectedTranscriptRecord {
  return {
    workspaceId,
    sessionId,
    revision: 1,
    transcript: [],
  };
}

test("BUG-003: shouldCommitHydratedTranscript accepts matching session identity", () => {
  const payload = createMockTranscript("ws1", "s1");
  const expected = { workspaceId: "ws1", sessionId: "s1" };
  assert.strictEqual(
    shouldCommitHydratedTranscript(payload, expected),
    true,
    "payload matching expected workspace and session must be committed",
  );
});

test("BUG-003: shouldCommitHydratedTranscript rejects mismatched session identity", () => {
  const payload = createMockTranscript("ws1", "s1");
  const expected = { workspaceId: "ws1", sessionId: "s2" };
  assert.strictEqual(
    shouldCommitHydratedTranscript(payload, expected),
    false,
    "stale payload from previous session s1 must NOT be committed under session s2",
  );
});

test("BUG-003: shouldCommitHydratedTranscript rejects mismatched workspace identity", () => {
  const payload = createMockTranscript("ws1", "s1");
  const expected = { workspaceId: "ws2", sessionId: "s1" };
  assert.strictEqual(
    shouldCommitHydratedTranscript(payload, expected),
    false,
    "payload from workspace ws1 must NOT be committed under workspace ws2",
  );
});

test("BUG-003: shouldCommitHydratedTranscript handles null payload correctly", () => {
  // When no session is selected, null payload is valid
  assert.strictEqual(
    shouldCommitHydratedTranscript(null, { workspaceId: undefined, sessionId: undefined }),
    true,
  );
  assert.strictEqual(
    shouldCommitHydratedTranscript(null, undefined),
    true,
  );

  // When a session is selected, null payload is NOT committed
  assert.strictEqual(
    shouldCommitHydratedTranscript(null, { workspaceId: "ws1", sessionId: "s1" }),
    false,
  );
});

test("BUG-003: shouldCommitHydratedTranscript rejects payload when expected session is undefined", () => {
  const payload = createMockTranscript("ws1", "s1");
  assert.strictEqual(
    shouldCommitHydratedTranscript(payload, undefined),
    false,
  );
  assert.strictEqual(
    shouldCommitHydratedTranscript(payload, { workspaceId: undefined, sessionId: undefined }),
    false,
  );
});
