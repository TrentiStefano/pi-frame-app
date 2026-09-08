import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopAppStore } from "./app-store";

test("DesktopAppStore constructor shares its catalog owner with driver and worktree manager", async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-app-store-"));
  try {
    let factoryOptions: any;
    const store = new DesktopAppStore({
      userDataDir,
      initialWorkspacePaths: [],
      driverFactory: (options) => {
        factoryOptions = options;
        return { flushPersistence: async () => {} } as any;
      },
    });
    assert.ok(factoryOptions, "constructor must invoke the optional driver factory");
    assert.strictEqual(factoryOptions.catalogStorage, store.catalogStore);
    assert.strictEqual((store.worktreeManager as any).options.catalogStorage, store.catalogStore);
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("DesktopAppStore.flushPersistence waits for driver before UI-state persistence", async () => {
  const order: string[] = [];
  let releaseDriver!: () => void;
  const driverFlush = new Promise<void>((resolve) => { releaseDriver = resolve; });
  const store = Object.create(DesktopAppStore.prototype) as any;
  store.initialize = async () => {};
  store.driver = { flushPersistence: async () => { await driverFlush; order.push("driver"); } };
  store.persistUiState = async () => { order.push("ui"); };
  const flushing = store.flushPersistence();
  await Promise.resolve();
  assert.deepEqual(order, [], "UI state must not persist while driver flush is pending");
  releaseDriver();
  await flushing;
  assert.deepEqual(order, ["driver", "ui"]);
  await store.flushPersistence();
  assert.deepEqual(order, ["driver", "ui", "driver", "ui"]);
});
