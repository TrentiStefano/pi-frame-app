import { expect, test } from "@playwright/test";
import {
  createSessionViaIpc,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openExtensionsSurfaceForTest,
  writeProjectExtension,
} from "../helpers/electron-app";

const initialExtensionSource = String.raw`
export default function reloadExtension(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setTitle("Initial extension state");
    ctx.ui.setWidget("reload-widget", ["Initial widget line"]);
  });
}
`;

const refreshedExtensionSource = String.raw`
export default function reloadExtension(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setTitle("Refreshed extension state");
    ctx.ui.setWidget("reload-widget", ["Refreshed widget line"]);
  });
}
`;

test("keeps extension widgets out of the composer after a runtime refresh", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-ui-refresh-workspace");
  await writeProjectExtension(workspacePath, "reload-extension.ts", initialExtensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createSessionViaIpc(window, workspacePath, "Refresh session");
    await expect(window.getByTestId("composer")).toBeVisible();
    await expect(window.locator(".topbar__session")).toHaveText("Initial extension state");
    await expect(window.getByTestId("extension-dock")).toHaveCount(0);

    await writeProjectExtension(workspacePath, "reload-extension.ts", refreshedExtensionSource);
    await openExtensionsSurfaceForTest(window);
    await window.getByRole("button", { name: "Refresh", exact: true }).click();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();

    await expect(window.locator(".topbar__session")).toHaveText("Refreshed extension state");
    await expect(window.getByTestId("extension-dock")).toHaveCount(0);
    await expect(window.locator(".composer__surface")).not.toContainText("Refreshed widget line");
  } finally {
    await harness.close();
  }
});
