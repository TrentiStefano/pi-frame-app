import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import semver from "semver";

const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

export interface CoreUpdateSnapshot {
  readonly checkedAt: string;
  readonly app: {
    readonly currentVersion: string;
    readonly latestVersion?: string;
    readonly updateAvailable: boolean;
    readonly canInstall: boolean;
    readonly checkError?: "release-metadata-unavailable" | "unavailable";
  };
  readonly pi: {
    readonly currentVersion: string;
    readonly latestVersion?: string;
    readonly updateAvailable: boolean;
  };
}

export class UpdateService {
  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = true;
  }

  async check(): Promise<CoreUpdateSnapshot> {
    const currentPiVersion = await readBundledPiVersion();
    const testFixture = process.env.PI_APP_TEST_UPDATE_FIXTURE;
    if (testFixture === "1") {
      return {
        checkedAt: new Date().toISOString(),
        app: {
          currentVersion: app.getVersion(),
          latestVersion: "99.0.0",
          updateAvailable: true,
          canInstall: false,
        },
        pi: {
          currentVersion: currentPiVersion,
          latestVersion: "99.0.0",
          updateAvailable: true,
        },
      };
    }

    const [appUpdate, latestPiVersion] = await Promise.all([
      this.checkAppUpdate(),
      fetchLatestPiVersion(),
    ]);
    return {
      checkedAt: new Date().toISOString(),
      app: appUpdate,
      pi: {
        currentVersion: currentPiVersion,
        latestVersion: latestPiVersion,
        updateAvailable: semver.gt(latestPiVersion, currentPiVersion),
      },
    };
  }

  async installAppUpdate(): Promise<void> {
    if (!app.isPackaged) {
      throw new Error("Application updates can only be installed from a packaged build.");
    }
    await autoUpdater.downloadUpdate();
    autoUpdater.quitAndInstall(false, true);
  }

  private async checkAppUpdate(): Promise<CoreUpdateSnapshot["app"]> {
    const currentVersion = app.getVersion();
    if (process.env.PI_APP_TEST_UPDATE_FIXTURE === "release-metadata-unavailable") {
      return applicationUpdateFailure(currentVersion, new Error("Cannot find latest.yml in the latest release artifacts"));
    }
    if (!app.isPackaged) {
      return { currentVersion, updateAvailable: false, canInstall: false };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      const latestVersion = result?.updateInfo.version;
      return {
        currentVersion,
        ...(latestVersion ? { latestVersion } : {}),
        updateAvailable: Boolean(latestVersion && semver.gt(latestVersion, currentVersion)),
        canInstall: true,
      };
    } catch (error) {
      console.warn("[update-service] application update check failed", error);
      return applicationUpdateFailure(currentVersion, error);
    }
  }
}

function applicationUpdateFailure(currentVersion: string, error: unknown): CoreUpdateSnapshot["app"] {
  return {
    currentVersion,
    updateAvailable: false,
    canInstall: false,
    checkError: isMissingReleaseMetadataError(error) ? "release-metadata-unavailable" : "unavailable",
  };
}

function isMissingReleaseMetadataError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Cannot find (?:latest(?:-[^\s/]+)?\.yml|channel file)/i.test(message);
}

async function readBundledPiVersion(): Promise<string> {
  let directory = app.getAppPath();
  for (;;) {
    const packageJsonPath = join(directory, "node_modules", ...PI_PACKAGE_NAME.split("/"), "package.json");
    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { readonly version?: string };
      if (packageJson.version && semver.valid(packageJson.version)) {
        return packageJson.version;
      }
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Bundled ${PI_PACKAGE_NAME} package was not found.`);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function fetchLatestPiVersion(): Promise<string> {
  if (process.env.PI_APP_TEST_UPDATE_FIXTURE === "release-metadata-unavailable") {
    return "99.0.0";
  }
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PI_PACKAGE_NAME)}/latest`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Pi update check failed with HTTP ${response.status}.`);
  }
  const data = await response.json() as { readonly version?: string };
  if (!data.version || !semver.valid(data.version)) {
    throw new Error("Pi update registry returned an invalid version.");
  }
  return data.version;
}
