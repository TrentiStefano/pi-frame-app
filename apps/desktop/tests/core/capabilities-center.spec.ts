import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test.setTimeout(120_000);

test("opens the capability center and filters conversations from the sidebar", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("capability-center-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: {
      PI_CAPABILITY_CATALOG_URL: "http://127.0.0.1:9/catalog.json",
    },
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Alpha capability discussion");
    await createNamedThread(window, "Beta release planning");

    await window.getByRole("button", { name: "Search conversations", exact: true }).click();
    await window.getByPlaceholder("Search conversations", { exact: true }).fill("Alpha");
    await expect(window.locator(".session-row", { hasText: "Alpha capability discussion" })).toBeVisible();
    await expect(window.locator(".session-row", { hasText: "Beta release planning" })).toHaveCount(0);

    await window.getByRole("button", { name: "Skills and connectors", exact: true }).click();
    const center = window.getByTestId("capabilities-view");
    await expect(center).toBeVisible();
    await expect(center.getByRole("heading", { name: "Skills and connectors", exact: true })).toBeVisible();
    await expect(center.locator(".capability-row", { hasText: "Pi starter skills" })).toBeVisible();
    await expect(center.locator(".capability-row", { hasText: "Context7 documentation" })).toBeVisible();

    await center.getByRole("tab", { name: "Connectors", exact: true }).click();
    await expect(center.locator(".capability-row", { hasText: "Context7 documentation" })).toBeVisible();
    await expect(center.locator(".capability-row", { hasText: "Pi starter skills" })).toHaveCount(0);
    await expect(window.locator(".sidebar__footer").getByRole("button", { name: "Settings", exact: true })).toBeVisible();

    await window.setViewportSize({ width: 1000, height: 760 });
    await expect(center).toBeVisible();
    expect(await window.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    await harness.close();
  }
});
