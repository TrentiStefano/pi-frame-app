import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonCatalogStore, type JsonCatalogStoreWriter } from "../dist/json-catalog-store.js";
import { SessionSupervisor } from "../dist/session-supervisor.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const ref = { workspaceId: "phase1b-workspace", sessionId: "phase1b-session" };

type Internals = {
  readonly records: Map<string, any>;
  handleAgentEvent(record: any, session: any, event: any): Promise<void>;
};

async function fixture(failWrites = 0) {
  const dir = await mkdtemp(join(tmpdir(), "pi-phase1b-"));
  await mkdir(join(dir, "workspace"));
  let writes = 0;
  const writer: JsonCatalogStoreWriter = async (filePath, value) => {
    writes += 1;
    if (writes <= failWrites) throw new Error("injected catalog writer failure");
    const { writeJsonFileAtomic } = await import("../dist/atomic-write.js");
    await writeJsonFileAtomic(filePath, value);
  };
  const catalogFilePath = join(dir, "catalog.json");
  const catalog = new JsonCatalogStore({ catalogFilePath, writer });
  const supervisor = new SessionSupervisor({ catalogStorage: catalog, agentDir: join(dir, "agent") });
  const created = await supervisor.createSession({ workspaceId: ref.workspaceId, path: join(dir, "workspace") }, { title: "Phase 1B" });
  const internals = supervisor as unknown as Internals;
  const record = internals.records.get(`${ref.workspaceId}:${created.ref.sessionId}`)!;
  // AgentSession assigns the run id when prompt execution starts; seed that runtime state
  // so the event mapper is exercised at the same lifecycle point without a provider.
  record.runningRunId = "run-phase1b";
  return { dir, catalogFilePath, catalog, supervisor, internals, record, session: record.session, get writes() { return writes; } };
}

async function cleanup(f: { supervisor: SessionSupervisor; dir: string; record?: { ref: typeof ref } }, sessionRef = f.record?.ref ?? ref) {
  await f.supervisor.closeSession(sessionRef).catch(() => {});
  await rm(f.dir, { recursive: true, force: true });
}

function message(role = "assistant", text = "safe") {
  return { role, content: [{ type: "text", text }], stopReason: "stop" };
}

async function send(f: any, event: any) {
  await f.internals.handleAgentEvent(f.record, f.session, event);
  await f.record.eventQueue;
}

function eventContract(event: any) {
  return [
    event.type,
    event.runId,
    event.snapshot?.status,
    event.snapshot?.runningRunId,
    event.error?.status,
    event.error?.message,
    event.snapshot?.preview,
  ];
}

test("Phase 1B queued send admitted before close is rejected at FIFO entry", async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    const predecessor = new Promise<void>((resolve) => { release = resolve; });
    f.record.runtimeOperationQueue = predecessor;
    let prompts = 0;
    (f.session as any).prompt = async () => { prompts += 1; };
    const baselineWrites = f.writes;
    const sendPromise = f.supervisor.sendUserMessage(f.record.ref, { text: "queued after close", deliverAs: "followUp" });
    await Promise.resolve();
    const closePromise = f.supervisor.closeSession(f.record.ref);
    assert.equal(f.record.closing, true);
    release();
    await assert.rejects(sendPromise, /not active/);
    await closePromise;
    assert.equal(prompts, 0, "queued send must not call prompt after close admission closes");
    assert.equal(f.writes, baselineWrites + 1, "only close persistence is allowed; rejected queued send must not persist");
  } finally { await cleanup(f); }
});

test("Phase 1B retained sync defers live callbacks until catalog replacement", async () => {
  const f = await fixture();
  try {
    const delivered: string[] = [];
    f.supervisor.subscribe(f.record.ref, (event: any) => delivered.push(event.type));
    f.record.unsubscribeAgent?.();
    let callback!: (event: any) => void;
    const session = f.session as any;
    const originalSubscribe = session.subscribe.bind(session);
    session.subscribe = (listener: (event: any) => void) => { callback = listener; return originalSubscribe(listener); };
    await (f.internals as any).bindSessionRuntime(f.record);
    delivered.length = 0;
    const originalReplace = f.catalog.replaceWorkspaceSessions.bind(f.catalog);
    let release!: () => void;
    let replacementEntered!: () => void;
    const replacementGate = new Promise<void>((resolve) => { release = resolve; });
    const replacementStarted = new Promise<void>((resolve) => { replacementEntered = resolve; });
    (f.catalog as any).replaceWorkspaceSessions = async (...args: any[]) => {
      replacementEntered();
      callback({ type: "agent_start" });
      callback({ type: "agent_end", messages: [message()], willRetry: false });
      assert.deepEqual(delivered, [], "callbacks must wait for retained catalog replacement");
      await replacementGate;
      return originalReplace(...args);
    };
    const sync = f.supervisor.syncWorkspace(join(f.dir, "workspace"));
    await replacementStarted;
    release();
    await sync;
    await f.record.eventQueue;
    assert.deepEqual(delivered.slice(-3), ["sessionUpdated", "runCompleted", "sessionUpdated"], "deferred callbacks preserve FIFO order");
    const fresh = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath });
    assert.equal((await fresh.sessions.getSession(f.record.ref))?.status, "idle", "terminal callback must not leave stale catalog state");
  } finally { await cleanup(f); }
});

test("Phase 1B reconciliation fences queued terminal snapshots without reordering events", async () => {
  const f = await fixture();
  try {
    // Use the canonical workspace identity used by retained reconciliation.
    const canonicalWorkspace = await f.supervisor.registerWorkspace(join(f.dir, "workspace"));
    const oldKey = `${f.record.ref.workspaceId}:${f.record.ref.sessionId}`;
    f.record.workspace = canonicalWorkspace;
    f.record.ref = { ...f.record.ref, workspaceId: canonicalWorkspace.workspaceId };
    f.internals.records.delete(oldKey);
    f.internals.records.set(`${f.record.ref.workspaceId}:${f.record.ref.sessionId}`, f.record);
    const delivered: string[] = [];
    let releaseListener!: () => void;
    const listenerGate = new Promise<void>((resolve) => { releaseListener = resolve; });
    f.supervisor.subscribe(f.record.ref, async (event: any) => {
      delivered.push(event.type);
      if (delivered.length === 1) await listenerGate;
    });
    await Promise.resolve();
    delivered.length = 0;

    // The first listener blocks the FIFO. Capture a terminal snapshot behind it,
    // then admit a newer live mutation and reconcile before terminal persistence runs.
    await f.internals.handleAgentEvent(f.record, f.session, { type: "agent_start" });
    await f.internals.handleAgentEvent(f.record, f.session, {
      type: "agent_end", messages: [message("assistant", "older terminal")], willRetry: false,
    });
    f.record.runningRunId = "newer-run";
    await f.internals.handleAgentEvent(f.record, f.session, { type: "agent_start" });
    // Model a newer live mutation that reconciliation must retain.
    f.record.title = "Newer live title";
    f.record.status = "running";
    const sync = f.supervisor.syncWorkspace(join(f.dir, "workspace"));
    await sync;
    releaseListener();
    await f.record.eventQueue;

    assert.deepEqual(delivered, ["sessionUpdated", "runCompleted", "sessionUpdated", "sessionUpdated"]);
    const fresh = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath });
    const entry = await fresh.sessions.getSession(f.record.ref);
    assert.equal(entry?.status, "running", "reconciliation must remain newer than queued terminal snapshot");
    assert.equal(entry?.title, "Newer live title");
    assert.notEqual(entry?.status, "idle", "older terminal status must not overwrite reconciliation");

    // A later retry remains safe and writes the current live state.
    await f.supervisor.flushPersistence();
    const retried = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath });
    assert.equal((await retried.sessions.getSession(f.record.ref))?.status, "running");
  } finally { await cleanup(f); }
});

test("Phase 1B sync drains an admitted mutation before replacing retained catalog entries", async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    f.record.runtimeOperationQueue = blocked;
    const mutation = f.supervisor.renameSession(f.record.ref, "Newer title");
    await Promise.resolve();
    const sync = f.supervisor.syncWorkspace(join(f.dir, "workspace"));
    await Promise.resolve();
    release();
    await Promise.all([mutation, sync]);
    const fresh = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath });
    assert.equal((await fresh.sessions.getSession(f.record.ref))?.title, "Newer title");
  } finally { await cleanup(f); }
});

test("Phase 1B intermediate matrix maps in order with zero physical catalog writes", async () => {
  const f = await fixture();
  try {
    const received: string[] = [];
    f.supervisor.subscribe(f.record.ref, (event: any) => { received.push(event.type); });
    await Promise.resolve();
    received.length = 0;
    const baselineWrites = f.writes;
    const events = [
      { type: "agent_start" }, { type: "turn_start" },
      { type: "message_start", message: message("assistant", "start") },
      { type: "message_update", message: message(), assistantMessageEvent: { type: "text_delta", delta: "a" } },
      { type: "message_end", message: message("assistant", "end") },
      { type: "tool_execution_start", toolName: "read", toolCallId: "call-1", args: {} },
      { type: "tool_execution_update", toolCallId: "call-1", partialResult: { content: [{ type: "text", text: "u" }] } },
      { type: "tool_execution_end", toolCallId: "call-1", isError: false, result: { content: [] } },
      { type: "turn_end" }, { type: "auto_retry_start" },
      { type: "agent_end", messages: [message()], willRetry: true },
      { type: "auto_retry_end", attempt: 1, success: true },
    ];
    for (const event of events) await send(f, event);
    assert.equal(f.writes - baselineWrites, 0, "intermediate events must not write the catalog");
    assert.deepEqual(received, [
      "sessionUpdated", "sessionUpdated", "sessionUpdated", "assistantDelta", "sessionUpdated", "sessionUpdated",
      "toolStarted", "sessionUpdated", "toolUpdated", "sessionUpdated", "toolFinished", "sessionUpdated",
      "sessionUpdated", "sessionUpdated", "sessionUpdated", "sessionUpdated",
    ]);
    const live = await f.supervisor.openSession(f.record.ref);
    assert.equal(live.status, "running");
    assert.ok(live.runningRunId);
    await f.record.eventQueue;
  } finally { await cleanup(f); }
});

test("Phase 1B terminal matrix writes once and persists final metadata", async () => {
  for (const [name, event] of [
    ["success", { type: "agent_end", messages: [message()], willRetry: false }],
    ["failure", { type: "agent_end", messages: [{ role: "assistant", stopReason: "error", errorMessage: "safe failure" }], willRetry: false }],
    ["retry failure", { type: "auto_retry_end", attempt: 2, success: false, finalError: "safe retry failure" }],
  ] as const) {
    const f = await fixture();
    try {
      const received: any[] = [];
      f.supervisor.subscribe(f.record.ref, (e: any) => received.push(e));
      await Promise.resolve();
      received.length = 0;
      await send(f, { type: "agent_start" });
      await send(f, { type: "message_start", message: message("assistant", "safe preview") });
      const before = f.writes;
      await send(f, event);
      assert.equal(f.writes - before, 1, `${name} terminal boundary must write once`);
      assert.deepEqual(received.map(eventContract), name === "success" || name === "failure" ? [
        ["sessionUpdated", undefined, "running", "run-phase1b", undefined, undefined, undefined],
        ["sessionUpdated", undefined, "running", "run-phase1b", undefined, undefined, "safe preview"],
        name === "success"
          ? ["runCompleted", "run-phase1b", "idle", undefined, undefined, undefined, "safe preview"]
          : ["runFailed", "run-phase1b", undefined, undefined, undefined, "safe failure", undefined],
        name === "success"
          ? ["sessionUpdated", undefined, "idle", undefined, undefined, undefined, "safe preview"]
          : ["sessionUpdated", undefined, "failed", undefined, undefined, undefined, "safe failure"],
      ] : [
        ["sessionUpdated", undefined, "running", "run-phase1b", undefined, undefined, undefined],
        ["sessionUpdated", undefined, "running", "run-phase1b", undefined, undefined, "safe preview"],
        ["runFailed", "run-phase1b", undefined, undefined, undefined, "safe retry failure", undefined],
        ["sessionUpdated", undefined, "failed", undefined, undefined, undefined, "safe retry failure"],
      ]);
      const fresh = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath });
      const entry = await fresh.sessions.getSession(f.record.ref);
      assert.ok(entry?.sessionFilePath);
      assert.equal(entry?.status, name === "success" ? "idle" : "failed");
      assert.ok(entry?.previewSnippet);
    } finally { await cleanup(f); }
  }
});

test("Phase 1B terminal persistence uses the captured boundary snapshot across later mutations", async () => {
  const f = await fixture();
  try {
    let entered!: () => void;
    let release!: () => void;
    const writerEntered = new Promise<void>((resolve) => { entered = resolve; });
    const writerGate = new Promise<void>((resolve) => { release = resolve; });
    let writes = 0;
    const gatedCatalog = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath, writer: async (path, value) => {
      writes += 1;
      entered();
      await writerGate;
      const { writeJsonFileAtomic } = await import("../dist/atomic-write.js");
      await writeJsonFileAtomic(path, value);
    } });
    (f.supervisor as any).catalogs = gatedCatalog;
    f.record.preview = "terminal preview";
    const terminal = f.internals.handleAgentEvent(f.record, f.session, {
      type: "agent_end", messages: [message()], willRetry: false,
    });
    await writerEntered;
    // A later run mutates the live record while the terminal write is blocked.
    f.record.status = "running";
    f.record.runningRunId = "later-run";
    f.record.preview = "later preview";
    release();
    await terminal;
    await f.record.eventQueue;
    const terminalCatalog = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath });
    const terminalEntry = await terminalCatalog.sessions.getSession(f.record.ref);
    assert.equal(writes, 1);
    assert.equal(terminalEntry?.status, "idle");
    assert.equal(terminalEntry?.previewSnippet, "terminal preview");
    await f.supervisor.flushPersistence();
    const finalCatalog = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath });
    const finalEntry = await finalCatalog.sessions.getSession(f.record.ref);
    assert.equal(writes, 2);
    assert.equal(finalEntry?.status, "running");
    assert.equal(finalEntry?.previewSnippet, "later preview");
  } finally { await cleanup(f); }
});

test("Phase 1B terminal writer failure preserves order, recovers queue, and flush retries", async () => {
  const f = await fixture();
  try {
    let failNext = true;
    let failingWrites = 0;
    const failingCatalog = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath, writer: async (path, value) => {
      failingWrites += 1;
      if (failNext) { failNext = false; throw new Error("injected terminal failure"); }
      const { writeJsonFileAtomic } = await import("../dist/atomic-write.js");
      await writeJsonFileAtomic(path, value);
    } });
    // Replace the shared catalog only through the existing test fixture owner seam.
    (f.supervisor as any).catalogs = failingCatalog;
    const received: string[] = [];
    f.supervisor.subscribe(f.record.ref, (e: any) => received.push(e.type));
    await Promise.resolve();
    received.length = 0;
    await send(f, { type: "agent_start" });
    await send(f, { type: "agent_end", messages: [message()], willRetry: false });
    await send(f, { type: "turn_start" });
    assert.deepEqual(received, ["sessionUpdated", "runCompleted", "sessionUpdated", "sessionUpdated"]);
    await f.supervisor.flushPersistence();
    assert.equal(failingWrites, 2, "one failed terminal attempt plus one flush retry; no unexpected writes");
    const fresh = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath });
    assert.equal((await fresh.sessions.getSession(f.record.ref))?.status, "running");
  } finally { await cleanup(f); }
});

test("Phase 1B AgentSession callback path delivers the complete fixture in order", async () => {
  const f = await fixture();
  try {
    const delivered: any[] = [];
    f.supervisor.subscribe(f.record.ref, (event: any) => delivered.push(event));
    let callback: ((event: any) => void) | undefined;
    const session = f.session as any;
    const originalSubscribe = session.subscribe.bind(session);
    session.subscribe = (listener: (event: any) => void) => {
      callback = listener;
      return originalSubscribe(listener);
    };
    await (f.internals as any).bindSessionRuntime(f.record);
    assert.ok(callback, "production bindSessionRuntime must register one AgentSession callback");
    delivered.length = 0;
    const baselineWrites = f.writes;
    const fixtureEvents = [
      { type: "agent_start" },
      { type: "turn_start" },
      { type: "message_start", message: message("assistant", "callback preview") },
      { type: "message_update", message: message(), assistantMessageEvent: { type: "text_delta", delta: "a" } },
      { type: "tool_execution_start", toolName: "read", toolCallId: "callback", args: { path: "fixture.txt" } },
      { type: "tool_execution_update", toolCallId: "callback", partialResult: { content: [{ type: "text", text: "reading" }], progress: 0.5, details: { phase: "read" } } },
      { type: "tool_execution_end", toolCallId: "callback", isError: false, result: { content: [{ type: "text", text: "done" }] } },

      { type: "agent_end", messages: [message()], willRetry: false },
    ];
    for (const event of fixtureEvents) callback!(event);
    await f.record.eventQueue;
    assert.equal(f.writes - baselineWrites, 1, "callback terminal boundary must perform one physical write");
    for (const event of delivered) {
      assert.deepEqual(event.sessionRef, f.record.ref);
      assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    }
    assert.equal(delivered[3].text, "a");
    assert.deepEqual([delivered[5].callId, delivered[5].toolName, delivered[5].input], ["callback", "read", { path: "fixture.txt" }]);
    assert.deepEqual([delivered[7].callId, delivered[7].text, delivered[7].progress, delivered[7].details], ["callback", "reading", 0.5, { phase: "read" }]);
    assert.deepEqual([delivered[9].callId, delivered[9].success, delivered[9].output], ["callback", true, { content: [{ type: "text", text: "done" }] }]);
    assert.deepEqual(delivered.map(eventContract), [
      ["sessionUpdated", undefined, "running", "run-phase1b", undefined, undefined, undefined],
      ["sessionUpdated", undefined, "running", "run-phase1b", undefined, undefined, undefined],
      ["sessionUpdated", undefined, "running", "run-phase1b", undefined, undefined, "callback preview"],
      ["assistantDelta", "run-phase1b", undefined, undefined, undefined, undefined, undefined],
      ["sessionUpdated", undefined, "running", "run-phase1b", undefined, undefined, "safe"],
      ["toolStarted", "run-phase1b", undefined, undefined, undefined, undefined, undefined],
      ["sessionUpdated", undefined, "running", "run-phase1b", undefined, undefined, "safe"],
      ["toolUpdated", "run-phase1b", undefined, undefined, undefined, undefined, undefined],
      ["sessionUpdated", undefined, "running", "run-phase1b", undefined, undefined, "safe"],
      ["toolFinished", "run-phase1b", undefined, undefined, undefined, undefined, undefined],
      ["sessionUpdated", undefined, "running", "run-phase1b", undefined, undefined, "safe"],
      ["runCompleted", "run-phase1b", "idle", undefined, undefined, undefined, "safe"],
      ["sessionUpdated", undefined, "idle", undefined, undefined, undefined, "safe"],
    ]);
    const jsonl = await readFile(f.record.sessionFile!, "utf8");
    assert.ok(jsonl.length > 0, "callback fixture must leave a readable JSONL session");
    SessionManager.open(f.record.sessionFile!);
    const reopened = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath });
    assert.equal((await reopened.sessions.getSession(f.record.ref))?.status, "idle");
  } finally { await cleanup(f); }
});

test("Phase 1B close drains queued mapped events before sessionClosed", async () => {
  const f = await fixture();
  try {
    const received: string[] = [];
    (f.session as any).abort = async () => {};
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    f.supervisor.subscribe(f.record.ref, async (event: any) => {
      received.push(event.type);
      if (event.type === "assistantDelta") await gate;
    });
    await Promise.resolve();
    received.length = 0;
    const mapped = f.internals.handleAgentEvent(f.record, f.session, {
      type: "message_update", message: message(), assistantMessageEvent: { type: "text_delta", delta: "queued" },
    });
    await Promise.resolve();
    const closing = f.supervisor.closeSession(f.record.ref);
    await Promise.resolve();
    assert.deepEqual(received, ["assistantDelta"], "close must not overtake queued mapped event");
    release();
    await Promise.all([mapped, closing]);
    assert.equal(received.at(-1), "sessionClosed");
  } finally { await cleanup(f); }
});

test("Phase 1B close drains queued-but-not-started events before sessionClosed", async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    f.record.eventQueue = blocked;
    const received: string[] = [];
    f.supervisor.subscribe(f.record.ref, (event: any) => { received.push(event.type); });
    await Promise.resolve();
    received.length = 0;
    await f.internals.handleAgentEvent(f.record, f.session, {
      type: "message_update", message: message(),
      assistantMessageEvent: { type: "text_delta", delta: "queued-before-close" },
    });
    const closing = f.supervisor.closeSession(f.record.ref);
    await Promise.resolve();
    assert.deepEqual(received, [], "queued event must not start while its FIFO predecessor is blocked");
    release();
    await closing;
    assert.deepEqual(received, ["assistantDelta", "sessionUpdated", "sessionClosed"]);
    assert.equal(received.filter((type) => type === "sessionClosed").length, 1);
  } finally { await cleanup(f); }
});

test("Phase 1B workspace removal and flush preserve deletion in both orders", async () => {
  for (const order of ["flush-first", "remove-first"] as const) {
    const f = await fixture();
    try {
      if (order === "flush-first") {
        await f.supervisor.flushPersistence();
        await f.supervisor.removeWorkspace(ref.workspaceId);
      } else {
        await f.supervisor.removeWorkspace(ref.workspaceId);
        await f.supervisor.flushPersistence();
      }
      const fresh = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath });
      assert.equal(await fresh.workspaces.getWorkspace(ref.workspaceId), undefined, `${order}: workspace resurrected`);
      assert.equal(await fresh.sessions.getSession(ref), undefined, `${order}: session resurrected`);
    } finally { await cleanup(f); }
  }
});

test("Phase 1B removal drains blocked terminal writers before catalog deletion", async () => {
  for (const mode of ["workspace removal", "sync reconcile"] as const) {
    const f = await fixture();
    try {
      let entered!: () => void;
      let release!: () => void;
      const writerEntered = new Promise<void>((resolve) => { entered = resolve; });
      const writerGate = new Promise<void>((resolve) => { release = resolve; });
      let writes = 0;
      const gatedCatalog = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath, writer: async (path, value) => {
        writes += 1;
        entered();
        await writerGate;
        const { writeJsonFileAtomic } = await import("../dist/atomic-write.js");
        await writeJsonFileAtomic(path, value);
      } });
      (f.supervisor as any).catalogs = gatedCatalog;
      const terminal = f.internals.handleAgentEvent(f.record, f.session, {
        type: "agent_end", messages: [message("assistant", "terminal")], willRetry: false,
      });
      await writerEntered;
      const removal = mode === "workspace removal"
        ? f.supervisor.removeWorkspace(ref.workspaceId)
        : (async () => {
            await unlink(f.record.sessionFile!);
            await f.supervisor.syncWorkspace(join(f.dir, "workspace"));
          })();
      await Promise.resolve();
      release();
      await Promise.all([terminal, removal]);
      const fresh = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath });
      assert.ok(writes >= 2, `${mode}: terminal writer plus lifecycle catalog writes must complete`);
      assert.deepEqual(
        await fresh.workspaces.getWorkspace(ref.workspaceId),
        mode === "workspace removal" ? undefined : (await gatedCatalog.workspaces.getWorkspace(ref.workspaceId)),
        `${mode}: workspace lifecycle mismatch`,
      );
      assert.equal(await fresh.sessions.getSession(ref), undefined, `${mode}: session resurrected`);
      assert.equal(await fresh.getSessionFile(ref), undefined, `${mode}: stale session-file mapping`);
    } finally { await cleanup(f); }
  }

  // Keep this regression in the same focused test so the Phase 1B suite count
  // remains stable while covering both a blocked abort and an admitted runtime
  // operation racing workspace removal.
  for (const order of ["close-first", "remove-first"] as const) {
    const f = await fixture();
    try {
      let releaseAbort!: () => void;
      const abortGate = new Promise<void>((resolve) => { releaseAbort = resolve; });
      let abortStarted!: () => void;
      const abortEntered = new Promise<void>((resolve) => { abortStarted = resolve; });
      (f.session as any).abort = async () => { abortStarted(); await abortGate; };
      let releaseRuntime!: () => void;
      const runtimeGate = new Promise<void>((resolve) => { releaseRuntime = resolve; });
      let close: Promise<void>;
      let removal: Promise<void>;
      if (order === "close-first") {
        close = f.supervisor.closeSession(f.record.ref);
        await abortEntered;
        removal = f.supervisor.removeWorkspace(ref.workspaceId);
        releaseAbort();
      } else {
        (f.record as any).runtimeOperationQueue = runtimeGate;
        removal = f.supervisor.removeWorkspace(ref.workspaceId);
        await Promise.resolve();
        close = f.supervisor.closeSession(f.record.ref);
        releaseRuntime();
        releaseAbort();
      }
      await Promise.all([close, removal]);
      const fresh = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath });
      assert.equal(await fresh.workspaces.getWorkspace(ref.workspaceId), undefined, `${order}: workspace remains`);
      assert.equal(await fresh.sessions.getSession(f.record.ref), undefined, `${order}: session remains`);
      assert.equal(await fresh.getSessionFile(f.record.ref), undefined, `${order}: path mapping remains`);
    } finally { await cleanup(f); }
  }
});

test("Phase 1B public cancel and compact races cannot resurrect removed sessions", async () => {
  for (const operation of ["cancel", "compact"] as const) {
    const f = await fixture();
    try {
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      if (operation === "cancel") {
        (f.session as any).abort = async () => { entered(); await gate; };
      } else {
        (f.session as any).compact = async () => { entered(); await gate; };
      }
      const pending = operation === "cancel"
        ? f.supervisor.cancelCurrentRun(f.record.ref)
        : f.supervisor.compactSession(f.record.ref);
      await started;
      const removal = f.supervisor.removeWorkspace(ref.workspaceId);
      release();
      await Promise.all([pending, removal]);
      const fresh = new JsonCatalogStore({ catalogFilePath: f.catalogFilePath });
      assert.equal(await fresh.workspaces.getWorkspace(ref.workspaceId), undefined, `${operation}: workspace remains`);
      assert.equal(await fresh.sessions.getSession(f.record.ref), undefined, `${operation}: session remains`);
      assert.equal(await fresh.getSessionFile(f.record.ref), undefined, `${operation}: path mapping remains`);
    } finally { await cleanup(f); }
  }
});

test("Phase 1B flush waits for runtime operation, event queue, and catalog writer", async () => {
  const f = await fixture();
  try {
    let releaseRuntime!: () => void;
    let releaseEvents!: () => void;
    let releaseWriter!: () => void;
    const runtimeGate = new Promise<void>((resolve) => { releaseRuntime = resolve; });
    const eventGate = new Promise<void>((resolve) => { releaseEvents = resolve; });
    const writerGate = new Promise<void>((resolve) => { releaseWriter = resolve; });
    (f.record as any).runtimeOperationQueue = runtimeGate;
    (f.record as any).eventQueue = eventGate;
    (f.catalog as any).writer = async () => { await writerGate; };
    let settled = false;
    const flushing = f.supervisor.flushPersistence().then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false, "flush must wait for an active runtime operation");
    releaseRuntime();
    await Promise.resolve();
    assert.equal(settled, false, "flush must wait for the per-record event queue");
    releaseEvents();
    await Promise.resolve();
    assert.equal(settled, false, "flush must wait for the catalog writer");
    releaseWriter();
    await flushing;
    assert.equal(settled, true);
  } finally { await cleanup(f); }
});

test("Phase 1B callback count matrix records 80 deltas plus tools without intermediate writes", async () => {
  const f = await fixture();
  try {
    const baselineWrites = f.writes;
    let callback!: (event: any) => void;
    const session = f.session as any;
    const originalSubscribe = session.subscribe.bind(session);
    session.subscribe = (listener: (event: any) => void) => { callback = listener; return originalSubscribe(listener); };
    await (f.internals as any).bindSessionRuntime(f.record);
    for (let i = 0; i < 80; i++) {
      callback({ type: "message_update", message: message(), assistantMessageEvent: { type: "text_delta", delta: "x" } });
      if (i === 40) {
        callback({ type: "tool_execution_start", toolName: "read", toolCallId: "bench", args: {} });
        callback({ type: "tool_execution_update", toolCallId: "bench", partialResult: { content: [] } });
        callback({ type: "tool_execution_end", toolCallId: "bench", isError: false, result: { content: [] } });
      }
    }
    await f.record.eventQueue;
    assert.equal(f.writes - baselineWrites, 0);
    callback({ type: "agent_end", messages: [message()], willRetry: false });
    await f.record.eventQueue;
    assert.equal(f.writes - baselineWrites, 1);
  } finally { await cleanup(f); }
});
