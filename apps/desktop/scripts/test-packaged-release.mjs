import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const platform = process.argv[2];
if (!new Set(["linux", "windows"]).has(platform)) {
  throw new Error("Usage: node scripts/test-packaged-release.mjs <linux|windows>");
}

const releaseDir = join(process.cwd(), "release");
await access(releaseDir);
const unpackedName = platform === "windows" ? "win-unpacked" : "linux-unpacked";
const executableName = platform === "windows" ? "pi-frame.exe" : "pi-frame";
const executable = join(releaseDir, unpackedName, executableName);
await access(executable);

const specs = platform === "windows"
  ? [
      "apps/desktop/tests/production/packaged-smoke.spec.ts",
      "apps/desktop/tests/production/packaged-terminal.spec.ts",
      "apps/desktop/tests/production/notification-settings-packaged.spec.ts",
    ]
  : [
      "apps/desktop/tests/production/packaged-smoke.spec.ts",
      "apps/desktop/tests/production/packaged-terminal.spec.ts",
    ];

const pnpmInvocation = await resolvePnpmInvocation();
const child = spawn(pnpmInvocation.command, [
  ...pnpmInvocation.args,
  "--dir", "../..", "exec", "playwright", "test",
  "-c", "apps/desktop/playwright.config.ts",
  ...specs,
], {
  cwd: process.cwd(),
  env: { ...process.env, PI_APP_TEST_MODE: "background" },
  stdio: "inherit",
  // Do not pass a .cmd shim as the executable on Windows. Launching the local
  // pnpm JavaScript entrypoint through Node avoids EINVAL from spawn in CI.
});
child.on("error", (error) => { throw error; });
const exitCode = await new Promise((resolve) => child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Packaged ${platform} tests terminated by ${signal}`);
    resolve(1);
  } else {
    resolve(code ?? 1);
  }
}));
process.exit(exitCode);

async function resolvePnpmInvocation() {
  if (process.platform !== "win32") return { command: "pnpm", args: [] };

  const localPnpm = join(process.cwd(), "..", "..", "node_modules", "pnpm", "bin", "pnpm.cjs");
  try {
    await access(localPnpm);
    return { command: process.execPath, args: [localPnpm] };
  } catch {
    const npmExecPath = process.env.npm_execpath;
    if (npmExecPath) {
      await access(npmExecPath);
      return { command: process.execPath, args: [npmExecPath] };
    }
    throw new Error(`Local pnpm entrypoint not found at ${localPnpm}`);
  }
}
