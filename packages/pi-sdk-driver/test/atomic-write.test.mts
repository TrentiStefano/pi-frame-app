import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../dist/atomic-write.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-atomic-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("writes new content and creates missing directories", async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, "nested", "catalog.json");
    await writeFileAtomic(target, "hello");
    assert.equal(await readFile(target, "utf8"), "hello");
  });
});

test("leaves only the target file behind, no lingering temp files", async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, "catalog.json");
    await writeFileAtomic(target, "one");
    await writeFileAtomic(target, "two");
    const entries = await readdir(dir);
    assert.deepEqual(entries, ["catalog.json"]);
    assert.equal(await readFile(target, "utf8"), "two");
  });
});

test("repeated replacement writes stay readable on Windows", { skip: process.platform !== "win32" }, async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, "catalog.json");
    await writeFileAtomic(target, "initial");
    for (let i = 0; i < 100; i += 1) {
      await writeFileAtomic(target, `replacement-${i}`);
      assert.equal(await readFile(target, "utf8"), `replacement-${i}`);
    }
    assert.deepEqual(await readdir(dir), ["catalog.json"]);
  });
});

test("concurrent writes to one path are serialized with the latest call winning", async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, "catalog.json");
    const payloads = Array.from({ length: 40 }, (_, i) => `payload-${i}-${"x".repeat(i * 32)}`);

    await Promise.all(payloads.map((payload) => writeFileAtomic(target, payload)));

    const finalContent = await readFile(target, "utf8");
    assert.equal(finalContent, payloads.at(-1));

    // Collision-safe temp names mean no *.tmp survivors from the racing writers.
    const entries = await readdir(dir);
    assert.deepEqual(entries, ["catalog.json"]);
  });
});
