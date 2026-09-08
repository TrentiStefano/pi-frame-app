import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { desktopShortcut, getDesktopState, launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir } from "../helpers/electron-app";

test("migrates explicit global, project, default, and custom models into one global configuration", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("model-configuration-migration-workspace");
  await seedAgentDir(agentDir, { enabledModels: ["openai/gpt-5"] });
  const projectPiDir = join(workspacePath, ".pi");
  await mkdir(projectPiDir, { recursive: true });
  const projectSettings = {
    defaultProvider: "openai",
    defaultModel: "gpt-4-turbo",
    enabledModels: ["openai/gpt-4-turbo"],
  };
  await writeFile(join(projectPiDir, "settings.json"), `${JSON.stringify(projectSettings, null, 2)}\n`);
  await writeFile(join(agentDir, "models.json"), `${JSON.stringify({
    providers: {
      "local-api": {
        baseUrl: "http://localhost:8000/v1",
        api: "openai-completions",
        apiKey: "unused",
        piGuiCustomEndpoint: true,
        models: [{ id: "local-model" }],
      },
    },
  }, null, 2)}\n`);

  const harness = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    const window = await harness.firstWindow();
    await expect.poll(async () => (await getDesktopState(window)).modelSettingsScopeMode).toBe("app-global");
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "Models", exact: true }).click();
    await expect(window.locator(".surface-toolbar__field")).toHaveCount(0);
    await expect(window.locator(".settings-model-row", { hasText: "openai/gpt-5" })).toBeVisible();
    await expect(window.locator(".settings-model-row", { hasText: "openai/gpt-4-turbo" })).toBeVisible();
    await expect(window.locator(".settings-model-row", { hasText: "local-api/local-model" })).toBeVisible();

    const globalSettings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
    expect(globalSettings.enabledModels).toEqual(["openai/gpt-5", "openai/gpt-4-turbo", "local-api/local-model"]);
    expect(JSON.parse(await readFile(join(projectPiDir, "settings.json"), "utf8"))).toEqual(projectSettings);
  } finally {
    await harness.close();
  }
});

test("uses the configured default model when enabledModels is absent or empty", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("model-default-fallback-workspace");
  await seedAgentDir(agentDir, { enabledModels: [] });
  await writeFile(
    join(userDataDir, "ui-state.json"),
    `${JSON.stringify({ version: 19, appLanguage: "en", themeMode: "dark" })}\n`,
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "Models", exact: true }).click();
    const modelRow = window.locator(".settings-model-row", { hasText: "openai/gpt-5" });
    await expect(modelRow).toBeVisible();
    await expect(modelRow.locator(".settings-status--ready")).toBeVisible();
    const state = await getDesktopState(window);
    const runtime = state.runtimeByWorkspace[state.selectedWorkspaceId];
    expect(runtime?.settings.enabledModelPatterns).toContain("openai/gpt-5");
  } finally {
    await harness.close();
  }
});
