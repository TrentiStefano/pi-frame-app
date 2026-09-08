import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir } from "../helpers/electron-app";

test("uses the pi-frame identity without upstream update or documentation menus", async () => {
  const userDataDir = await makeUserDataDir("pi-frame-branding-");
  const harness = await launchDesktop(userDataDir, { testMode: "background" });

  try {
    const window = await harness.firstWindow();
    await expect(window).toHaveTitle("pi-frame");

    const identity = await harness.electronApp.evaluate(({ app, Menu, BrowserWindow }) => ({
      appName: app.name,
      menuLabels: Menu.getApplicationMenu()?.items.flatMap((item) => [
        item.label,
        ...(item.submenu?.items.map((child) => child.label) ?? []),
      ]) ?? [],
      windowTitle: BrowserWindow.getAllWindows()[0]?.getTitle(),
    }));

    expect(identity).toMatchObject({ appName: "pi-frame", windowTitle: "pi-frame" });
    expect(identity.menuLabels).not.toContain("Help");
    expect(identity.menuLabels).not.toContain("帮助");
    expect(identity.menuLabels).not.toContain("Check for Updates…");
    expect(identity.menuLabels).not.toContain("检查更新…");
  } finally {
    await harness.close();
  }
});
