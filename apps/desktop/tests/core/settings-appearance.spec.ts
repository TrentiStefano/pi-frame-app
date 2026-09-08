import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("migrates legacy appearance settings to one explicit color mode", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("appearance-legacy-migration");
  await writeFile(
    join(userDataDir, "ui-state.json"),
    JSON.stringify({
      version: 17,
      themeMode: "system",
      themePresetId: "tokyo-night",
      enableTransparency: true,
    }),
  );
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    const state = await getDesktopState(window);
    expect(["light", "dark"]).toContain(state.themeMode);

    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(window.getByRole("group", { name: "Color mode" })).toBeVisible();
    await expect(window.getByRole("button", { name: "Light", exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "Dark", exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "System", exact: true })).toHaveCount(0);
    await expect(window.getByText("Theme preset", { exact: true })).toHaveCount(0);
    await expect(window.getByText("Window transparency", { exact: true })).toHaveCount(0);

    await expect.poll(async () => {
      const persisted = JSON.parse(await readFile(join(userDataDir, "ui-state.json"), "utf8")) as Record<string, unknown>;
      return {
        version: persisted.version,
        themeMode: persisted.themeMode,
        hasThemePreset: "themePresetId" in persisted,
        hasTransparency: "enableTransparency" in persisted,
      };
    }).toEqual({
      version: 19,
      themeMode: state.themeMode,
      hasThemePreset: false,
      hasTransparency: false,
    });
  } finally {
    await harness.close();
  }
});

test("switches between light and dark mode and restores the choice", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("appearance-color-mode");
  await writeFile(join(userDataDir, "ui-state.json"), JSON.stringify({ version: 18, themeMode: "light" }));
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "Appearance", exact: true }).click();

    const light = window.getByRole("button", { name: "Light", exact: true });
    const dark = window.getByRole("button", { name: "Dark", exact: true });
    await expect(light).toHaveAttribute("aria-pressed", "true");
    await dark.click();
    await expect(dark).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => window.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    await expect.poll(async () => (await getDesktopState(window)).themeMode).toBe("dark");
    await expect.poll(async () => {
      const persisted = JSON.parse(await readFile(join(userDataDir, "ui-state.json"), "utf8")) as { themeMode?: unknown };
      return persisted.themeMode;
    }).toBe("dark");
  } finally {
    await harness.close();
  }

  harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await expect.poll(() => window.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(window.getByRole("button", { name: "Dark", exact: true })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await harness.close();
  }
});

test("keeps the simplified appearance control readable in narrow Chinese mode", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("appearance-zh-narrow");
  await writeFile(
    join(userDataDir, "ui-state.json"),
    JSON.stringify({ version: 18, appLanguage: "zh-CN", themeMode: "dark" }),
  );
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.setViewportSize({ width: 620, height: 760 });
    await waitForWorkspaceByPath(window, workspacePath);
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "外观", exact: true }).click();

    await expect(window.getByRole("group", { name: "颜色模式" })).toBeVisible();
    await expect(window.getByRole("button", { name: "浅色", exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "深色", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(window.getByText("主题预设", { exact: true })).toHaveCount(0);
    await expect(window.getByText("窗口透明效果", { exact: true })).toHaveCount(0);

    const overflow = await window.getByTestId("settings-surface").evaluate((surface) => ({
      clientWidth: surface.clientWidth,
      scrollWidth: surface.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  } finally {
    await harness.close();
  }
});
