import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { SessionDriverEvent, SessionRef } from "@pi-frame/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  seedAgentDir,
} from "../helpers/electron-app";

async function selectedSessionRef(window: Page): Promise<SessionRef> {
  const state = await getDesktopState(window);
  if (!state.selectedWorkspaceId || !state.selectedSessionId) throw new Error("Expected a selected session");
  return { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
}

test("opens an empty plan panel and controls plan mode from the workspace tools", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("empty-plan-panel");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Empty plan panel");
    const composer = window.getByTestId("composer");
    await composer.fill("Keep this unsent draft");

    await expect(window.getByRole("button", { name: /Toggle browser/ })).toHaveCount(0);
    await window.getByTestId("workspace-tools").click();
    await expect(window.getByRole("menuitem", { name: "Browser" })).toBeEnabled();
    const planMenuItem = window.getByRole("menuitem", { name: "Toggle plan" });
    await expect(planMenuItem).toBeEnabled();
    await planMenuItem.click();

    const planPanel = window.getByTestId("plan-panel");
    await expect(planPanel).toBeVisible();
    await expect(planPanel).toContainText("No plan yet");
    const planMode = planPanel.getByRole("switch", { name: "Toggle plan mode" });
    await expect(planMode).toHaveAttribute("aria-checked", "false");
    await planMode.click();
    await expect(planMode).toHaveAttribute("aria-checked", "true");
    await expect(window.getByTestId("plan-mode-indicator")).toHaveText("Plan");
    await expect(composer).toHaveValue("Keep this unsent draft");
  } finally {
    await harness.close();
  }
});

test("previews structured plans beside the conversation and renders Markdown files", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("plan-rich-preview");
  await writeFile(
    join(workspacePath, "PLAN.md"),
    [
      "# Release plan",
      "",
      "| Area | Owner |",
      "| --- | --- |",
      "| Desktop | Team |",
      "",
      "- [x] Review changes",
      "- [ ] Package release",
    ].join("\n"),
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Plan preview");
    const sessionRef = await selectedSessionRef(window);
    const timestamp = new Date().toISOString();
    const event: Extract<SessionDriverEvent, { type: "toolStarted" }> = {
      type: "toolStarted",
      sessionRef,
      timestamp,
      toolName: "update_plan",
      callId: "plan-preview-1",
      input: {
        explanation: "Ship the **desktop review** work in two focused steps.",
        plan: [
          { step: "Match the review surface", status: "completed" },
          { step: "Verify the Electron workflow", status: "in_progress" },
        ],
      },
    };
    await emitTestSessionEvent(harness, event);

    const planPanel = window.getByTestId("plan-panel");
    await expect(planPanel).toBeVisible();
    await expect(planPanel).toContainText("1 of 2 completed");
    await expect(planPanel.locator("strong")).toHaveText("desktop review");
    await expect(planPanel.locator(".plan-panel__step--completed")).toContainText("Match the review surface");
    await expect(planPanel.locator(".plan-panel__step--in_progress")).toContainText("Verify the Electron workflow");

    await window.getByTestId("workspace-tools").click();
    await window.getByRole("menuitem", { name: "Toggle plan" }).click();
    await expect(planPanel).toHaveCount(0);

    await window.getByTestId("timeline-tool-view-plan").click();
    await expect(planPanel).toBeVisible();

    await window.getByTestId("workspace-tools").click();
    await window.getByRole("menuitem", { name: "Toggle files" }).click();
    const filesPanel = window.locator(".file-workbench--files");
    await expect(filesPanel).toBeVisible();
    await filesPanel.locator('.file-workbench__tree-row--file[data-file-path="PLAN.md"]').click();

    const preview = filesPanel.getByTestId("file-workbench-preview");
    await expect(preview.getByRole("heading", { level: 1, name: "Release plan" })).toBeVisible();
    await expect(preview.locator("table")).toContainText("Desktop");
    await expect(preview.locator('input[type="checkbox"]')).toHaveCount(2);
    await expect(preview).not.toContainText("| --- | --- |");
  } finally {
    await harness.close();
  }
});

test("toggles and restores plan mode through the slash command", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("plan-mode-toggle");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    let window = await harness.firstWindow();
    await createNamedThread(window, "Plan mode session");
    const composer = window.getByTestId("composer");

    await composer.fill("/plan");
    const slashMenu = window.getByTestId("slash-menu");
    await expect(slashMenu).toContainText("Plan mode");
    await slashMenu.getByRole("button", { name: /Plan mode/ }).click();

    await expect(window.getByTestId("plan-mode-indicator")).toHaveText("Plan");
    await expect(composer).toHaveAttribute("placeholder", "Describe your task to generate a plan...");
    await expect(window.getByTestId("transcript")).toContainText("Plan mode enabled");
    const enabledState = await getDesktopState(window);
    expect(enabledState.collaborationModeBySession[`${enabledState.selectedWorkspaceId}:${enabledState.selectedSessionId}`]).toBe("plan");

    await harness.close();
    harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    window = await harness.firstWindow();
    const restoredComposer = window.getByTestId("composer");
    await expect(window.getByTestId("plan-mode-indicator")).toHaveText("Plan");
    await expect(restoredComposer).toHaveAttribute("placeholder", "Describe your task to generate a plan...");

    await restoredComposer.fill("/plan");
    await restoredComposer.press("Enter");
    await expect(window.getByTestId("plan-mode-indicator")).toHaveCount(0);
    await expect(restoredComposer).toHaveAttribute(
      "placeholder",
      "Ask pi to inspect the repo, run a fix, or continue the current thread...",
    );
    await expect(window.getByTestId("transcript")).toContainText("Plan mode disabled");
  } finally {
    await harness.close();
  }
});

test("starts a new thread in plan mode before the first prompt", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-plan-mode");
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
    const sessionCountBefore = before.workspaces.reduce((count, workspace) => count + workspace.sessions.length, 0);
    const composer = window.getByTestId("new-thread-composer");

    await composer.fill("/plan");
    const slashMenu = window.getByTestId("slash-menu");
    await slashMenu.getByRole("button", { name: /Plan mode/ }).click();
    await expect(window.getByTestId("new-thread-plan-mode-indicator")).toHaveText("Plan");
    await expect(composer).toHaveValue("");
    await expect(composer).toHaveAttribute("placeholder", "Describe your task to generate a plan...");
    const afterToggle = await getDesktopState(window);
    expect(afterToggle.workspaces.reduce((count, workspace) => count + workspace.sessions.length, 0)).toBe(sessionCountBefore);

    await composer.fill("Plan the desktop release workflow");
    await window.getByRole("button", { name: "Start thread" }).click();
    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId("plan-mode-indicator")).toHaveText("Plan");
    await expect.poll(async () => {
      const state = await getDesktopState(window);
      return state.collaborationModeBySession[`${state.selectedWorkspaceId}:${state.selectedSessionId}`];
    }).toBe("plan");
  } finally {
    await harness.close();
  }
});
