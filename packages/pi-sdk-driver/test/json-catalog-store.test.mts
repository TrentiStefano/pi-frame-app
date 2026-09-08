import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonCatalogStore, type JsonCatalogStoreWriter } from "../dist/json-catalog-store.js";
import type { SessionCatalogEntry, WorktreeCatalogEntry, WorkspaceCatalogEntry } from "@pi-frame/catalogs";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-catalog-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const workspace: WorkspaceCatalogEntry = {
  workspaceId: "workspace",
  path: "/workspaces/main",
  displayName: "Main",
  lastOpenedAt: "2026-08-26T00:00:00.000Z",
  pinned: false,
  sortOrder: 0,
};

const worktree: WorktreeCatalogEntry = {
  worktreeId: "worktree",
  workspaceId: "workspace",
  path: "/workspaces/linked",
  displayName: "Linked",
  kind: "linked",
  status: "ready",
  pinned: false,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

const entry: SessionCatalogEntry = {
  sessionRef: { workspaceId: "workspace", sessionId: "session" },
  workspaceId: "workspace",
  title: "Test session",
  updatedAt: "2026-08-26T00:00:00.000Z",
  status: "idle",
  sessionFilePath: "/sessions/session.jsonl",
};

test("legacy catalog unknown fields are projected away without touching source bytes until write", async () => {
  await withTempDir(async (dir) => {
    const catalogFilePath = join(dir, "catalog.json");
    const legacy = JSON.stringify({ version: 2, workspaces: [workspace], worktrees: [], sessionFiles: {}, sessions: [{ ...entry, legacyMarker: "ignored" }] }, null, 2) + "\n";
    await writeFile(catalogFilePath, legacy, "utf8");
    const store = new JsonCatalogStore({ catalogFilePath });
    const loaded = await store.sessions.getSession(entry.sessionRef);
    assert.equal((loaded as Record<string, unknown>).legacyMarker, undefined);
    assert.equal(loaded?.sessionFilePath, entry.sessionFilePath);
    assert.equal((await store.sessions.listSessions("workspace")).sessions.length, 1);
    assert.equal(await store.getSessionFile(entry.sessionRef), undefined);
    assert.equal(await readFile(catalogFilePath, "utf8"), legacy);
    await store.sessions.upsertSession(loaded!);
    const persisted = JSON.parse(await readFile(catalogFilePath, "utf8"));
    assert.equal(persisted.sessions[0].legacyMarker, undefined);
  });
});

test("upsertSession without sessionFilePath preserves an existing legacy mapping", async () => {
  await withTempDir(async (dir) => {
    const catalogFilePath = join(dir, "catalog.json");
    const store = new JsonCatalogStore({ catalogFilePath });
    await store.setSessionFile(entry.sessionRef, entry.sessionFilePath!);
    await store.sessions.upsertSession({ ...entry, sessionFilePath: undefined });

    const reopened = new JsonCatalogStore({ catalogFilePath });
    assert.equal(await reopened.getSessionFile(entry.sessionRef), entry.sessionFilePath);
    assert.equal((await reopened.sessions.getSession(entry.sessionRef))?.sessionFilePath, undefined);
  });
});

test("set and delete session path synchronize both representations without losing fields", async () => {
  await withTempDir(async (dir) => {
    const catalogFilePath = join(dir, "catalog.json");
    const store = new JsonCatalogStore({ catalogFilePath });
    await store.sessions.upsertSession(entry);
    await store.setSessionFile(entry.sessionRef, "/sessions/replaced.jsonl");

    const replaced = await store.sessions.getSession(entry.sessionRef);
    assert.equal(replaced?.sessionFilePath, "/sessions/replaced.jsonl");
    assert.equal(replaced?.title, entry.title);
    assert.equal(replaced?.status, entry.status);
    assert.equal(await store.getSessionFile(entry.sessionRef), "/sessions/replaced.jsonl");

    await store.deleteSessionFile(entry.sessionRef);
    const deleted = await store.sessions.getSession(entry.sessionRef);
    assert.equal(deleted?.sessionFilePath, undefined);
    assert.equal(await store.getSessionFile(entry.sessionRef), undefined);

    const reopened = new JsonCatalogStore({ catalogFilePath });
    const reopenedEntry = await reopened.sessions.getSession(entry.sessionRef);
    assert.equal(reopenedEntry?.sessionFilePath, undefined);
    assert.equal(reopenedEntry?.title, entry.title);
    assert.equal(reopenedEntry?.status, entry.status);
    assert.equal(await reopened.getSessionFile(entry.sessionRef), undefined);
  });
});

test("changed session path updates the entry and legacy mapping after fresh reopen", async () => {
  await withTempDir(async (dir) => {
    const catalogFilePath = join(dir, "catalog.json");
    const store = new JsonCatalogStore({ catalogFilePath });
    const changedPath = "/sessions/changed.jsonl";
    await store.sessions.upsertSession(entry);
    await store.sessions.upsertSession({ ...entry, sessionFilePath: changedPath });

    const reopened = new JsonCatalogStore({ catalogFilePath });
    assert.equal((await reopened.sessions.getSession(entry.sessionRef))?.sessionFilePath, changedPath);
    assert.equal(await reopened.getSessionFile(entry.sessionRef), changedPath);
  });
});

test("session upsert writes entry and legacy path in one physical write", async () => {
  await withTempDir(async (dir) => {
    let writes = 0;
    const writer: JsonCatalogStoreWriter = async (filePath, value) => {
      writes += 1;
      const { writeJsonFileAtomic } = await import("../dist/atomic-write.js");
      await writeJsonFileAtomic(filePath, value);
    };
    const store = new JsonCatalogStore({ catalogFilePath: join(dir, "catalog.json"), writer });
    await store.sessions.upsertSession(entry);
    assert.equal(writes, 1);

    const reopened = new JsonCatalogStore({ catalogFilePath: join(dir, "catalog.json") });
    assert.deepEqual((await reopened.sessions.getSession(entry.sessionRef))?.sessionFilePath, entry.sessionFilePath);
    assert.equal(await reopened.getSessionFile(entry.sessionRef), entry.sessionFilePath);
  });
});

test("shared catalog preserves session and worktree mutations in either order and overlap", async () => {
  for (const order of ["session-first", "worktree-first"] as const) {
    await withTempDir(async (dir) => {
      const catalogFilePath = join(dir, `${order}.json`);
      const store = new JsonCatalogStore({ catalogFilePath });
      const sessionMutation = async () => store.sessions.upsertSession(entry);
      const worktreeMutation = async () => store.worktrees.upsertWorktree(worktree);
      await store.workspaces.upsertWorkspace(workspace);
      if (order === "session-first") {
        await sessionMutation();
        await worktreeMutation();
      } else {
        await worktreeMutation();
        await sessionMutation();
      }
      await Promise.all([sessionMutation(), worktreeMutation()]);

      const reopened = new JsonCatalogStore({ catalogFilePath });
      assert.ok(await reopened.sessions.getSession(entry.sessionRef));
      assert.ok(await reopened.worktrees.getWorktree(worktree.worktreeId));
    });
  }
});

test("blocked catalog writers receive immutable mutation-time snapshots", async () => {
  await withTempDir(async (dir) => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const seen: unknown[] = [];
    const store = new JsonCatalogStore({
      catalogFilePath: join(dir, "catalog.json"),
      writer: async (filePath, value) => {
        seen.push(JSON.parse(JSON.stringify(value)));
        if (seen.length === 1) {
          entered();
          await gate;
        }
        const { writeJsonFileAtomic } = await import("../dist/atomic-write.js");
        await writeJsonFileAtomic(filePath, value);
      },
    });
    const first = store.sessions.upsertSession(entry);
    await started;
    const secondEntry = { ...entry, title: "Newest session", status: "running" as const };
    const second = store.sessions.upsertSession(secondEntry);
    release();
    await Promise.all([first, second]);
    assert.equal((seen[0] as any).sessions[0].title, entry.title);
    assert.equal((seen[0] as any).sessions[0].status, entry.status);
    assert.equal((seen[1] as any).sessions[0].title, secondEntry.title);
    const reopened = new JsonCatalogStore({ catalogFilePath: join(dir, "catalog.json") });
    assert.equal((await reopened.sessions.getSession(entry.sessionRef))?.title, secondEntry.title);
    assert.equal((await reopened.sessions.getSession(entry.sessionRef))?.status, secondEntry.status);
  });
});

test("a failed catalog write retries identical data through the physical writer and fresh reopen sees it", async () => {
  await withTempDir(async (dir) => {
    let writes = 0;
    let fail = true;
    const writer: JsonCatalogStoreWriter = async (filePath, value) => {
      writes += 1;
      if (fail) {
        fail = false;
        throw new Error("injected catalog write failure");
      }
      const { writeJsonFileAtomic } = await import("../dist/atomic-write.js");
      await writeJsonFileAtomic(filePath, value);
    };
    const store = new JsonCatalogStore({ catalogFilePath: join(dir, "catalog.json"), writer });
    await assert.rejects(store.sessions.upsertSession(entry), /injected catalog write failure/);
    await store.sessions.upsertSession(entry);
    assert.equal(writes, 2, "identical retry must invoke the physical writer again");

    const reopened = new JsonCatalogStore({ catalogFilePath: join(dir, "catalog.json") });
    assert.ok(await reopened.sessions.getSession(entry.sessionRef));
    assert.equal(await reopened.getSessionFile(entry.sessionRef), entry.sessionFilePath);
  });
});
