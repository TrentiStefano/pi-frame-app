import test from "node:test";
import assert from "node:assert/strict";
import { DesktopAppStore } from "./app-store";
import { sessionKey } from "@pi-frame/pi-sdk-driver";
import type { RuntimeCommandRecord } from "@pi-frame/session-driver/runtime-types";

function createMockCommand(name: string): RuntimeCommandRecord {
  return {
    name,
    description: `Command ${name}`,
    source: "extension",
    sourceInfo: { path: `/ext/${name}`, source: name, scope: "user", origin: "package" },
  };
}

test("BUG-001: stale coalesced command refresh does not overwrite newer direct refresh or emit stale state", async () => {
  const store = Object.create(DesktopAppStore.prototype) as any;
  const sessionRef = { workspaceId: "ws1", sessionId: "s1" };
  const key = sessionKey(sessionRef);

  const commandOld = [createMockCommand("old-cmd")];
  const commandNew = [createMockCommand("new-cmd")];

  let resolveOldRefresh!: (commands: RuntimeCommandRecord[]) => void;
  const oldRefreshPromise = new Promise<RuntimeCommandRecord[]>((resolve) => {
    resolveOldRefresh = resolve;
  });

  let resolveNewRefresh!: (commands: RuntimeCommandRecord[]) => void;
  const newRefreshPromise = new Promise<RuntimeCommandRecord[]>((resolve) => {
    resolveNewRefresh = resolve;
  });

  let callCount = 0;
  store.driver = {
    getSessionCommands: async () => {
      callCount += 1;
      if (callCount === 1) {
        return await oldRefreshPromise;
      }
      return await newRefreshPromise;
    },
  };

  store.sessionCommandRefreshers = new Map();
  store.sessionCommandRefreshGenerations = new Map();
  store.sessionState = {
    sessionSubscriptions: new Map([[key, () => {}]]),
    sessionCommandsBySession: new Map(),
    extensionUiBySession: new Map(),
  };

  let emitted = 0;
  store.state = {
    revision: 1,
    workspaces: [{ id: "ws1", sessions: [{ id: "s1" }] }],
    selectedWorkspaceId: "ws1",
    selectedSessionId: "s1",
    sessionCommandsBySession: {},
  };
  store.syncDerivedSessionState = (state: any) => ({
    ...state,
    sessionCommandsBySession: { [key]: store.sessionState.sessionCommandsBySession.get(key) },
  });
  store.emit = () => {
    emitted += 1;
  };

  // 1. Trigger coalesced refresh (starts request A - old)
  store.refreshSessionCommandsCoalesced(sessionRef);
  assert.strictEqual(callCount, 1, "first coalesced refresh should have called driver");

  // 2. Trigger direct refresh (starts request B - new)
  const directRefreshPromise = store.refreshSessionCommandsFor(sessionRef);
  assert.strictEqual(callCount, 2, "direct refresh should have called driver");

  // 3. Resolve direct refresh (B) first
  resolveNewRefresh(commandNew);
  await directRefreshPromise;

  assert.deepEqual(
    store.sessionState.sessionCommandsBySession.get(key),
    commandNew,
    "direct refresh should have installed new commands",
  );

  const emitCountAfterNew = emitted;

  // 4. Resolve older coalesced refresh (A) second
  resolveOldRefresh(commandOld);
  // Wait a microtask turn for the async coalescer to settle
  await new Promise((r) => setTimeout(r, 20));

  // 5. Assert: stale A did not overwrite B and did not emit
  assert.deepEqual(
    store.sessionState.sessionCommandsBySession.get(key),
    commandNew,
    "stale coalesced refresh must NOT overwrite newer commands",
  );
  assert.strictEqual(
    emitted,
    emitCountAfterNew,
    "stale coalesced refresh must NOT trigger emit",
  );
});

test("BUG-001: closing a session while command refresh is in flight discards commands and does not emit", async () => {
  const store = Object.create(DesktopAppStore.prototype) as any;
  const sessionRef = { workspaceId: "ws1", sessionId: "s1" };
  const key = sessionKey(sessionRef);

  let resolveRefresh!: (commands: RuntimeCommandRecord[]) => void;
  const refreshPromise = new Promise<RuntimeCommandRecord[]>((resolve) => {
    resolveRefresh = resolve;
  });

  store.driver = {
    getSessionCommands: async () => await refreshPromise,
  };

  store.sessionCommandRefreshers = new Map();
  store.sessionCommandRefreshGenerations = new Map();
  store.sessionState = {
    sessionSubscriptions: new Map([[key, () => {}]]),
    sessionCommandsBySession: new Map(),
    extensionUiBySession: new Map(),
  };

  let emitted = 0;
  store.state = {
    revision: 1,
    sessionCommandsBySession: {},
  };
  store.syncDerivedSessionState = (state: any) => state;
  store.emit = () => {
    emitted += 1;
  };

  // Trigger coalesced refresh
  store.refreshSessionCommandsCoalesced(sessionRef);

  // Simulate session closed / unsubscribed while refresh in flight
  store.sessionState.sessionSubscriptions.delete(key);
  store.sessionState.sessionCommandsBySession.delete(key);
  store.sessionCommandRefreshGenerations.delete(key);

  // Resolve refresh
  resolveRefresh([createMockCommand("stale-cmd")]);
  await new Promise((r) => setTimeout(r, 20));

  assert.strictEqual(
    store.sessionState.sessionCommandsBySession.has(key),
    false,
    "closed session must not have commands resurrected",
  );
  assert.strictEqual(emitted, 0, "closed session refresh must not emit");
});

test("BUG-001: coalesced command refresh performs trailing refresh when marked dirty mid-flight", async () => {
  const store = Object.create(DesktopAppStore.prototype) as any;
  const sessionRef = { workspaceId: "ws1", sessionId: "s1" };
  const key = sessionKey(sessionRef);

  let callCount = 0;
  let resolveFirst!: () => void;
  const firstPromise = new Promise<void>((r) => { resolveFirst = r; });

  store.driver = {
    getSessionCommands: async () => {
      callCount += 1;
      if (callCount === 1) {
        await firstPromise;
        return [createMockCommand("v1")];
      }
      return [createMockCommand("v2")];
    },
  };

  store.sessionCommandRefreshers = new Map();
  store.sessionCommandRefreshGenerations = new Map();
  store.sessionState = {
    sessionSubscriptions: new Map([[key, () => {}]]),
    sessionCommandsBySession: new Map(),
    extensionUiBySession: new Map(),
  };

  let emitted = 0;
  store.state = {
    revision: 1,
    sessionCommandsBySession: {},
  };
  store.syncDerivedSessionState = (state: any) => ({
    ...state,
    sessionCommandsBySession: { [key]: store.sessionState.sessionCommandsBySession.get(key) },
  });
  store.emit = () => {
    emitted += 1;
  };

  // Start first refresh
  store.refreshSessionCommandsCoalesced(sessionRef);
  assert.strictEqual(callCount, 1);

  // Request second refresh while first is in flight
  store.refreshSessionCommandsCoalesced(sessionRef);
  assert.strictEqual(callCount, 1, "should not start immediate second driver call");

  // Complete first refresh
  resolveFirst();
  await new Promise((r) => setTimeout(r, 30));

  // Trailing refresh should have executed and installed v2
  assert.strictEqual(callCount, 2, "trailing refresh should have executed");
  assert.deepEqual(
    store.sessionState.sessionCommandsBySession.get(key),
    [createMockCommand("v2")],
    "latest commands from trailing refresh should be stored",
  );
  assert.ok(emitted >= 1, "should have emitted state snapshot");
});
