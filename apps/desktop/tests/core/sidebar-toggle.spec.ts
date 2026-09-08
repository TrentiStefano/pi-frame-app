import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

const NARROW_WINDOW_WIDTH = 1200;
const NARROW_WINDOW_HEIGHT = 760;

interface SidebarLayout {
  readonly viewportWidth: number;
  readonly mainLeft: number;
  readonly mainRight: number;
  readonly mainWidth: number;
  readonly toggleRight: number;
  readonly topbarLeft: number;
  readonly topbarRight: number;
  readonly topbarActionsRight: number;
}

async function expectSidebarCollapsed(window: Page, collapsed: boolean): Promise<void> {
  const sidebar = window.locator(".sidebar");
  await expect(sidebar).toHaveCount(1);
  await expect(sidebar).toHaveAttribute("data-collapsed", String(collapsed));
  await expect(sidebar).toHaveAttribute("aria-hidden", String(collapsed));
  if (collapsed) {
    await expect(sidebar).toBeHidden();
  } else {
    await expect(sidebar).toBeVisible();
  }
  await expect.poll(async () => (await getDesktopState(window)).sidebarCollapsed).toBe(collapsed);
}

async function restoreSidebarIfNeeded(window: Page): Promise<void> {
  if ((await getDesktopState(window)).sidebarCollapsed) {
    await window.getByTestId("sidebar-toggle").click();
    await expectSidebarCollapsed(window, false);
  }
}

async function readSidebarLayout(window: Page): Promise<SidebarLayout | null> {
  return window.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".main");
    const toggle = document.querySelector<HTMLElement>("[data-testid='sidebar-toggle']");
    const topbar = document.querySelector<HTMLElement>(".topbar");
    const topbarActions = document.querySelector<HTMLElement>(".topbar__actions");
    if (!main || !toggle || !topbar || !topbarActions) {
      return null;
    }
    const mainRect = main.getBoundingClientRect();
    const toggleRect = toggle.getBoundingClientRect();
    const topbarRect = topbar.getBoundingClientRect();
    const topbarActionsRect = topbarActions.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      mainLeft: mainRect.left,
      mainRight: mainRect.right,
      mainWidth: mainRect.width,
      toggleRight: toggleRect.right,
      topbarLeft: topbarRect.left,
      topbarRight: topbarRect.right,
      topbarActionsRight: topbarActionsRect.right,
    };
  });
}

async function expectToggleAtTopbarRight(window: Page): Promise<void> {
  const layout = await readSidebarLayout(window);
  if (!layout) {
    throw new Error("Expected main, sidebar toggle, and topbar to be present");
  }
  const platform = await window.evaluate(() => document.documentElement.dataset.platform);
  if (platform === "win32") {
    await expect(window.locator(".windows-titlebar-menu__utility > .sidebar-toggle")).toHaveCount(1);
    return;
  }
  await expect(window.locator(".topbar__actions > .sidebar-toggle")).toHaveCount(1);
  expect(layout.toggleRight).toBe(layout.topbarActionsRight);
  const nativeControlOverlayInset = await window.evaluate(() => document.documentElement.dataset.platform === "win32" ? 148 : 0);
  expect(layout.topbarRight - layout.toggleRight).toBeLessThanOrEqual(16 + nativeControlOverlayInset);
}

async function setElectronWindowSize(
  app: Awaited<ReturnType<typeof launchDesktop>>["electronApp"],
  window: Page,
  width: number,
  height: number,
): Promise<void> {
  const didSetSize = await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) {
      return false;
    }
    window.setContentSize(size.width, size.height);
    return true;
  }, { width, height });
  expect(didSetSize).toBe(true);
  await expect.poll(() => window.evaluate(
    (size) => Math.abs(window.innerWidth - size.width) <= 1 && Math.abs(window.innerHeight - size.height) <= 1,
    { height, width },
  )).toBe(true);
}

async function writeProofScreenshot(window: Page, name: string): Promise<void> {
  const proofDir = process.env.PI_APP_SIDEBAR_PROOF_DIR;
  if (!proofDir) {
    return;
  }
  await window.screenshot({ path: join(proofDir, name), fullPage: false });
}

async function expectSecondaryTakeover(window: Page, testId: string): Promise<void> {
  await expect(window.getByTestId(testId)).toBeVisible();
  await expect(window.locator(".secondary-surface__sidebar")).toBeVisible();
  await expect(window.locator(".shell, .sidebar, .main")).toHaveCount(0);
  await expect(window.getByTestId("sidebar-toggle")).toHaveCount(0);
}

async function writeTakeoverProof(window: Page, name: string): Promise<void> {
  const proofDir = process.env.PI_APP_TAKEOVER_PROOF_DIR;
  if (proofDir) {
    await window.screenshot({ path: join(proofDir, name), fullPage: false });
  }
}

test("toggles and persists the primary sidebar from the button and keyboard shortcut", async () => {
  test.setTimeout(90_000);
  const takeoverProofDir = process.env.PI_APP_TAKEOVER_PROOF_DIR;
  if (takeoverProofDir) {
    await mkdir(takeoverProofDir, { recursive: true });
  }
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("sidebar-toggle-workspace");
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await firstRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    const toggle = window.getByTestId("sidebar-toggle");
    await expect(toggle).toBeVisible();
    await expect(window.locator(".sidebar")).toBeVisible();
    await expect(window.getByRole("button", { name: "Skills", exact: true })).toHaveCount(0);


    const newThreadButton = window.locator(".sidebar").getByRole("button", { name: "New thread", exact: true });
    const newThreadBackground = await newThreadButton.evaluate((element) => getComputedStyle(element).backgroundColor);
    await newThreadButton.hover();
    await expect.poll(() => newThreadButton.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(newThreadBackground);

    const sidebarBeforeResize = await window.locator(".sidebar").boundingBox();
    const sidebarResizer = window.locator(".sidebar-resizer");
    const sidebarResizerBox = await sidebarResizer.boundingBox();
    if (!sidebarBeforeResize || !sidebarResizerBox) {
      throw new Error("Expected the sidebar and its resize separator");
    }
    await window.mouse.move(sidebarResizerBox.x + sidebarResizerBox.width / 2, sidebarResizerBox.y + 100);
    await window.mouse.down();
    await window.mouse.move(sidebarResizerBox.x + 64, sidebarResizerBox.y + 100);
    await window.mouse.up();
    await expect.poll(async () => (await window.locator(".sidebar").boundingBox())?.width ?? 0).toBeGreaterThan(sidebarBeforeResize.width);

    const expandedMainBox = await window.locator(".main").boundingBox();
    expect(expandedMainBox).not.toBeNull();

    await toggle.click();
    await expectSidebarCollapsed(window, true);
    await expectToggleAtTopbarRight(window);
    const collapsedMainBox = await window.locator(".main").boundingBox();
    expect(collapsedMainBox).not.toBeNull();
    expect(collapsedMainBox?.x).toBeLessThanOrEqual(1);
    expect(collapsedMainBox?.width).toBeGreaterThanOrEqual((await window.evaluate(() => innerWidth)) - 1);
    expect(collapsedMainBox?.x ?? 999).toBeLessThan(expandedMainBox?.x ?? 0);
    expect(collapsedMainBox?.width ?? 0).toBeGreaterThan(expandedMainBox?.width ?? 9999);

    await toggle.click();
    await expectSidebarCollapsed(window, false);

    await window.keyboard.press(desktopShortcut("B"));
    await expectSidebarCollapsed(window, true);
    await window.keyboard.press(desktopShortcut("B"));
    await expectSidebarCollapsed(window, false);

    await window.keyboard.press(desktopShortcut("Shift+O"));
    await expect(window.getByTestId("new-thread-composer")).toBeVisible();
    await window.keyboard.press(desktopShortcut("B"));
    await expectSidebarCollapsed(window, true);
    await window.keyboard.press(desktopShortcut("B"));
    await expectSidebarCollapsed(window, false);

    await window.keyboard.press(desktopShortcut(","));
    await expectSecondaryTakeover(window, "settings-surface");
    await window.getByRole("button", { name: "Appearance", exact: true }).click();
    const lightThemeButton = window.getByRole("button", { name: "Light", exact: true });
    await expect(lightThemeButton).toBeVisible();
    await lightThemeButton.click();
    await writeTakeoverProof(window, "settings-light.png");
    await window.keyboard.press(desktopShortcut("B"));
    await expect.poll(async () => (await getDesktopState(window)).sidebarCollapsed).toBe(false);
    await window.getByRole("button", { name: "Back to app", exact: true }).click();

    await restoreSidebarIfNeeded(window);
    await expect(window.getByRole("button", { name: "Extensions", exact: true })).toHaveCount(0);

    await window.keyboard.press(desktopShortcut(","));
    await expectSecondaryTakeover(window, "settings-surface");
    const darkThemeButton = window.getByRole("button", { name: "Dark", exact: true });
    await expect(darkThemeButton).toBeVisible();
    await darkThemeButton.click();
    await writeTakeoverProof(window, "settings-dark.png");
    await window.getByRole("button", { name: "Back to app", exact: true }).click();

    await expect(window.getByRole("button", { name: "Extensions", exact: true })).toHaveCount(0);

    await restoreSidebarIfNeeded(window);
    await window.getByTestId("sidebar-toggle").click();
    await expectSidebarCollapsed(window, true);
  } finally {
    await firstRun.close();
  }

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await expectSidebarCollapsed(window, true);
    await expect(window.getByTestId("sidebar-toggle")).toBeVisible();
    await expectToggleAtTopbarRight(window);
    await window.getByTestId("sidebar-toggle").click();
    await expectSidebarCollapsed(window, false);
  } finally {
    await secondRun.close();
  }
});

test("keeps collapsed sidebar out of narrow windows and reopens from the button", async () => {
  test.setTimeout(90_000);
  const proofDir = process.env.PI_APP_SIDEBAR_PROOF_DIR;
  if (proofDir) {
    await mkdir(proofDir, { recursive: true });
  }
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("sidebar-narrow-workspace");
  const run = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    ...(proofDir
      ? {
          recordVideoDir: join(proofDir, "videos"),
          recordVideoSize: { width: NARROW_WINDOW_WIDTH, height: NARROW_WINDOW_HEIGHT },
        }
      : {}),
  });
  let window: Page | undefined;

  try {
    window = await run.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await setElectronWindowSize(run.electronApp, window, NARROW_WINDOW_WIDTH, NARROW_WINDOW_HEIGHT);
    await expect(window.getByTestId("sidebar-toggle")).toBeVisible();

    await window.keyboard.press(desktopShortcut("B"));
    await expectSidebarCollapsed(window, true);
    await expectToggleAtTopbarRight(window);
    await writeProofScreenshot(window, "narrow-sidebar-collapsed.png");

    const collapsedLayout = await readSidebarLayout(window);
    if (!collapsedLayout) {
      throw new Error("Expected collapsed narrow layout to include main, topbar, and sidebar toggle");
    }
    expect(collapsedLayout.viewportWidth).toBeLessThanOrEqual(NARROW_WINDOW_WIDTH + 1);
    expect(collapsedLayout.mainLeft).toBeLessThanOrEqual(1);
    expect(collapsedLayout.mainRight).toBeGreaterThanOrEqual(collapsedLayout.viewportWidth - 1);
    expect(collapsedLayout.mainWidth).toBeGreaterThanOrEqual(collapsedLayout.viewportWidth - 1);
    expect(collapsedLayout.topbarLeft).toBeGreaterThanOrEqual(collapsedLayout.mainLeft);
    expect(collapsedLayout.topbarRight).toBeLessThanOrEqual(collapsedLayout.mainRight);

    await window.getByTestId("sidebar-toggle").click();
    await expectSidebarCollapsed(window, false);
    await expect(window.locator(".sidebar")).toBeVisible();
    const sidebarBox = await window.locator(".sidebar").boundingBox();
    const reopenedMainBox = await window.locator(".main").boundingBox();
    if (!sidebarBox || !reopenedMainBox) {
      throw new Error("Expected reopened layout to include sidebar and main regions");
    }
    expect(reopenedMainBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 1);
    await writeProofScreenshot(window, "narrow-sidebar-reopened.png");
  } finally {
    await run.close();
    const video = window?.video();
    if (proofDir && video) {
      await video.saveAs(join(proofDir, "narrow-sidebar-reopen-flow.webm"));
    }
  }
});
