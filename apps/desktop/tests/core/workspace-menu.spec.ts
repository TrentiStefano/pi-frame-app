import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import {
  assertExists,
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("supports workspace rename and remove from the sidebar menu", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspaceA = await makeWorkspace("workspace-menu-a");
  const workspaceB = await makeWorkspace("workspace-menu-b");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspaceA, workspaceB],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspaceA);
    await waitForWorkspaceByPath(window, workspaceB);

    const state = await getDesktopState(window);
    const workspace = state.workspaces.find((entry) => entry.path === workspaceA);
    assertExists(workspace, "Expected first workspace");

    await window.getByRole("button", { name: `Workspace actions for ${basename(workspaceA)}` }).click();
    const workspaceMenu = window.locator(".workspace-menu").last();
    await expect(workspaceMenu.getByRole("button", { name: "Open folder" })).toBeVisible();
    await expect(workspaceMenu.getByRole("button", { name: "Edit name" })).toBeVisible();
    await expect(workspaceMenu.getByRole("button", { name: "Remove" })).toBeVisible();

    await workspaceMenu.getByRole("button", { name: "Edit name" }).click();
    const renameInput = window.getByLabel(`Rename ${basename(workspaceA)}`);
    await renameInput.fill("Renamed workspace");
    await window.getByRole("button", { name: "Save" }).click();

    await expect.poll(async () => {
      const latest = await getDesktopState(window);
      return latest.workspaces.find((entry) => entry.id === workspace.id)?.name;
    }).toBe("Renamed workspace");

    window.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await window.getByRole("button", { name: "Workspace actions for Renamed workspace" }).click();
    await window.getByRole("button", { name: "Remove" }).click();

    await expect.poll(async () => {
      const latest = await getDesktopState(window);
      return latest.workspaces.some((entry) => entry.id === workspace.id);
    }).toBe(false);
  } finally {
    await harness.close();
  }
});

test("minimizes workspace conversations on folder click without opening conversation and persists collapsed state across relaunch", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspaceA = await makeWorkspace("workspace-collapse-a");
  const workspaceB = await makeWorkspace("workspace-collapse-b");

  const firstHarness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspaceA, workspaceB],
    testMode: "background",
  });

  let workspaceAId = "";
  let workspaceBId = "";

  try {
    const window = await firstHarness.firstWindow();
    await waitForWorkspaceByPath(window, workspaceA);
    await waitForWorkspaceByPath(window, workspaceB);

    const initialState = await getDesktopState(window);
    const wsA = initialState.workspaces.find((w) => w.path === workspaceA);
    const wsB = initialState.workspaces.find((w) => w.path === workspaceB);
    assertExists(wsA, "Expected workspace A");
    assertExists(wsB, "Expected workspace B");
    workspaceAId = wsA.id;
    workspaceBId = wsB.id;

    // Create a thread in workspace A
    await createNamedThread(window, "Thread A1 message", { workspaceName: basename(workspaceA) });
    await expect.poll(async () => (await getDesktopState(window)).workspaces.find((w) => w.id === workspaceAId)?.sessions.length).toBe(1);

    // Create and select a thread in workspace B
    await createNamedThread(window, "Thread B1 message", { workspaceName: basename(workspaceB) });
    await expect.poll(async () => (await getDesktopState(window)).workspaces.find((w) => w.id === workspaceBId)?.sessions.length).toBe(1);

    const preState = await getDesktopState(window);
    expect(preState.selectedWorkspaceId).toBe(workspaceBId);
    const selectedSessionB = preState.selectedSessionId;
    expect(selectedSessionB).toBeTruthy();

    // Verify workspace A's thread is visible in the sidebar
    await expect(window.locator(".workspace-group", { hasText: basename(workspaceA) }).locator(".session-row")).toHaveCount(1);

    // Click on workspace A's row to minimize / collapse it
    await window.locator(".workspace-row__select", { hasText: basename(workspaceA) }).click();

    // 1. Desired behaviour: conversations in workspace A are minimized (hidden)
    await expect(window.locator(".workspace-group", { hasText: basename(workspaceA) }).locator(".session-row")).toHaveCount(0);

    // 2. Desired behaviour: clicking workspace A does NOT open workspace A's conversation;
    // workspace B's session remains selected!
    const postCollapseState = await getDesktopState(window);
    expect(postCollapseState.selectedWorkspaceId).toBe(workspaceBId);
    expect(postCollapseState.selectedSessionId).toBe(selectedSessionB);
    expect(postCollapseState.collapsedWorkspaceIds).toContain(workspaceAId);
  } finally {
    await firstHarness.close();
  }

  // 3. Desired behaviour: state persists across relaunch
  const secondHarness = await launchDesktop(userDataDir, {
    testMode: "background",
  });

  try {
    const window = await secondHarness.firstWindow();
    await waitForWorkspaceByPath(window, workspaceA);
    await waitForWorkspaceByPath(window, workspaceB);

    // Workspace A must still be minimized on relaunch
    await expect.poll(async () => (await getDesktopState(window)).collapsedWorkspaceIds).toContain(workspaceAId);
    await expect(window.locator(".workspace-group", { hasText: basename(workspaceA) }).locator(".session-row")).toHaveCount(0);

    // Workspace B is still expanded and showing its conversation
    await expect(window.locator(".workspace-group", { hasText: basename(workspaceB) }).locator(".session-row")).toHaveCount(1);

    // Clicking workspace A again expands it
    await window.locator(".workspace-row__select", { hasText: basename(workspaceA) }).click();
    await expect(window.locator(".workspace-group", { hasText: basename(workspaceA) }).locator(".session-row")).toHaveCount(1);
    await expect.poll(async () => (await getDesktopState(window)).collapsedWorkspaceIds).not.toContain(workspaceAId);
  } finally {
    await secondHarness.close();
  }
});
