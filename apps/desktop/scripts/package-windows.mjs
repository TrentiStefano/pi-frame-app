import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(desktopDir, "..", "..");
const toolsDir = path.join(repoDir, "tools");
const cacheRoot = path.join(repoDir, ".cache");
const windowsBuilderConfig = path.join(desktopDir, "electron-builder.windows.yml");

const electronBuilderArgs = process.argv.slice(2);
if (electronBuilderArgs.length === 0) {
  throw new Error("Usage: package-windows.mjs <electron-builder args...>");
}

// electron-builder wraps pnpm.cmd in a temporary .bat file. On Windows locales that use a
// non-UTF-8 code page, paths under a non-ASCII %USERPROFILE% are corrupted and pnpm list fails
// with "The system cannot find the path specified." Prefer the ASCII repo-local shim first.
const pathPrefix = [toolsDir, path.join(repoDir, "node_modules", ".bin")];
const envPath = [...pathPrefix, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter);

const electronBuilderCache = process.env.ELECTRON_BUILDER_CACHE ?? path.join(cacheRoot, "electron-builder");
const localAppData = process.env.LOCALAPPDATA ?? path.join(cacheRoot, "localappdata");
const electronMirror = process.env.ELECTRON_MIRROR?.trim() || "https://npmmirror.com/mirrors/electron/";
const builderBinariesMirror =
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR?.trim() ||
  "https://npmmirror.com/mirrors/electron-builder-binaries/";
mkdirSync(electronBuilderCache, { recursive: true });
mkdirSync(localAppData, { recursive: true });

const pnpmBinary = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const childEnv = {
  ...process.env,
  PATH: envPath,
  ELECTRON_BUILDER_CACHE: electronBuilderCache,
  ELECTRON_BUILDER_BINARIES_MIRROR: builderBinariesMirror,
  ELECTRON_MIRROR: electronMirror,
  LOCALAPPDATA: localAppData,
  COREPACK_ENABLE_STRICT: "0",
};

function runPnpm(args, cwd) {
  const result = spawnSync(pnpmBinary, args, {
    cwd,
    stdio: "inherit",
    env: childEnv,
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const error = new Error(`pnpm exited with status ${result.status ?? "unknown"}`);
    error.exitStatus = result.status ?? (result.signal ? 1 : 0);
    throw error;
  }
}

// electron-builder 26's pnpm dependency hoister can spend many minutes at
// "searching for node modules" on Windows. A deploy gives it a self-contained,
// link-free production tree which the Windows config copies without re-hoisting.
const workspaceDir = mkdtempSync(path.join(cacheRoot, "windows-workspace-"));
const stagingDir = mkdtempSync(path.join(cacheRoot, "windows-app-"));

function copyIntoWorkspace(relativePath) {
  const destination = path.join(workspaceDir, relativePath);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(path.join(repoDir, relativePath), destination, { recursive: true });
}

let succeeded = false;
try {
  for (const relativePath of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "apps/desktop/package.json",
    "apps/desktop/out",
    "packages/session-driver/package.json",
    "packages/session-driver/dist",
    "packages/pi-sdk-driver/package.json",
    "packages/pi-sdk-driver/dist",
    "packages/catalogs/package.json",
    "packages/catalogs/dist",
  ]) {
    copyIntoWorkspace(relativePath);
  }

  console.log(`Preparing a filtered Windows lockfile in ${workspaceDir}`);
  runPnpm(
    [
      "--dir",
      workspaceDir,
      "--config.inject-workspace-packages=true",
      "install",
      "--lockfile-only",
      "--no-frozen-lockfile",
    ],
    workspaceDir,
  );

  console.log(`Preparing Windows production dependencies in ${stagingDir}`);
  runPnpm(
    [
      "--dir",
      workspaceDir,
      "--config.inject-workspace-packages=true",
      "--config.node-linker=hoisted",
      "--filter",
      "@pi-frame/desktop",
      "deploy",
      "--prod",
      stagingDir,
    ],
    workspaceDir,
  );

  runPnpm(
    [
      "exec",
      "electron-builder",
      "--config",
      windowsBuilderConfig,
      ...electronBuilderArgs,
      `--config.directories.app=${stagingDir}`,
    ],
    desktopDir,
  );
  succeeded = true;
} catch (error) {
  if (typeof error?.exitStatus === "number") {
    process.exitCode = error.exitStatus;
  } else {
    throw error;
  }
} finally {
  if (succeeded) {
    rmSync(stagingDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  } else {
    console.error(`Windows packaging staging preserved for diagnosis: ${stagingDir}`);
    console.error(`Windows packaging workspace preserved for diagnosis: ${workspaceDir}`);
  }
}
