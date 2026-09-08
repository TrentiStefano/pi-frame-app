import test from "node:test";
import assert from "node:assert/strict";
import { DesktopAppStore } from "./app-store";
import { sessionKey } from "@pi-frame/pi-sdk-driver";
import { SessionStateMap } from "./session-state-map";

test("BUG-002: pruneStaleSessionSubscriptions removes deleted sessions from selectedTranscriptFileStats, refreshers, and generations", async () => {
  const store = Object.create(DesktopAppStore.prototype) as any;
  const activeSessionRef = { workspaceId: "ws1", sessionId: "active-s1" };
  const deletedSessionRef = { workspaceId: "ws1", sessionId: "deleted-s2" };

  const activeKey = sessionKey(activeSessionRef);
  const deletedKey = sessionKey(deletedSessionRef);

  store.sessionState = new SessionStateMap();
  store.sessionSchemaInfoCache = new Map([[activeKey, {}], [deletedKey, {}]]);
  store.sessionCommandRefreshers = new Map([[activeKey, { dirty: false }], [deletedKey, { dirty: false }]]);
  store.sessionCommandRefreshGenerations = new Map([[activeKey, 1], [deletedKey, 2]]);
  store.selectedTranscriptFileStats = new Map([
    [activeKey, { mtimeMs: 1000, size: 500 }],
    [deletedKey, { mtimeMs: 2000, size: 800 }],
  ]);
  store.assistantStreamStateBySession = new Map();
  store.pruneAssistantStreamState = () => {};
  store.pruneOrphanedUiState = () => {};
  store.attachmentStore = {
    listKeys: async () => [activeKey, deletedKey],
    remove: async () => {},
  };

  // Run pruning with only activeSessionRef in the catalog
  const activeCatalogEntries = [
    { sessionRef: activeSessionRef, status: "idle" } as any,
  ];

  await (store as any).pruneStaleSessionSubscriptions(activeCatalogEntries);

  // Assert active session remains in all caches
  assert.strictEqual(store.selectedTranscriptFileStats.has(activeKey), true, "active session file stats should be preserved");
  assert.strictEqual(store.sessionCommandRefreshers.has(activeKey), true, "active session refresher should be preserved");
  assert.strictEqual(store.sessionCommandRefreshGenerations.has(activeKey), true, "active session generation should be preserved");
  assert.strictEqual(store.sessionSchemaInfoCache.has(activeKey), true, "active session schema info should be preserved");

  // Assert deleted session is pruned from all caches
  assert.strictEqual(store.selectedTranscriptFileStats.has(deletedKey), false, "deleted session file stats must be pruned");
  assert.strictEqual(store.sessionCommandRefreshers.has(deletedKey), false, "deleted session refresher must be pruned");
  assert.strictEqual(store.sessionCommandRefreshGenerations.has(deletedKey), false, "deleted session generation must be pruned");
  assert.strictEqual(store.sessionSchemaInfoCache.has(deletedKey), false, "deleted session schema info must be pruned");
});
