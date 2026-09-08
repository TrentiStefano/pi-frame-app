import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CustomProviderStore } from "../dist/custom-provider-store.js";

async function withStore(run: (store: CustomProviderStore, path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-model-store-"));
  const path = join(dir, "models.json");
  try {
    await run(new CustomProviderStore(path), path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("upserts one custom model without replacing sibling models or unknown fields", async () => {
  await withStore(async (store, path) => {
    await writeFile(path, JSON.stringify({
      revision: 4,
      providers: {
        "local-api": {
          baseUrl: "http://localhost:8000/v1",
          api: "openai-completions",
          apiKey: "existing-key",
          vendorOption: true,
          models: [
            { id: "keep-me", contextWindow: 8192, vendorModelOption: "keep" },
            { id: "edit-me", contextWindow: 4096, vendorModelOption: "also-keep" },
          ],
        },
        external: { baseUrl: "https://example.test/v1", models: [{ id: "untouched" }] },
      },
    }));

    await store.upsertModel({
      providerId: "local-api",
      baseUrl: "http://localhost:9000/v1",
      model: { id: "edit-me", contextWindow: 16384 },
    });

    const saved = JSON.parse(await readFile(path, "utf8"));
    assert.equal(saved.revision, 4);
    assert.equal(saved.providers["local-api"].vendorOption, true);
    assert.equal(saved.providers["local-api"].apiKey, "existing-key");
    assert.deepEqual(saved.providers["local-api"].models, [
      { id: "keep-me", contextWindow: 8192, vendorModelOption: "keep" },
      { id: "edit-me", contextWindow: 16384, vendorModelOption: "also-keep" },
    ]);
    assert.deepEqual(saved.providers.external, { baseUrl: "https://example.test/v1", models: [{ id: "untouched" }] });
  });
});

test("deletes only the selected model and removes an empty managed provider", async () => {
  await withStore(async (store, path) => {
    await store.upsertModel({ providerId: "local-api", baseUrl: "http://localhost:8000/v1", model: { id: "one" } });
    await store.upsertModel({ providerId: "local-api", baseUrl: "http://localhost:8000/v1", model: { id: "two" } });

    assert.deepEqual(await store.deleteModel("local-api", "one"), { providerDeleted: false });
    let saved = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(saved.providers["local-api"].models.map((model: { id: string }) => model.id), ["two"]);

    assert.deepEqual(await store.deleteModel("local-api", "two"), { providerDeleted: true });
    saved = JSON.parse(await readFile(path, "utf8"));
    assert.equal(saved.providers["local-api"], undefined);
  });
});

test("removes only app-managed built-in model entries", async () => {
  await withStore(async (store, path) => {
    await writeFile(path, JSON.stringify({
      providers: { openai: { models: [{ id: "external-model", vendor: true }] } },
    }));
    await store.upsertBuiltInModel("openai", { id: "desktop-model" });
    assert.equal(await store.deleteBuiltInModel("openai", "desktop-model"), true);

    const saved = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(saved.providers.openai.models, [{ id: "external-model", vendor: true }]);
  });
});
