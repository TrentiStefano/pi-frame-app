import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { getDesktopState, launchDesktop, makeUserDataDir, makeWorkspace, waitForWorkspaceByPath } from "../helpers/electron-app";

test("switches between English and Simplified Chinese and persists the choice", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("language-switch");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window.keyboard.press("Control+,");
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "General", exact: true }).click();
    const language = window.locator(".settings-select").first();
    await expect(language).toHaveValue("en");

    await language.selectOption("zh-CN");
    await expect.poll(() => window.locator("html").getAttribute("lang")).toBe("zh-CN");
    await expect(window.locator("h1.view-header__title")).toHaveText("通用");
    await expect(language).toHaveValue("zh-CN");
    await expect(window.getByText("已连接的模型提供商")).toHaveCount(0);
    await expect(window.getByText("已发现的技能")).toHaveCount(0);
    await expect(window.getByText("模型设置范围")).toHaveCount(0);
    await expect(window.getByTestId("shortcut-openSettings")).toContainText(process.platform === "darwin" ? "Cmd" : "Ctrl");
    await window.getByRole("button", { name: "外观", exact: true }).click();
    await expect(window.getByRole("group", { name: "颜色模式" })).toBeVisible();
    await expect(window.getByRole("button", { name: "浅色", exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "深色", exact: true })).toBeVisible();
    await window.getByRole("button", { name: "返回应用", exact: true }).click();
    const newThreadButton = window.locator(".sidebar").getByRole("button", { name: "新建对话", exact: true });
    await expect(newThreadButton).toBeVisible();
    await expect(window.locator(".sidebar__section .section__head").getByText("对话", { exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "设置", exact: true })).toBeVisible();
    await newThreadButton.click();
    await expect(window.getByRole("button", { name: "本地", exact: true })).toBeVisible();
    await expect(window.locator(".topbar__session")).toHaveText("新建对话");
    await expect.poll(async () => (await getDesktopState(window)).appLanguage).toBe("zh-CN");

    await expect.poll(async () => {
      try {
        const state = JSON.parse(await readFile(join(userDataDir, "ui-state.json"), "utf8")) as { appLanguage?: unknown };
        return state.appLanguage;
      } catch {
        return undefined;
      }
    }).toBe("zh-CN");
  } finally {
    await harness.close();
  }
});

test("restores the saved language after relaunch", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("language-relaunch");
  const first = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    const window = await first.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window.keyboard.press("Control+,");
    await window.getByRole("button", { name: "General", exact: true }).click();
    await window.locator(".settings-select").first().selectOption("zh-CN");
    await expect.poll(() => window.locator("html").getAttribute("lang")).toBe("zh-CN");
  } finally {
    await first.close();
  }

  const second = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  try {
    const window = await second.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await expect.poll(() => window.locator("html").getAttribute("lang")).toBe("zh-CN");
    await window.keyboard.press("Control+,");
    await expect(window.getByRole("button", { name: "通用", exact: true })).toBeVisible();
  } finally {
    await second.close();
  }
});
