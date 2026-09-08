import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createNamedThread, getDesktopState, launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

test("configures discovered skill commands from settings", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("skills-settings-workspace");
  await mkdir(join(workspacePath, ".agents", "skills", "demo-skill"), { recursive: true });
  await writeFile(
    join(workspacePath, ".agents", "skills", "demo-skill", "SKILL.md"),
    `# Demo Skill

Use this skill when the user wants a short demo workflow.

## Workflow

1. Inspect the repo.
2. Summarize what changed.
`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Skill test session");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(window.locator(".settings-view")).toBeVisible();
    await expect(window.getByText("Notifications", { exact: true })).toBeVisible();
    await expect(window.locator(".settings-view")).toContainText("Enable skill slash commands");
    const skillCommandsToggle = window.getByRole("checkbox", { name: "Enable skill slash commands" });
    await expect(skillCommandsToggle).toBeChecked();
    await skillCommandsToggle.click();

    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    const composer = window.getByTestId("composer");
    await composer.fill("/skill");
    await expect(window.getByTestId("slash-menu")).toHaveCount(0);

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(skillCommandsToggle).not.toBeChecked();
    await skillCommandsToggle.click();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await composer.fill("/skill");
    const slashMenu = window.getByTestId("slash-menu");
    await expect(slashMenu).toContainText("Runtime Commands");
    await expect(slashMenu).toContainText("Demo Skill");
  } finally {
    await harness.close();
  }
});

test("keeps Computer Use disabled by default and persists the opt-in toggle", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("computer-use-settings-workspace");
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await firstRun.firstWindow();
    await createNamedThread(window, "Computer Use settings session");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    const toggle = window.getByRole("checkbox", { name: "Enable Computer Use" });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    const before = await getDesktopState(window);
    const sessionKey = `${before.selectedWorkspaceId}:${before.selectedSessionId}`;
    await expect
      .poll(async () => (await getDesktopState(window)).sessionCommandsBySession[sessionKey]?.some((command) => command.name === "computer-use") ?? false)
      .toBe(false);
    await toggle.click();
    await expect(toggle).toBeChecked();
    if (process.platform === "win32" || process.platform === "darwin") {
      await expect
        .poll(async () => (await getDesktopState(window)).sessionCommandsBySession[sessionKey]?.some((command) => command.name === "computer-use") ?? false)
        .toBe(true);
      await toggle.click();
      await expect(toggle).not.toBeChecked();
      await expect
        .poll(async () => (await getDesktopState(window)).sessionCommandsBySession[sessionKey]?.some((command) => command.name === "computer-use") ?? false)
        .toBe(false);
      await toggle.click();
      await expect(toggle).toBeChecked();
    }
  } finally {
    await firstRun.close();
  }

  const secondRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await secondRun.firstWindow();
    await createNamedThread(window, "Computer Use settings restored session");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(window.getByRole("checkbox", { name: "Enable Computer Use" })).toBeChecked();
  } finally {
    await secondRun.close();
  }
});

test("matches skill slash commands by skill name aliases", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("skills-alias-workspace");
  await mkdir(join(workspacePath, ".agents", "skills", "plan-loop"), { recursive: true });
  await writeFile(
    join(workspacePath, ".agents", "skills", "plan-loop", "SKILL.md"),
    `# Plan Loop

Use this skill for complex or high-risk implementation work that needs plan-first execution.
`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Skill alias session");

    const composer = window.getByTestId("composer");
    const slashMenu = window.getByTestId("slash-menu");

    await composer.fill("/plan");
    await expect(slashMenu).toContainText("Plan Loop");
    await expect(slashMenu).toContainText("/skill:plan-loop");

    await composer.fill("/plan-loop");
    await expect(slashMenu).toContainText("Plan Loop");

    await composer.fill("/skill:plan-loop");
    await expect(slashMenu).toContainText("Plan Loop");
  } finally {
    await harness.close();
  }
});
