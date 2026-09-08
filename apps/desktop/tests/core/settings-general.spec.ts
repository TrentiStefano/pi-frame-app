import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  spawnDesktopProcess,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("removes model scope controls and persists editable platform shortcuts", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("editable-shortcuts");
  const first = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await first.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "General", exact: true }).click();

    await expect(window.getByText("Connected providers")).toHaveCount(0);
    await expect(window.getByText("Discovered skills")).toHaveCount(0);
    await expect(window.getByText("Model settings scope")).toHaveCount(0);
    const openSettingsShortcut = window.getByTestId("shortcut-openSettings");
    await expect(openSettingsShortcut).toHaveText(process.platform === "darwin" ? "Cmd+," : "Ctrl+,");

    await openSettingsShortcut.click();
    await window.keyboard.press(process.platform === "darwin" ? "Meta+Alt+S" : "Control+Alt+S");
    await expect(openSettingsShortcut).toHaveText(process.platform === "darwin" ? "Cmd+Option+S" : "Ctrl+Alt+S");
    await expect.poll(async () => (await getDesktopState(window)).shortcutBindings.openSettings).toBe("Mod+Alt+S");

    await window.getByRole("button", { name: "Models", exact: true }).click();
    await expect(window.getByText("Model settings scope")).toHaveCount(0);
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(window.getByTestId("settings-surface")).toHaveCount(0);

    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toHaveCount(0);
    await window.keyboard.press(process.platform === "darwin" ? "Meta+Alt+S" : "Control+Alt+S");
    await expect(window.getByTestId("settings-surface")).toBeVisible();

    await expect.poll(async () => {
      const saved = JSON.parse(await readFile(join(userDataDir, "ui-state.json"), "utf8")) as {
        shortcutBindings?: { openSettings?: string };
      };
      return saved.shortcutBindings?.openSettings;
    }).toBe("Mod+Alt+S");
  } finally {
    await first.close();
  }

  const second = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await second.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window.keyboard.press(process.platform === "darwin" ? "Meta+Alt+S" : "Control+Alt+S");
    await expect(window.getByTestId("settings-surface")).toBeVisible();
  } finally {
    await second.close();
  }
});

test("checks application, bundled pi, and extension updates from General settings", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("settings-updates");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_APP_TEST_UPDATE_FIXTURE: "1" },
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "General", exact: true }).click();

    await expect(window.getByText("Check for application, bundled pi, and extension updates.")).toBeVisible();
    await window.getByRole("button", { name: "Check for updates", exact: true }).click();

    await expect(window.getByText(/App 0\.2\.0-beta\.3 · bundled pi 0\.81\.1 · latest pi 99\.0\.0/)).toBeVisible();
    await expect(window.getByText("Installed extension packages are up to date.")).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("handles a release with missing application update metadata", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("settings-update-metadata-missing");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_APP_TEST_UPDATE_FIXTURE: "release-metadata-unavailable" },
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "General", exact: true }).click();
    await window.getByRole("button", { name: "Check for updates", exact: true }).click();

    await expect(window.getByText(/App 0\.2\.0-beta\.3 · bundled pi 0\.81\.1 · latest pi 99\.0\.0/)).toBeVisible();
    await expect(window.getByText("Installed extension packages are up to date.")).toBeVisible();
    await expect(window.getByText("Application update files are still being prepared. Please try again later.")).toBeVisible();
    await expect(window.getByText(/Error invoking remote method|latest\.yml|HttpError/)).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("ignores persisted multiple app instance opt-in and hides the setting", async () => {
  const userDataDir = await makeUserDataDir();
  await writeFile(join(userDataDir, "ui-state.json"), `${JSON.stringify({ allowMultiple: true }, null, 2)}\n`, "utf8");
  const workspacePath = await makeWorkspace("allow-multiple-instances-disabled");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  let secondProcess: ChildProcess | undefined;

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    await expect.poll(async () => harness.electronApp.evaluate(({ app }) => app.hasSingleInstanceLock())).toBe(true);
    secondProcess = await spawnDesktopProcess(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    await expect(await waitForProcessExit(secondProcess)).toEqual({ code: 0, signal: null });
    await expect
      .poll(async () => harness.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(1);
    await expect
      .poll(async () => {
        const persisted = JSON.parse(await readFile(join(userDataDir, "ui-state.json"), "utf8")) as {
          readonly allowMultiple?: unknown;
        };
        return persisted.allowMultiple;
      })
      .toBeUndefined();

    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "General", exact: true }).click();
    await expect(window.getByLabel("Shell of integrated terminal")).toBeVisible();
    await expect(window.getByText("Allow multiple app instances")).toHaveCount(0);
    await expect(window.getByLabel("Allow multiple app instances")).toHaveCount(0);
  } finally {
    if (secondProcess && secondProcess.exitCode === null && secondProcess.signalCode === null) {
      secondProcess.kill();
    }
    await harness.close();
  }
});

async function waitForProcessExit(
  child: ChildProcess,
  timeoutMs = 5_000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      once(child, "exit"),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for second app process to exit")), timeoutMs);
      }),
    ]);
    const [code, signal] = result as [number | null, NodeJS.Signals | null];
    return { code, signal };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
