import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  desktopShortcut,
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  pasteTinyPng,
  seedAgentDir,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("new thread reuses composer behaviors for slash commands, image previews, and branding", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-composer-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const composer = window.getByTestId("new-thread-composer");
    const brandLogo = window.getByTestId("new-thread-logo");
    await expect(brandLogo).toBeVisible();
    await expect.poll(() => brandLogo.locator("img").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(brandLogo.locator("svg")).toHaveCount(0);
    await expect(window.getByRole("heading", { name: "Let's build" })).toBeVisible();
    await expect(composer).toBeFocused();
    await expect(composer).toHaveAttribute("placeholder", "Ask pi anything, use / for commands and skills");

    const modelBadge = window.locator(".new-thread__hint .model-selector__badge").first();
    await expect(modelBadge).toBeVisible();
    await expect(window.locator(".new-thread__hint button")).toHaveCount(4);
    const environmentPicker = window.getByTestId("new-thread-environment-picker");
    await expect(environmentPicker).toContainText("Local");
    await environmentPicker.click();
    const environmentMenu = window.locator(".new-thread__environment-picker [role='menu']");
    await expect(environmentMenu).toBeVisible();
    await environmentMenu.getByRole("menuitemradio", { name: /Worktree/ }).click();
    await expect(environmentPicker).toContainText("Worktree");
    await environmentPicker.click();
    await environmentMenu.getByRole("menuitemradio", { name: /Local/ }).click();
    await expect(environmentPicker).toContainText("Local");
    await expect(window.locator('.new-thread input[type="file"]')).toBeHidden();

    await composer.fill("/stat");
    const slashMenu = window.getByTestId("slash-menu");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("Status");
    await composer.press("Tab");
    await expect(slashMenu).toHaveCount(0);
    await expect(composer).toHaveValue("/status");

    await composer.fill("Outline next steps /stat");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("Status");
    await composer.press("Tab");
    await expect(slashMenu).toHaveCount(0);
    await expect(composer).toHaveValue("Outline next steps /status");

    await composer.fill("");
    await pasteTinyPng(window, "new-thread-image.png", "new-thread-composer");
    const chip = window.locator(".composer-attachment");
    await expect(chip).toBeVisible();
    await expect(chip.locator(".composer-attachment__preview")).toBeVisible();
    await expect(chip.locator(".composer-attachment__name")).toContainText("new-thread-image.png");

    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => {
        const transcript = await getSelectedTranscript(window);
        const userMessage = transcript?.transcript.find(
          (entry) => entry.kind === "message" && "role" in entry && entry.role === "user",
        );
        return userMessage?.attachments?.map((attachment) => attachment.kind).join(",") ?? "";
      }, { timeout: 15_000 })
      .toBe("image");
    await expect(window.locator(".timeline-item__attachment")).toBeVisible({ timeout: 15_000 });
    await expect(window.locator(".composer-attachment")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("starts only one thread when Enter is pressed twice", async () => {
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-double-enter");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);
    const before = await getDesktopState(window);
    const composer = window.getByTestId("new-thread-composer");
    await composer.fill("create exactly one thread");

    await composer.press("Enter");
    await composer.press("Enter");

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => {
      const state = await getDesktopState(window);
      return state.workspaces.reduce((count, workspace) => count + workspace.sessions.length, 0);
    }).toBe(before.workspaces.reduce((count, workspace) => count + workspace.sessions.length, 0) + 1);
  } finally {
    await harness.close();
  }
});

test("new thread project picker switches projects with desktop menu keyboard behavior", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePathA = await makeWorkspace("new-thread-project-alpha");
  const workspacePathB = await makeWorkspace("new-thread-project-beta");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePathA, workspacePathB],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const workspaceA = await waitForWorkspaceByPath(window, workspacePathA);
    const workspaceB = await waitForWorkspaceByPath(window, workspacePathB);
    await openNewThread(window);

    const trigger = window.getByTestId("new-thread-workspace-picker");
    const currentId = await trigger.getAttribute("data-workspace-id");
    const currentWorkspace = [workspaceA, workspaceB].find((workspace) => workspace.id === currentId);
    if (!currentWorkspace) {
      throw new Error(`Unexpected selected project: ${currentId ?? "none"}`);
    }
    const nextWorkspace = currentWorkspace.id === workspaceA.id ? workspaceB : workspaceA;
    await expect(trigger).toContainText(currentWorkspace.name);

    await trigger.click();
    const menu = window.getByRole("menu", { name: "Choose a project" });
    const selectedOption = menu.getByRole("menuitemradio", { name: currentWorkspace.name, exact: true });
    await expect(menu).toBeVisible();
    await expect(selectedOption).toHaveAttribute("aria-checked", "true");
    await expect(selectedOption).toBeFocused();

    const navigationKey = currentWorkspace.id === workspaceA.id ? "ArrowDown" : "ArrowUp";
    await selectedOption.press(navigationKey);
    const nextOption = menu.getByRole("menuitemradio", { name: nextWorkspace.name, exact: true });
    await expect(nextOption).toBeFocused();
    await nextOption.press("Enter");

    await expect(menu).toHaveCount(0);
    await expect(trigger).toHaveAttribute("data-workspace-id", nextWorkspace.id);
    await expect(trigger).toContainText(nextWorkspace.name);
    await expect(trigger).toBeFocused();

    await trigger.press("ArrowDown");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: nextWorkspace.name, exact: true })).toBeFocused();
    await window.keyboard.press("Tab");
    await expect(menu).toHaveCount(0);
    await expect(window.getByTestId("new-thread-environment-picker")).toBeFocused();

    await trigger.focus();
    await trigger.press("ArrowUp");
    await expect(menu).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    await harness.close();
  }
});

test("new thread hides the onboarding notice after picking a thread model", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-no-default-workspace");
  await seedAgentDir(agentDir, { withDefaultModel: false });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.evaluate(async () => {
      const app = window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.setModelConfigurationDefaults({ providerId: "", modelId: "" });
    });
    await openNewThread(window);

    const notice = window.getByTestId("model-onboarding-notice");
    const startButton = window.getByRole("button", { name: "Start thread" });
    const modelBadge = window.locator(".new-thread__hint .model-selector__badge").first();

    await window.getByTestId("new-thread-composer").fill("start a thread without a default");
    await expect(notice).toContainText("No default model set");
    await expect(modelBadge).toHaveText("Pick a model");
    await expect(startButton).toBeDisabled();

    await modelBadge.click();
    const dropdown = window.locator(".new-thread__hint .model-selector__dropdown").first();
    await expect(dropdown).toContainText("GPT-5");
    await expect(dropdown).toContainText("GPT-4o");
    const modelFilter = dropdown.locator(".model-selector__filter-input");
    await expect(modelFilter).toBeFocused();
    await modelFilter.fill("definitely-no-model");
    await expect(dropdown).toContainText("No matching models");
    await expect(modelBadge).toHaveText("Pick a model");
    await modelFilter.fill("4o");
    await expect(dropdown).toContainText("GPT-4o");
    await expect(dropdown).not.toContainText("GPT-5");
    await dropdown.getByRole("menuitemradio", { name: /GPT-4o/ }).click();

    await expect(modelBadge).toHaveText("openai:gpt-4o");
    await expect(startButton).toBeEnabled();
    await expect(notice).toHaveCount(0);

    await startButton.click();

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId("model-onboarding-notice")).toHaveCount(0);

    const composer = window.getByTestId("composer");
    await composer.fill("continue");
    await expect(window.getByTestId("send")).toBeEnabled();
  } finally {
    await harness.close();
  }
});

test("new thread routes disabled-model recovery to settings models", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-empty-models-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const selectedWorkspaceId = (await getDesktopState(window)).selectedWorkspaceId;
    expect(selectedWorkspaceId).toBeTruthy();

    await window.evaluate(async ({ workspaceId }) => {
      const app = window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      await app.setScopedModelPatterns(workspaceId, ["fake-provider/fake-model"]);
    }, { workspaceId: selectedWorkspaceId });

    await window.getByTestId("new-thread-composer").fill("try to start with all models disabled");
    const modelBadge = window.locator(".new-thread__hint .model-selector__badge").first();
    await expect(modelBadge).toBeVisible();
    await expect(modelBadge).toHaveText("No models available");
    await expect(window.getByTestId("model-onboarding-notice")).toContainText("Settings > Models");
    await expect(window.getByRole("button", { name: "Start thread" })).toBeDisabled();

    await modelBadge.click();
    const dropdown = window.locator(".new-thread__hint .model-selector__dropdown").first();
    await expect(dropdown).toBeVisible();
    await expect(dropdown).toContainText("No models available");
    await expect(dropdown).not.toContainText("Open Settings > Models");

    await window.getByTestId("model-onboarding-notice").getByRole("button", { name: "Open Settings > Models" }).click();
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await expect(window.locator(".view-header__title")).toHaveText("Models");
  } finally {
    await harness.close();
  }
});

test("refreshing provider auth does not add the provider's full model catalog", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-provider-connect-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["fake-provider/fake-model"],
  });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    scrubProviderEnv: true,
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const composer = window.getByTestId("new-thread-composer");
    const notice = window.getByTestId("model-onboarding-notice");
    const modelBadge = window.locator(".new-thread__hint .model-selector__badge").first();
    await composer.fill("connect provider");
    await expect(modelBadge).toHaveText("No models available");
    await expect(notice).toContainText("Settings > Models");

    await writeFile(
      join(agentDir, "auth.json"),
      `${JSON.stringify({ openai: { type: "api_key", key: "test-openai-key" } }, null, 2)}\n`,
      "utf8",
    );

    const selectedWorkspaceId = (await getDesktopState(window)).selectedWorkspaceId;
    expect(selectedWorkspaceId).toBeTruthy();
    await window.evaluate(async ({ workspaceId }) => {
      const app = window.piApp;
      if (!app) {
        throw new Error("piApp IPC bridge is unavailable");
      }
      await app.refreshRuntime(workspaceId);
    }, { workspaceId: selectedWorkspaceId });

    await expect(modelBadge).toHaveText("No models available");
    await expect(notice).toContainText("Settings > Models");

    await modelBadge.click();
    const dropdown = window.locator(".new-thread__hint .model-selector__dropdown").first();
    await expect(dropdown).toContainText("No models available");
    await expect(dropdown).not.toContainText("GPT-5");
    await expect(dropdown).not.toContainText("GPT-4o");
  } finally {
    await harness.close();
  }
});

test("settings keep configured models visible when provider credentials are missing", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-no-provider-settings-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["openai/gpt-5", "openai/gpt-4o"],
  });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    scrubProviderEnv: true,
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    await window.getByTestId("new-thread-composer").fill("check no provider settings");
    await expect(window.getByTestId("model-onboarding-notice")).toContainText("Settings > Models");

    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Models", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Models");

    const configuredModelsSection = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Configured models" }),
    });
    await expect(configuredModelsSection).toContainText("openai/gpt-5");
    await expect(configuredModelsSection).toContainText("openai/gpt-4o");
    await expect(configuredModelsSection.locator(".settings-status--warning")).toHaveCount(2);
  } finally {
    await harness.close();
  }
});
