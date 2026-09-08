import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { JsonCatalogStore, type JsonCatalogStoreWriter } from "../dist/json-catalog-store.js";
import { createAgentSessionRuntimeWithNpmFallback } from "../dist/npm-package-fallback.js";
import { mergeSessionResourceLoaderOptions, SessionSupervisor } from "../dist/session-supervisor.js";
import { sessionLeasePath } from "../dist/session-lease.js";

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-session-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const sessionRef = { workspaceId: "workspace-1", sessionId: "session-1" };

test("rename is lifecycle-serialized and cannot resurrect a removed workspace", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    const supervisor = new SessionSupervisor({ catalogFilePath: join(dir, "catalog.json") });
    const workspace = await supervisor.registerWorkspace(workspacePath, "Original");
    const removal = supervisor.removeWorkspace(workspace.workspaceId);
    const rename = supervisor.renameWorkspace(workspace.workspaceId, "Resurrected");
    await removal;
    await assert.rejects(rename, /Unknown workspace/);
    assert.equal((await supervisor.listWorkspaces()).workspaces.some((entry) => entry.workspaceId === workspace.workspaceId), false);
  });
});

test("resource options can suppress default inline extensions", () => {
  const defaultFactory = () => {};
  const options = mergeSessionResourceLoaderOptions([defaultFactory], {
    extensionFactories: [],
    additionalSkillPaths: ["C:\\agent-skill"],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "C:\\agent-skill\\SKILL.md",
  });

  assert.deepEqual(options.extensionFactories, []);
  assert.equal(options.noExtensions, true);
  assert.equal(options.noSkills, true);
  assert.equal(options.noPromptTemplates, true);
  assert.equal(options.noThemes, true);
  assert.equal(options.noContextFiles, true);
  assert.deepEqual(options.additionalSkillPaths, ["C:\\agent-skill"]);
});

test("injected catalog storage persists exactly one create and one fork session representation", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    let physicalWrites = 0;
    let sessionRepresentationWrites = 0;
    let previousSessionCount = 0;
    const writer: JsonCatalogStoreWriter = async (filePath, value) => {
      physicalWrites += 1;
      const state = value as { sessions?: unknown[] };
      const sessionCount = Array.isArray(state.sessions) ? state.sessions.length : 0;
      if (sessionCount > previousSessionCount) {
        sessionRepresentationWrites += sessionCount - previousSessionCount;
      }
      previousSessionCount = sessionCount;
      const { writeJsonFileAtomic } = await import("../dist/atomic-write.js");
      await writeJsonFileAtomic(filePath, value);
    };
    const catalogFilePath = join(dir, "catalogs.json");
    const catalogStorage = new JsonCatalogStore({ catalogFilePath, writer });
    const supervisor = new SessionSupervisor({ agentDir: join(dir, "agent"), catalogStorage });
    const workspace = { workspaceId: "workspace-1", path: workspacePath };

    const created = await supervisor.createSession(workspace, { title: "Source" });
    const afterCreatePhysicalWrites = physicalWrites;
    assert.equal(sessionRepresentationWrites, 1);
    const sourceFile = await supervisor.getSessionFilePath(created.ref);
    assert.ok(sourceFile);
    const manager = SessionManager.open(sourceFile);
    manager.appendMessage({ role: "user", content: "Fork this", timestamp: Date.now() });
    await supervisor.reloadSession(created.ref);
    await supervisor.closeSession(created.ref);
    const forked = await supervisor.forkSession(created.ref, {
      targetWorkspace: workspace,
      userMessageIndex: 0,
      position: "at",
      title: "Fork",
    });
    assert.equal(sessionRepresentationWrites, 2);
    assert.ok(physicalWrites > afterCreatePhysicalWrites);

    await supervisor.closeSession(created.ref);
    await supervisor.closeSession(forked.snapshot.ref);
    const reopened = new JsonCatalogStore({ catalogFilePath });
    const sessions = (await reopened.sessions.listSessions(workspace.workspaceId)).sessions;
    assert.equal(sessions.length, 2);
    assert.ok(sessions.every((session) => session.sessionFilePath));
    assert.equal(await reopened.getSessionFile(created.ref), sessions.find((session) => session.sessionRef.sessionId === created.ref.sessionId)?.sessionFilePath);
    assert.equal(await reopened.getSessionFile(forked.snapshot.ref), sessions.find((session) => session.sessionRef.sessionId === forked.snapshot.ref.sessionId)?.sessionFilePath);
  });
});

test("close then reopen restores callback and mutation admission", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    const supervisor = new SessionSupervisor({ agentDir: join(dir, "agent"), catalogFilePath: join(dir, "catalog.json") });
    const created = await supervisor.createSession({ workspaceId: "workspace-1", path: workspacePath }, { title: "Reopen" });
    await supervisor.closeSession(created.ref);
    await supervisor.openSession(created.ref);
    const events: string[] = [];
    supervisor.subscribe(created.ref, (event) => events.push(event.type));
    await supervisor.renameSession(created.ref, "Reopened");
    const internals = supervisor as unknown as { readonly records: Map<string, any> };
    const record = internals.records.get(`${created.ref.workspaceId}:${created.ref.sessionId}`)!;
    await record.eventQueue;
    await (supervisor as any).handleAgentEvent(record, record.session, { type: "agent_start" });
    await record.eventQueue;
    assert.equal((await supervisor.openSession(created.ref)).title, "Reopened");
    assert.ok(events.includes("sessionUpdated"), "reopened runtime callbacks and mutations must remain admitted");
    await supervisor.closeSession(created.ref);
  });
});

test("fork runtime construction failure removes only the generated branch and can retry", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    let failForkRuntime = false;
    let failedForkPath: string | undefined;
    let sourceRuntimePath: string | undefined;
    const supervisor = new SessionSupervisor({
      agentDir: join(dir, "agent"),
      catalogFilePath: join(dir, "catalog.json"),
      createAgentSessionRuntimeImpl: async (options) => {
        const runtimePath = options?.sessionManager?.getSessionFile();
        if (!sourceRuntimePath) {
          sourceRuntimePath = runtimePath;
        }
        if (failForkRuntime && runtimePath !== sourceRuntimePath) {
          failedForkPath = runtimePath;
          throw new Error("fork runtime construction failed");
        }
        return createAgentSessionRuntimeWithNpmFallback(options);
      },
    });
    const workspace = { workspaceId: "workspace-1", path: workspacePath };
    const source = await supervisor.createSession(workspace, { title: "Fork source" });
    const sourceFile = await supervisor.getSessionFilePath(source.ref);
    assert.ok(sourceFile);
    const manager = SessionManager.open(sourceFile);
    manager.appendMessage({ role: "user", content: "Fork this", timestamp: Date.now() });
    await supervisor.reloadSession(source.ref);
    await supervisor.closeSession(source.ref);
    const before = (await supervisor.listSessions(workspace.workspaceId)).sessions;

    failForkRuntime = true;
    await assert.rejects(
      supervisor.forkSession(source.ref, { targetWorkspace: workspace, userMessageIndex: 0, position: "at" }),
      /fork runtime construction failed/,
    );
    assert.ok(failedForkPath);
    await assert.rejects(readFile(failedForkPath!, "utf8"));
    await assert.rejects(readFile(sessionLeasePath(failedForkPath!), "utf8"));
    const afterFailure = (await supervisor.listSessions(workspace.workspaceId)).sessions;
    assert.equal(afterFailure.length, before.length);
    assert.equal(afterFailure[0]?.sessionRef.sessionId, before[0]?.sessionRef.sessionId);
    assert.equal((await SessionManager.list(workspacePath)).some((info) => info.path === failedForkPath), false);

    const synced = await supervisor.syncWorkspace(workspacePath);
    assert.equal(synced.sessions.length, before.length);
    assert.equal(synced.sessions.some((entry) => entry.sessionFilePath === failedForkPath), false);
    failForkRuntime = false;
    const retry = await supervisor.forkSession(source.ref, { targetWorkspace: workspace, userMessageIndex: 0, position: "at" });
    assert.ok(retry.snapshot.ref.sessionId);
    assert.equal((await supervisor.listSessions(workspace.workspaceId)).sessions.length, 2);
    await supervisor.closeSession(retry.snapshot.ref);
  });
});

test("session behavior survives create, reload, reopen, and fork", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    const profileRefs: string[] = [];
    const supervisor = new SessionSupervisor({
      agentDir: join(dir, "agent"),
      catalogFilePath: join(dir, "catalogs.json"),
      sessionProfileFactory: ({ sessionRef }) => {
        profileRefs.push(sessionRef?.sessionId ?? "unknown");
        return undefined;
      },
    });
    const workspace = { workspaceId: "workspace-1", path: workspacePath };

    const created = await supervisor.createSession(workspace, { title: "Bracket" });
    assert.equal(created.title, "Bracket");

    await supervisor.reloadSession(created.ref);
    assert.equal((await supervisor.openSession(created.ref)).title, "Bracket");

    const sessionFile = await supervisor.getSessionFilePath(created.ref);
    assert.ok(sessionFile);
    await supervisor.closeSession(created.ref);
    assert.equal((await supervisor.openSession(created.ref)).title, "Bracket");
    await supervisor.closeSession(created.ref);

    const manager = SessionManager.open(sessionFile!);
    manager.appendMessage({ role: "user", content: "Make a 20 mm bracket", timestamp: Date.now() });
    const forked = await supervisor.forkSession(created.ref, {
      targetWorkspace: workspace,
      userMessageIndex: 0,
      position: "at",
      title: "Bracket variant",
    });
    assert.equal(forked.snapshot.title, "Bracket variant");
    assert.equal((await supervisor.listSessions(workspace.workspaceId)).sessions.every((entry) => entry.title.length > 0), true);

    await supervisor.closeSession(created.ref);
    await supervisor.closeSession(forked.snapshot.ref);
    assert.equal(profileRefs.length, 4);
    assert.ok(profileRefs.every((ref) => ref.length > 0));
  });
});

test("session reuses custom Pi model, endpoint, model runtime, and thinking after supervisor restart", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    const agentDir = join(dir, "agent");
    const catalogFilePath = join(dir, "catalogs.json");
    const authFilePath = join(agentDir, "auth.json");
    const modelsFilePath = join(agentDir, "models.json");
    const settingsFilePath = join(agentDir, "settings.json");
    const provider = "session-config-proof";
    const modelId = "reasoning-model";
    const baseUrl = "https://session-config-proof.invalid/v1";
    const apiKey = "auth-json-only-key";
    await mkdir(workspacePath);
    await mkdir(agentDir);
    await writeFile(
      authFilePath,
      `${JSON.stringify({ [provider]: { type: "api_key", key: apiKey } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      modelsFilePath,
      `${JSON.stringify(
        {
          providers: {
            [provider]: {
              baseUrl,
              api: "openai-completions",
              models: [{ id: modelId, reasoning: true }],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const createSupervisor = async () => {
      const modelRuntime = await ModelRuntime.create({ authPath: authFilePath, modelsPath: modelsFilePath });
      const runtimeProofs: Array<{
        readonly agentDir?: string;
        readonly provider?: string;
        readonly modelId?: string;
        readonly baseUrl?: string;
        readonly thinkingLevel?: string;
        readonly authKey?: string;
        readonly authSource?: string;
      }> = [];
      const supervisor = new SessionSupervisor({
        agentDir,
        modelRuntime,
        catalogFilePath,
        createAgentSessionRuntimeImpl: async (options) => {
          const runtime = await createAgentSessionRuntimeWithNpmFallback(options);
          const model = runtime.session.model;
          runtimeProofs.push({
            agentDir: options?.agentDir,
            provider: model?.provider,
            modelId: model?.id,
            baseUrl: model?.baseUrl,
            thinkingLevel: runtime.session.thinkingLevel,
            authKey: model ? (await options?.modelRuntime?.getAuth(model))?.auth.apiKey : undefined,
            authSource: model ? options?.modelRuntime?.getProviderAuthStatus(model.provider).source : undefined,
          });
          return runtime;
        },
      });
      return { supervisor, runtimeProofs };
    };

    const workspace = { workspaceId: "workspace-1", path: workspacePath };
    const firstProcess = await createSupervisor();
    const created = await firstProcess.supervisor.createSession(workspace, {
            title: "Configured session",
      initialModel: { provider, modelId },
      initialThinkingLevel: "high",
    });
    assert.equal(created.title, "Configured session");
    assert.deepEqual(created.config, { provider, modelId, thinkingLevel: "high" });
    assert.deepEqual(firstProcess.runtimeProofs, [
      { agentDir, provider, modelId, baseUrl, thinkingLevel: "high", authKey: apiKey, authSource: "stored" },
    ]);
    await firstProcess.supervisor.closeSession(created.ref);

    const secondProcess = await createSupervisor();
    const reopened = await secondProcess.supervisor.openSession(created.ref);
    assert.equal(reopened.title, "Configured session");
    assert.deepEqual(reopened.config, { provider, modelId, thinkingLevel: "high" });
    assert.deepEqual(secondProcess.runtimeProofs, [
      { agentDir, provider, modelId, baseUrl, thinkingLevel: "high", authKey: apiKey, authSource: "stored" },
    ]);
    await secondProcess.supervisor.closeSession(created.ref);

    await writeFile(
      authFilePath,
      `${JSON.stringify({ openai: { type: "api_key", key: "fallback-openai-key" } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      settingsFilePath,
      `${JSON.stringify(
        {
          defaultProvider: "openai",
          defaultModel: "gpt-5",
          defaultThinkingLevel: "medium",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const fallbackProcess = await createSupervisor();
    const fallback = await fallbackProcess.supervisor.openSession(created.ref);
    assert.deepEqual(fallback.config, { provider: "openai", modelId: "gpt-5", thinkingLevel: "high" });
    assert.equal(fallbackProcess.runtimeProofs[0]?.provider, "openai");
    assert.equal(fallbackProcess.runtimeProofs[0]?.modelId, "gpt-5");
    assert.equal(fallbackProcess.runtimeProofs[0]?.thinkingLevel, "high");
    assert.equal(fallbackProcess.runtimeProofs[0]?.authKey, "fallback-openai-key");
    assert.equal(fallbackProcess.runtimeProofs[0]?.authSource, "stored");
    await fallbackProcess.supervisor.closeSession(created.ref);
  });
});

test("session runtime rebind resolves an updated endpoint for the same provider and model", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    const agentDir = join(dir, "agent");
    const authFilePath = join(agentDir, "auth.json");
    const modelsFilePath = join(agentDir, "models.json");
    const provider = "session-hot-reload";
    const modelId = "session-model";
    const endpointA = "https://session-endpoint-a.invalid/v1";
    const endpointB = "https://session-endpoint-b.invalid/v1";
    await mkdir(workspacePath);
    await mkdir(agentDir);
    await writeFile(
      authFilePath,
      `${JSON.stringify({ [provider]: { type: "api_key", key: "session-hot-reload-key" } }, null, 2)}\n`,
      "utf8",
    );
    const writeModels = (baseUrl: string) =>
      writeFile(
        modelsFilePath,
        `${JSON.stringify(
          {
            providers: {
              [provider]: {
                baseUrl,
                api: "openai-completions",
                models: [{ id: modelId }],
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    await writeModels(endpointA);

    const modelRuntime = await ModelRuntime.create({ authPath: authFilePath, modelsPath: modelsFilePath });
    const runtimeEndpoints: Array<string | undefined> = [];
    const profileRefs: string[] = [];
    let failNextRuntime = false;
    const supervisor = new SessionSupervisor({
      agentDir,
      modelRuntime,
      catalogFilePath: join(dir, "catalogs.json"),
      sessionProfileFactory: ({ sessionRef }) => {
        profileRefs.push(sessionRef?.sessionId ?? "unknown");
        return undefined;
      },
      createAgentSessionRuntimeImpl: async (options) => {
        if (failNextRuntime) {
          failNextRuntime = false;
          throw new Error("replacement runtime failed");
        }
        const runtime = await createAgentSessionRuntimeWithNpmFallback(options);
        runtimeEndpoints.push(runtime.session.model?.baseUrl);
        return runtime;
      },
    });
    const workspace = { workspaceId: "workspace-1", path: workspacePath };
    const created = await supervisor.createSession(workspace, {
            initialModel: { provider, modelId },
      title: "Hot reload session",
    });
    assert.deepEqual(runtimeEndpoints, [endpointA]);

    await writeModels(endpointB);
    await modelRuntime.reloadConfig();
    const records = (supervisor as unknown as {
      readonly records: Map<string, {
        readonly ref: { readonly sessionId: string };
        readonly kind: string;
        readonly session?: { readonly model?: { readonly baseUrl?: string } };
        readonly runtime?: { dispose(): Promise<void> };
      }>;
    }).records;
    const originalRecord = [...records.values()].find((record) => record.ref.sessionId === created.ref.sessionId)!;
    const originalRuntime = originalRecord.runtime!;
    const originalDispose = originalRuntime.dispose.bind(originalRuntime);
    let originalDisposed = false;
    originalRuntime.dispose = async () => {
      originalDisposed = true;
      await originalDispose();
    };

    failNextRuntime = true;
    await assert.rejects(supervisor.rebindSession(created.ref), /replacement runtime failed/);
    assert.equal(originalRecord.runtime, originalRuntime);
    assert.equal(originalDisposed, false);

    await supervisor.rebindSession(created.ref);

    const reboundRecord = [...records.values()].find((record) => record.ref.sessionId === created.ref.sessionId);
    assert.equal(reboundRecord?.title, "Hot reload session");
    assert.equal(reboundRecord?.session?.model?.baseUrl, endpointB);
    assert.equal(originalDisposed, true);
    assert.deepEqual(runtimeEndpoints, [endpointA, endpointB]);
    assert.equal((await supervisor.openSession(created.ref)).title, "Hot reload session");
    assert.equal(profileRefs.length, 3);
    await supervisor.closeSession(created.ref);
  });
});

test("runtime rebind rolls back when replacement extension binding fails", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    let runtimeCount = 0;
    let rejectedReplacementDisposed = false;
    const supervisor = new SessionSupervisor({
      agentDir: join(dir, "agent"),
      catalogFilePath: join(dir, "catalogs.json"),
      createAgentSessionRuntimeImpl: async (options) => {
        const runtime = await createAgentSessionRuntimeWithNpmFallback(options);
        runtimeCount += 1;
        if (runtimeCount === 2) {
          const dispose = runtime.dispose.bind(runtime);
          runtime.dispose = async () => {
            rejectedReplacementDisposed = true;
            await dispose();
          };
          runtime.session.bindExtensions = async () => {
            throw new Error("replacement bind failed");
          };
        }
        return runtime;
      },
    });
    const created = await supervisor.createSession(
      { workspaceId: "workspace-1", path: workspacePath },
      { title: "Rollback session" },
    );
    const records = (supervisor as unknown as {
      readonly records: Map<string, { runtime?: { dispose(): Promise<void> }; session?: unknown }>;
    }).records;
    const record = [...records.values()][0]!;
    const originalRuntime = record.runtime!;
    const originalSession = record.session;
    const dispose = originalRuntime.dispose.bind(originalRuntime);
    let originalDisposed = false;
    originalRuntime.dispose = async () => {
      originalDisposed = true;
      await dispose();
    };

    await assert.rejects(supervisor.rebindSession(created.ref), /replacement bind failed/);
    assert.equal(record.runtime, originalRuntime);
    assert.equal(record.session, originalSession);
    assert.equal(originalDisposed, false);
    assert.equal(rejectedReplacementDisposed, true);
    assert.equal((await supervisor.openSession(created.ref)).title, "Rollback session");
    await supervisor.closeSession(created.ref);
  });
});

test("close serializes ahead of a concurrent runtime rebind", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    let runtimeCount = 0;
    const supervisor = new SessionSupervisor({
      agentDir: join(dir, "agent"),
      catalogFilePath: join(dir, "catalogs.json"),
      createAgentSessionRuntimeImpl: async (options) => {
        runtimeCount += 1;
        return createAgentSessionRuntimeWithNpmFallback(options);
      },
    });
    const created = await supervisor.createSession(
      { workspaceId: "workspace-1", path: workspacePath },
      { title: "Close during rebind" },
    );
    const internals = supervisor as unknown as {
      readonly records: Map<
        string,
        {
          closed: boolean;
          runtime?: { dispose(): Promise<void> };
          runtimeOperationQueue: Promise<void>;
          session?: unknown;
        }
      >;
    };
    const record = [...internals.records.values()][0]!;
    const originalRuntime = record.runtime!;
    const originalDispose = originalRuntime.dispose.bind(originalRuntime);
    let disposeCount = 0;
    originalRuntime.dispose = async () => {
      disposeCount += 1;
      await originalDispose();
    };
    const queueGate = deferred();
    record.runtimeOperationQueue = queueGate.promise;

    const close = supervisor.closeSession(created.ref);
    const rebind = supervisor.rebindSession(created.ref);
    queueGate.resolve();
    await Promise.all([close, rebind]);

    assert.equal(runtimeCount, 1, "rebind queued behind close must not create a replacement runtime");
    assert.equal(disposeCount, 1);
    assert.equal(record.closed, true);
    assert.equal(record.runtime, undefined);
    assert.equal(record.session, undefined);
    await supervisor.rebindSession(created.ref);
    assert.equal(runtimeCount, 1, "rebind must not reopen an already closed record");
  });
});

test("delete serializes ahead of a concurrent runtime rebind", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    let runtimeCount = 0;
    const supervisor = new SessionSupervisor({
      agentDir: join(dir, "agent"),
      catalogFilePath: join(dir, "catalogs.json"),
      createAgentSessionRuntimeImpl: async (options) => {
        runtimeCount += 1;
        return createAgentSessionRuntimeWithNpmFallback(options);
      },
    });
    const created = await supervisor.createSession(
      { workspaceId: "workspace-1", path: workspacePath },
      { title: "Delete during rebind" },
    );
    const internals = supervisor as unknown as {
      readonly records: Map<
        string,
        {
          runtime?: { dispose(): Promise<void> };
          runtimeOperationQueue: Promise<void>;
        }
      >;
    };
    const record = [...internals.records.values()][0]!;
    const originalRuntime = record.runtime!;
    const originalDispose = originalRuntime.dispose.bind(originalRuntime);
    let disposeCount = 0;
    originalRuntime.dispose = async () => {
      disposeCount += 1;
      await originalDispose();
    };
    const queueGate = deferred();
    record.runtimeOperationQueue = queueGate.promise;

    const deletion = supervisor.deleteSession(created.ref);
    const rebind = supervisor.rebindSession(created.ref);
    queueGate.resolve();
    await Promise.all([deletion, rebind]);

    assert.equal(runtimeCount, 1, "rebind queued behind delete must not create a replacement runtime");
    assert.equal(disposeCount, 1);
    assert.equal(internals.records.size, 0);
    assert.equal((await supervisor.listSessions(created.ref.workspaceId)).sessions.length, 0);
  });
});

test("flush and delete serialize without resurrecting a deleted session", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    const catalogFilePath = join(dir, "catalogs.json");
    const supervisor = new SessionSupervisor({
      agentDir: join(dir, "agent"),
      catalogFilePath,
    });
    const workspace = { workspaceId: "workspace-1", path: workspacePath };
    const created = await supervisor.createSession(workspace, { title: "Flush race" });
    const internals = supervisor as unknown as {
      persistSnapshot(record: unknown): Promise<void>;
    };
    const persistEntered = deferred();
    const persistRelease = deferred();
    const originalPersist = internals.persistSnapshot.bind(supervisor);
    let blockNextPersist = true;
    internals.persistSnapshot = async (record) => {
      if (blockNextPersist) {
        blockNextPersist = false;
        persistEntered.resolve();
        await persistRelease.promise;
      }
      await originalPersist(record);
    };

    const flush = supervisor.flushPersistence();
    await persistEntered.promise;
    const deletion = supervisor.deleteSession(created.ref);
    // Delete is queued behind the flush lifecycle barrier, not interleaved
    // between its presence check and catalog upsert.
    persistRelease.resolve();
    await Promise.all([flush, deletion]);

    const reopened = new JsonCatalogStore({ catalogFilePath });
    assert.equal((await reopened.sessions.listSessions(workspace.workspaceId)).sessions.length, 0);
    assert.equal(await reopened.getSessionFile(created.ref), undefined);
  });
});

test("runtime rebind waits for prompt submission but not for the full agent turn", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    let runtimeCount = 0;
    const supervisor = new SessionSupervisor({
      agentDir: join(dir, "agent"),
      catalogFilePath: join(dir, "catalogs.json"),
      createAgentSessionRuntimeImpl: async (options) => {
        runtimeCount += 1;
        return createAgentSessionRuntimeWithNpmFallback(options);
      },
    });
    const created = await supervisor.createSession(
      { workspaceId: "workspace-1", path: workspacePath },
      { title: "Serialized session" },
    );
    const internals = supervisor as unknown as {
      readonly records: Map<string, {
        runtime?: { dispose(): Promise<void> };
        session?: { prompt(text: string, options?: unknown): Promise<void> };
      }>;
      persistSnapshot(record: unknown): Promise<void>;
      handleAgentEvent(record: unknown, expectedSession: unknown, event: unknown): Promise<void>;
    };
    const record = [...internals.records.values()][0]!;
    const session = record.session!;
    const runtime = record.runtime!;
    const persistEntered = deferred();
    const persistRelease = deferred();
    const promptEntered = deferred();
    const promptCompletion = deferred();
    const originalPersist = internals.persistSnapshot.bind(supervisor);
    let blockNextPersist = true;
    internals.persistSnapshot = async (target) => {
      if (blockNextPersist) {
        blockNextPersist = false;
        persistEntered.resolve();
        await persistRelease.promise;
      }
      await originalPersist(target);
    };
    session.prompt = async () => {
      promptEntered.resolve();
      await promptCompletion.promise;
    };
    const originalDispose = runtime.dispose.bind(runtime);
    runtime.dispose = async () => {
      promptCompletion.reject(new Error("old prompt aborted by rebind"));
      await originalDispose();
    };

    const sendOutcome = supervisor.sendUserMessage(created.ref, { text: "Build a bracket" }).then(
      () => "resolved" as const,
      () => "rejected" as const,
    );
    await persistEntered.promise;
    const rebind = supervisor.rebindSession(created.ref);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(runtimeCount, 1, "rebind must wait while prompt submission is inside its critical section");

    persistRelease.resolve();
    await promptEntered.promise;
    await waitFor(() => runtimeCount === 2, "rebind did not start after prompt submission completed");
    await rebind;
    assert.equal(await sendOutcome, "rejected");
    assert.equal((await supervisor.openSession(created.ref)).status, "idle");
    await internals.handleAgentEvent(record, session, { type: "agent_start" });
    assert.equal((await supervisor.openSession(created.ref)).status, "idle", "stale old-session events must be ignored");
    await supervisor.closeSession(created.ref);
  });
});
