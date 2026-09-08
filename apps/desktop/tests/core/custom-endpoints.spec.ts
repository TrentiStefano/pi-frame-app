import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { desktopShortcut, launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir } from "../helpers/electron-app";

test("adds, edits, shares, and deletes models for an OpenAI-compatible endpoint", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("custom-model-settings-workspace");
  await seedAgentDir(agentDir, { enabledModels: [] });
  const harness = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [workspacePath], testMode: "background" });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "Models", exact: true }).click();

    await window.getByRole("button", { name: "Add model" }).click();
    let dialog = window.getByTestId("model-configuration-dialog");
    await expect(dialog.locator('optgroup[label="Built-in providers"]')).toHaveCount(0);
    await dialog.getByLabel("Provider", { exact: true }).selectOption("new-custom");
    await dialog.getByLabel("Provider ID").fill("local-api");
    await dialog.getByLabel("Base URL").fill("http://localhost:8000/v1");
    await dialog.getByLabel("Model ID").fill("local-model-a");
    await dialog.getByLabel("API key").fill("shared-key");
    await dialog.getByLabel("Display name").fill("Local Model A");
    await dialog.getByLabel("Supports reasoning").check();
    await dialog.getByLabel("Supports image input").check();
    await dialog.getByLabel("Context window (tokens)").fill("131072");
    await dialog.getByLabel("Max output tokens").fill("32768");
    await dialog.getByLabel("Input", { exact: true }).fill("0.5");
    await dialog.getByLabel("Output", { exact: true }).fill("1.5");
    await dialog.getByLabel("Cache read").fill("0.1");
    await dialog.getByLabel("Cache write").fill("0.2");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(window.getByRole("button", { name: "Low", exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "Extra High", exact: true })).toHaveCount(0);

    let row = window.locator(".settings-model-row", { hasText: "local-api/local-model-a" });
    await expect(row).toContainText("http://localhost:8000/v1");
    await row.getByRole("button", { name: "Edit Local Model A" }).click();
    dialog = window.getByTestId("model-configuration-dialog");
    await expect(dialog.getByLabel("Provider", { exact: true })).toBeDisabled();
    await expect(dialog.getByLabel("Model ID")).toBeDisabled();
    await expect(dialog.getByLabel("Display name")).toHaveValue("Local Model A");
    await expect(dialog.getByLabel("Supports reasoning")).toBeChecked();
    await expect(dialog.getByLabel("Context window (tokens)")).toHaveValue("131072");
    await dialog.getByLabel("Base URL").fill("http://localhost:9000/v1");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toContainText("http://localhost:9000/v1");

    await window.getByRole("button", { name: "Add model" }).click();
    dialog = window.getByTestId("model-configuration-dialog");
    await dialog.getByLabel("Provider", { exact: true }).selectOption("custom:local-api");
    await dialog.getByLabel("Model ID").fill("local-model-b");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(window.locator(".settings-model-row", { hasText: "local-api/local-model-b" })).toBeVisible();

    const saved = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8"));
    expect(saved.providers["local-api"]).toMatchObject({
      baseUrl: "http://localhost:9000/v1",
      apiKey: "shared-key",
    });
    expect(saved.providers["local-api"].models[0]).toMatchObject({
      id: "local-model-a",
      name: "Local Model A",
      reasoning: true,
      thinkingLevelMap: { off: "off", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null },
      input: ["text", "image"],
      contextWindow: 131072,
      maxTokens: 32768,
      cost: { input: 0.5, output: 1.5, cacheRead: 0.1, cacheWrite: 0.2 },
    });
    expect(saved.providers["local-api"].models.map((model: { id: string }) => model.id)).toEqual(["local-model-a", "local-model-b"]);

    row = window.locator(".settings-model-row", { hasText: "local-api/local-model-a" });
    await row.getByRole("button", { name: "Delete Local Model A" }).click();
    await window.getByTestId("delete-model-dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")).providers["local-api"].models).toHaveLength(1);

    const lastRow = window.locator(".settings-model-row", { hasText: "local-api/local-model-b" });
    await lastRow.getByRole("button", { name: "Delete local-model-b" }).click();
    await window.getByTestId("delete-model-dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(lastRow).toHaveCount(0);
    expect(JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")).providers["local-api"]).toBeUndefined();

    await window.getByRole("button", { name: "Add model" }).click();
    dialog = window.getByTestId("model-configuration-dialog");
    await dialog.getByLabel("Provider", { exact: true }).selectOption("new-custom");
    await dialog.getByLabel("Provider ID").fill("claude-proxy");
    await dialog.getByLabel("API protocol").selectOption("anthropic-messages");
    await dialog.getByLabel("Base URL").fill("https://claude-proxy.example/v1");
    await dialog.getByLabel("Model ID").fill("claude-sonnet-custom");
    await dialog.getByLabel("API key").fill("claude-key");
    await expect(dialog.getByRole("button", { name: "Detect models" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")).providers["claude-proxy"]).toMatchObject({
      api: "anthropic-messages",
      baseUrl: "https://claude-proxy.example/v1",
      models: [{ id: "claude-sonnet-custom" }],
    });
  } finally {
    await harness.close();
  }
});
