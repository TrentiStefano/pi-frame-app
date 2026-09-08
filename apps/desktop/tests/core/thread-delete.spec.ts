import { access } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";
import { sessionFilePathFromCatalog } from "../helpers/session-file";

test("deletes a thread permanently after confirmation", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir("pi-app-user-data-");
  const workspacePath = await makeWorkspace("delete-thread-workspace");
  const deletedTitle = "Thread to delete";
  const remainingTitle = "Thread to keep";
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  let deletedSessionFile = "";
  try {
    const window = await firstRun.firstWindow();
    await createNamedThread(window, remainingTitle);
    await createNamedThread(window, deletedTitle);
    const state = await getDesktopState(window);
    const target = { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
    deletedSessionFile = await sessionFilePathFromCatalog(userDataDir, target);

    let row = window.locator(".session-list > .session-row", { hasText: deletedTitle }).first();
    await row.click({ button: "right" });
    let confirmationMessage = "";
    window.once("dialog", async (dialog) => {
      confirmationMessage = dialog.message();
      await dialog.dismiss();
    });
    await row.getByRole("menu").getByRole("button", { name: "Delete thread" }).click();
    expect(confirmationMessage).toContain(`Delete “${deletedTitle}”?`);
    expect(confirmationMessage).toContain("cannot be undone");
    await expect(row).toBeVisible();
    await expect(access(deletedSessionFile)).resolves.toBeUndefined();

    row = window.locator(".session-list > .session-row", { hasText: deletedTitle }).first();
    await row.click({ button: "right" });
    window.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("menu").getByRole("button", { name: "Delete thread" }).click();

    await expect(window.locator(".topbar__session")).toHaveText(remainingTitle);
    await expect(window.locator(".session-row", { hasText: deletedTitle })).toHaveCount(0);
    await expect
      .poll(async () => {
        const nextState = await getDesktopState(window);
        return nextState.workspaces.flatMap((workspace) => workspace.sessions).some((session) => session.id === target.sessionId);
      })
      .toBe(false);
    await expect(access(deletedSessionFile)).rejects.toThrow();
  } finally {
    await firstRun.close();
  }

  const reopened = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await reopened.firstWindow();
    await expect(window.locator(".session-row", { hasText: remainingTitle })).toBeVisible();
    await expect(window.locator(".session-row", { hasText: deletedTitle })).toHaveCount(0);
  } finally {
    await reopened.close();
  }
});
