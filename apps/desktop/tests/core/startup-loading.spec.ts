import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchDesktop, makeUserDataDir } from "../helpers/electron-app";

test("keeps an animated startup surface visible until the app window is ready", async () => {
  const userDataDir = await makeUserDataDir("startup-loading-");
  await writeFile(
    join(userDataDir, "ui-state.json"),
    JSON.stringify({ appLanguage: "en", themeMode: "dark" }),
    "utf8",
  );
  const harness = await launchDesktop(userDataDir, {
    testMode: "background",
    envOverrides: { PI_APP_TEST_STARTUP_WINDOW: "1" },
  });

  try {
    let startupWindow: Page | undefined;
    await expect
      .poll(() => {
        startupWindow = harness.electronApp
          .windows()
          .find((window) => window.url().startsWith("data:text/html"));
        return Boolean(startupWindow);
      })
      .toBe(true);

    const startupStatus = startupWindow!.getByRole("status");
    await expect(startupStatus).toContainText("pi-frame");
    await expect(startupStatus).toContainText("Restoring your workspace");

    const startupPaint = await startupWindow!.evaluate(() => {
      const bodyStyle = getComputedStyle(document.body);
      const loaderStyle = getComputedStyle(document.querySelector(".loader") as HTMLElement);
      return {
        background: bodyStyle.backgroundColor,
        loaderAnimation: loaderStyle.animationName,
      };
    });
    expect(startupPaint.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(startupPaint.background).not.toBe("rgb(0, 0, 0)");
    expect(startupPaint.background).toBe("rgb(26, 27, 30)");
    expect(startupPaint.loaderAnimation).toBe("loading-spin");

    await startupWindow!.waitForEvent("close");
    const appWindow = await harness.firstWindow();
    await expect(appWindow.locator(".shell")).toBeVisible();
    await expect(appWindow.locator(".shell--loading")).toHaveCount(0);
    expect(await appWindow.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    const nativeBackground = await harness.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getBackgroundColor().toLowerCase(),
    );
    expect(nativeBackground).toBe("#1a1b1e");
  } finally {
    await harness.close();
  }
});

test("does not block startup when optional Pi packages are missing", async () => {
  test.setTimeout(30_000);
  const userDataDir = await makeUserDataDir("startup-missing-packages-");
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeUserDataDir("startup-missing-packages-workspace-");
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "auth.json"), "{}\n", "utf8");
  await writeFile(
    join(agentDir, "settings.json"),
    `${JSON.stringify({ packages: ["npm:package-that-is-not-installed"] })}\n`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await expect(window.locator("body")).toBeVisible();
    await expect(window.locator(".shell, .shell--loading").first()).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("gracefully restores workspaces when an initial workspace path is unreachable", async () => {
  test.setTimeout(30_000);
  const userDataDir = await makeUserDataDir("startup-unreachable-ws-");
  const validWorkspace = await makeUserDataDir("startup-valid-workspace-");
  const unreachableWorkspace = join(userDataDir, "non-existent-unreachable-dir-12345");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [unreachableWorkspace, validWorkspace],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await expect(window.locator("body")).toBeVisible();
    await expect(window.locator(".shell")).toBeVisible();
    await expect(window.locator(".shell--loading")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

