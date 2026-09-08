import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("keeps legacy archived threads visible without archive controls", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir("pi-app-user-data-");
  const workspacePath = await makeWorkspace("archive-sidebar-workspace");
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  let archivedTarget: { workspaceId: string; sessionId: string } | undefined;
  try {
    const window = await firstRun.firstWindow();
    await createNamedThread(window, "Thread one");
    await createNamedThread(window, "Thread two");
    const state = await getDesktopState(window);
    archivedTarget = { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
    await window.evaluate(async (target) => window.piApp?.archiveSession(target), archivedTarget);
  } finally {
    await firstRun.close();
  }

  expect(archivedTarget).toBeDefined();
  const reopened = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await reopened.firstWindow();
    const row = window.locator(".session-list > .session-row", { hasText: "Thread two" }).first();
    await expect(row).toBeVisible();
    await expect(window.getByRole("button", { name: /^Archive / })).toHaveCount(0);
    await expect(window.getByRole("button", { name: /^Restore / })).toHaveCount(0);
    await expect(window.getByText("Archived", { exact: true })).toHaveCount(0);

    const pinButton = row.getByRole("button", { name: /^Pin conversation Thread two/ });
    await row.hover();
    await expect(pinButton).toHaveCSS("visibility", "visible");
    await pinButton.dispatchEvent("click");
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const session = state.workspaces
          .flatMap((workspace) => workspace.sessions)
          .find((entry) => entry.id === archivedTarget!.sessionId);
        return { archivedAt: session?.archivedAt ?? "", pinned: Boolean(session?.pinnedAt) };
      })
      .toEqual({ archivedAt: "", pinned: true });
  } finally {
    await reopened.close();
  }
});
