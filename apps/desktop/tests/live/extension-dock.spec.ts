import { expect, test } from "@playwright/test";
import {
  createSessionViaIpc,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  writeProjectExtension,
} from "../helpers/electron-app";

const extensionSource = String.raw`
export default function desktopUiExtension(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setTitle("Extension state active");
    ctx.ui.setStatus("state", "Ready");
    ctx.ui.setWidget("primary", ["Primary line"]);
    ctx.ui.setWidget("secondary", ["Below line"], { placement: "belowEditor" });
  });
}
`;

test("does not render extension status or widgets above the desktop composer", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-ui-hidden-workspace");
  await writeProjectExtension(workspacePath, "desktop-ui-extension.ts", extensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createSessionViaIpc(window, workspacePath, "Extension UI session");
    await expect(window.getByTestId("composer")).toBeVisible();

    await expect(window.locator(".topbar__session")).toHaveText("Extension state active");
    await expect(window.getByTestId("extension-dock")).toHaveCount(0);
    await expect(window.getByTestId("extension-dock-toggle")).toHaveCount(0);
    await expect(window.locator(".composer__surface")).not.toContainText("Ready");
    await expect(window.locator(".composer__surface")).not.toContainText("Primary line");
    await expect(window.locator(".composer__surface")).not.toContainText("Below line");
    await expect(window.getByTestId("composer")).toBeVisible();
  } finally {
    await harness.close();
  }
});
