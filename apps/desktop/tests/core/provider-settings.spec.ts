import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { desktopShortcut, launchDesktop, makeUserDataDir, makeWorkspace, openNewThread, seedAgentDir } from "../helpers/electron-app";

test("configures a custom model without a workspace", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false, enabledModels: [] });
  const harness = await launchDesktop(userDataDir, { agentDir, scrubProviderEnv: true, testMode: "background" });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    const settings = window.getByTestId("settings-surface");
    await settings.getByRole("button", { name: "Models", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Models");
    await expect(settings.getByRole("button", { name: "Providers", exact: true })).toHaveCount(0);
    await expect(settings).toContainText("No models configured");

    await settings.getByRole("button", { name: "Add model" }).click();
    const dialog = window.getByTestId("model-configuration-dialog");
    await dialog.getByLabel("Provider ID").fill("openai-local");
    await dialog.getByLabel("Base URL").fill("http://127.0.0.1:12345/v1");
    await dialog.getByLabel("Model ID").fill("test-model");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const row = settings.locator(".settings-model-row", { hasText: "openai-local/test-model" });
    await expect(row).toBeVisible();
    await expect(settings.getByLabel("Default model")).toHaveValue("openai-local/test-model");

    const config = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
    expect(config.enabledModels).toContain("openai-local/test-model");
  } finally {
    await harness.close();
  }
});

test("shows configured models with external credentials as ready", async () => {
  test.setTimeout(60_000);
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-env-key";
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("model-settings-env-workspace");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, enabledModels: ["openai/gpt-5"] });
  const harness = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [workspacePath], testMode: "background" });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "Models", exact: true }).click();
    const row = window.locator(".settings-model-row", { hasText: "openai/gpt-5" });
    await expect(row).toContainText("Ready");
    await expect(window.locator(".surface-toolbar__field")).toHaveCount(0);
  } finally {
    await harness.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("keeps a configured model visible when its key is missing but excludes it from pickers", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("model-settings-missing-key-workspace");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false, enabledModels: ["openai/gpt-5"] });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);
    await expect(window.locator(".new-thread__hint .model-selector__badge").first()).toHaveText("No models available");
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "Models", exact: true }).click();
    await expect(window.locator(".settings-model-row", { hasText: "openai/gpt-5" })).toContainText("API key required");
  } finally {
    await harness.close();
  }
});

test("keeps the merged model settings readable in narrow Chinese dark mode", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("model-settings-narrow-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5", "openai/gpt-4o"] });
  const harness = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [workspacePath], testMode: "background" });

  try {
    const window = await harness.firstWindow();
    await window.setViewportSize({ width: 760, height: 720 });
    await window.evaluate(async () => {
      const app = window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.setAppLanguage("zh-CN");
      await app.setThemeMode("dark");
    });
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "模型", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("模型");
    await expect(window.getByText("已配置的模型", { exact: true })).toBeVisible();
    await expect.poll(() => window.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    expect(await window.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect((await window.screenshot()).byteLength).toBeGreaterThan(10_000);
  } finally {
    await harness.close();
  }
});
