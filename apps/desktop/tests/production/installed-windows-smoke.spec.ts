import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { DESKTOP_APP_ID } from "../../src/branding";
import {
  launchDesktopByExecutable,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

const execFileAsync = promisify(execFile);

interface ShortcutDetails {
  readonly appUserModelId: string;
  readonly iconLocation: string;
  readonly targetPath: string;
}

async function readShortcut(shortcutPath: string): Promise<ShortcutDetails> {
  await access(shortcutPath);
  const command = [
    "$shortcutPath = $env:PI_APP_TEST_SHORTCUT_PATH",
    "$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)",
    "$shell = New-Object -ComObject Shell.Application",
    "$folder = $shell.Namespace((Split-Path -LiteralPath $shortcutPath))",
    "$item = $folder.ParseName((Split-Path -Leaf $shortcutPath))",
    "@{ appUserModelId = $item.ExtendedProperty('System.AppUserModel.ID'); targetPath = $shortcut.TargetPath; iconLocation = $shortcut.IconLocation } | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      env: { ...process.env, PI_APP_TEST_SHORTCUT_PATH: shortcutPath },
      timeout: 30_000,
      windowsHide: true,
    },
  );
  const parsed = JSON.parse(stdout.trim()) as {
    readonly appUserModelId: string;
    readonly iconLocation: string;
    readonly targetPath: string;
  };
  return {
    appUserModelId: parsed.appUserModelId,
    iconLocation: await realpath(resolve(parsed.iconLocation.split(",")[0])),
    targetPath: await realpath(resolve(parsed.targetPath)),
  };
}

test("launches the installed Windows app with isolated user data", async () => {
  test.skip(
    process.platform !== "win32",
    "Windows installed-app coverage only.",
  );
  test.setTimeout(120_000);

  const startMenuShortcut = join(
    process.env.APPDATA ?? "",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "pi-frame.lnk",
  );
  const desktopShortcut = join(
    process.env.USERPROFILE ?? "",
    "Desktop",
    "pi-frame.lnk",
  );
  const verifyShortcuts = process.env.PI_APP_VERIFY_INSTALLED_SHORTCUTS !== "0";
  const startMenuDetails = verifyShortcuts
    ? await readShortcut(startMenuShortcut)
    : undefined;
  const desktopDetails = verifyShortcuts
    ? await readShortcut(desktopShortcut)
    : undefined;
  const configuredExecutable = process.env.PI_APP_INSTALLED_EXE?.trim();
  const executableCandidate =
    configuredExecutable || startMenuDetails?.targetPath;
  if (!executableCandidate) {
    throw new Error(
      "Set PI_APP_INSTALLED_EXE to the installed pi-frame.exe or install the NSIS package first.",
    );
  }
  const executablePath = await realpath(resolve(executableCandidate));
  await access(executablePath);
  expect(basename(executablePath)).toBe("pi-frame.exe");
  if (verifyShortcuts) {
    expect(startMenuDetails?.targetPath).toBe(executablePath);
    expect(desktopDetails?.targetPath).toBe(executablePath);
    expect(startMenuDetails?.iconLocation).toBe(executablePath);
    expect(desktopDetails?.iconLocation).toBe(executablePath);
    expect(startMenuDetails?.appUserModelId).toBe(DESKTOP_APP_ID);
    expect(desktopDetails?.appUserModelId).toBe(DESKTOP_APP_ID);
    await expect(
      access(
        join(
          process.env.APPDATA ?? "",
          "Microsoft",
          "Windows",
          "Start Menu",
          "Programs",
          "pi-gui.lnk",
        ),
      ),
    ).rejects.toThrow();
    await expect(
      access(join(process.env.USERPROFILE ?? "", "Desktop", "pi-gui.lnk")),
    ).rejects.toThrow();
  }

  const configuredUserDataDir =
    process.env.PI_APP_INSTALLED_USER_DATA_DIR?.trim();
  const userDataDir = configuredUserDataDir
    ? resolve(configuredUserDataDir)
    : await makeUserDataDir("pi-frame-installed-user-data-");
  const workspacePath = await makeWorkspace("installed-windows-workspace");
  const harness = await launchDesktopByExecutable(executablePath, userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const firstWindow = await harness.firstWindow();
    await expect(firstWindow.locator("body")).toBeVisible();
    await expect
      .poll(() =>
        harness.electronApp.evaluate(() => ({
          defaultApp: Boolean(process.defaultApp),
          execPath: process.execPath,
        })),
      )
      .toEqual({ defaultApp: false, execPath: executablePath });
    await expect
      .poll(() =>
        harness.electronApp.evaluate(({ app }) => ({
          appData: app.getPath("appData"),
          appName: app.name,
          userData: app.getPath("userData"),
        })),
      )
      .toEqual({
        appData: process.env.APPDATA,
        appName: "pi-frame",
        userData: userDataDir,
      });

    await expect
      .poll(() =>
        firstWindow.evaluate(() =>
          Boolean((window as Window & { piApp?: unknown }).piApp),
        ),
      )
      .toBe(true);
    await expect(firstWindow).toHaveTitle("pi-frame");
  } finally {
    await harness.close();
  }
});
