import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopTestRoot = "apps/desktop/tests";
const desktopSourceRoots = ["apps/desktop/src/", "apps/desktop/electron/"];
const broadDesktopFiles = new Set([
  "apps/desktop/electron.vite.config.mjs",
  "apps/desktop/playwright.config.ts",
  "apps/desktop/src/App.tsx",
  "apps/desktop/src/desktop-state.ts",
  "apps/desktop/src/ipc.ts",
  "apps/desktop/src/main.tsx",
  "apps/desktop/electron/app-store-internals.ts",
  "apps/desktop/electron/app-store.ts",
  "apps/desktop/electron/main.ts",
  "apps/desktop/electron/preload.ts",
]);
const desktopFeatureRules = [
  {
    pattern: /(?:^|\/)(?:i18n\/|i18n\.ts$)/,
    specs: ["apps/desktop/tests/core/settings-language.spec.ts", "apps/desktop/tests/core/smoke.spec.ts"],
  },
  {
    pattern: /(?:^|\/)(?:extension-display|extension-session-ui|extensions-view)\.tsx?$/,
    specs: [
      "apps/desktop/tests/live/extensions.spec.ts",
      "apps/desktop/tests/live/extension-dock.spec.ts",
    ],
  },
  {
    pattern: /(?:^|\/)(?:file-workbench-contexts|reviewed-files-store|syntax-highlight)\.tsx?$/,
    specs: ["apps/desktop/tests/core/review-ux.spec.ts"],
  },
  {
    pattern: /(?:^|\/)app-store-files\.ts$/,
    specs: ["apps/desktop/tests/core/mentions-diff.spec.ts", "apps/desktop/tests/core/review-ux.spec.ts"],
  },
  {
    pattern: /(?:^|\/)(?:atomic-file-write|json-file-store)\.ts$/,
    specs: ["apps/desktop/tests/core/persistence.spec.ts", "apps/desktop/tests/core/reopen-state.spec.ts"],
  },
  {
    pattern: /(?:^|\/)(?:secondary-surfaces|secondary-surface|dialog-focus)\.tsx?$/,
    specs: ["apps/desktop/tests/core/multi-window.spec.ts"],
  },
  {
    pattern: /(?:^|\/)keyboard-shortcuts\.ts$/,
    specs: [
      "apps/desktop/tests/core/composer-controls.spec.ts",
      "apps/desktop/tests/core/sidebar-toggle.spec.ts",
      "apps/desktop/tests/core/thread-menu.spec.ts",
    ],
  },
  {
    pattern: /(?:^|\/)topbar\.tsx$/,
    specs: ["apps/desktop/tests/core/composer-controls.spec.ts", "apps/desktop/tests/core/context-rail.spec.ts"],
  },
  {
    pattern: /(?:^|\/)(?:theme-manager|settings-appearance-section)\.tsx?$/,
    specs: ["apps/desktop/tests/core/settings-appearance.spec.ts"],
  },
  {
    pattern: /(?:^|\/)update-service\.ts$/,
    specs: ["apps/desktop/tests/core/settings-general.spec.ts"],
  },
  {
    pattern: /(?:^|\/)session-visibility\.ts$/,
    specs: ["apps/desktop/tests/core/multi-window.spec.ts", "apps/desktop/tests/core/unread-state.spec.ts"],
  },
  {
    pattern: /(?:^|\/)use-running-label\.ts$/,
    specs: ["apps/desktop/tests/core/timeline-pinning.spec.ts"],
  },
  {
    pattern: /(?:^|\/)computer-use-bundle\.mjs$/,
    specs: ["apps/desktop/tests/live/computer-use.spec.ts"],
  },
  {
    pattern: /(?:^|\/)(?:styles(?:\/|\.css$)|icons\.tsx$|string-utils\.ts$|.*\.d\.ts$)/,
    specs: [
      "apps/desktop/tests/core/smoke.spec.ts",
      "apps/desktop/tests/core/message-wrapping.spec.ts",
      "apps/desktop/tests/core/context-rail.spec.ts",
    ],
  },
];
const ignoredTokens = new Set([
  "app",
  "desktop",
  "electron",
  "main",
  "manager",
  "panel",
  "renderer",
  "service",
  "store",
  "utils",
  "view",
]);

export function createChangedTestPlan(changedFiles, availableDesktopSpecs = listDesktopSpecs()) {
  const files = [...new Set(changedFiles.map(normalizePath).filter(Boolean))];
  const commands = [];
  const desktopSpecs = new Set();
  let desktopChanged = false;
  let voiceRuntimeChanged = false;
  let runDesktopCore = false;
  let runPiSdkDriver = false;

  for (const file of files) {
    if (file === "apps/desktop/electron/app-store.flush.test.ts") {
      commands.push({
        label: "desktop app-store unit test",
        args: ["--filter", "@pi-frame/desktop", "run", "test:unit:app-store"],
      });
      continue;
    }
    if (broadDesktopFiles.has(file)) {
      desktopChanged = true;
      runDesktopCore = true;
      continue;
    }

    if (file.startsWith(`${desktopTestRoot}/`)) {
      desktopChanged = true;
      if (file.endsWith(".spec.ts")) {
        desktopSpecs.add(file);
      } else if (file.startsWith(`${desktopTestRoot}/helpers/`)) {
        runDesktopCore = true;
      } else {
        const lane = file.split("/")[3];
        availableDesktopSpecs
          .filter((spec) => spec.startsWith(`${desktopTestRoot}/${lane}/`))
          .forEach((spec) => desktopSpecs.add(spec));
      }
      continue;
    }

    if (desktopSourceRoots.some((root) => file.startsWith(root))) {
      desktopChanged = true;
      const matches = matchDesktopSpecs(file, availableDesktopSpecs);
      if (matches.length === 0) {
        runDesktopCore = true;
      } else {
        matches.forEach((spec) => desktopSpecs.add(spec));
      }
      if (/voice-recognition-(service|worker)\.ts$/.test(file)) {
        voiceRuntimeChanged = true;
        desktopSpecs.add("apps/desktop/tests/core/voice-input.spec.ts");
      }
      continue;
    }

    if (file === "apps/desktop/electron-builder.yml") {
      desktopChanged = true;
      if (file === "apps/desktop/electron-builder.yml") {
        voiceRuntimeChanged = true;
      }
      desktopSpecs.add("apps/desktop/tests/core/smoke.spec.ts");
      continue;
    }

    if (file === "apps/desktop/package.json") {
      runDesktopCore = true;
      desktopChanged = true;
      continue;
    }

    if (file.startsWith("packages/pi-sdk-driver/")) {
      runPiSdkDriver = true;
      continue;
    }

    if (file.startsWith("packages/session-driver/") || file.startsWith("packages/catalogs/")) {
      commands.push({
        label: `typecheck ${file.split("/").slice(0, 2).join("/")}`,
        args: ["--filter", file.startsWith("packages/session-driver/") ? "@pi-frame/session-driver" : "@pi-frame/catalogs", "typecheck"],
      });
      continue;
    }

    if (file === "scripts/test-changed.mjs" || /^scripts\/.*\.test\.mjs$/.test(file)) {
      const testFile = file === "scripts/test-changed.mjs" ? "scripts/test-changed.test.mjs" : file;
      commands.push({ label: `node test ${testFile}`, executable: process.execPath, args: ["--test", testFile] });
      continue;
    }

    if (isGlobalTestConfig(file)) {
      desktopChanged = true;
      runDesktopCore = true;
      runPiSdkDriver = true;
    }
  }

  if (runPiSdkDriver) {
    commands.push({ label: "pi-sdk-driver tests", args: ["--filter", "@pi-frame/pi-sdk-driver", "test"] });
  }

  if (desktopChanged) {
    if (voiceRuntimeChanged) {
      commands.push({
        label: "prepare voice model",
        args: ["--filter", "@pi-frame/desktop", "run", "prepare:voice-model"],
      });
    }
    commands.push({ label: "desktop build", args: ["--filter", "@pi-frame/desktop", "build"] });
    if (voiceRuntimeChanged) {
      commands.push({
        label: "offline voice model",
        executable: process.execPath,
        args: ["apps/desktop/scripts/verify-voice-model.mjs"],
      });
    }
    if (runDesktopCore) {
      commands.push({
        label: "desktop core lane",
        args: ["exec", "playwright", "test", "-c", "apps/desktop/playwright.config.ts", "apps/desktop/tests/core"],
        env: { PI_APP_TEST_MODE: "background" },
      });
    } else if (desktopSpecs.size > 0) {
      const specsByLane = Map.groupBy([...desktopSpecs].sort(), (spec) => spec.split("/")[3]);
      for (const [lane, specs] of specsByLane) {
        commands.push({
          label: `desktop ${lane}: ${specs.map((spec) => path.basename(spec)).join(", ")}`,
          args: ["exec", "playwright", "test", "-c", "apps/desktop/playwright.config.ts", ...specs],
          env: { PI_APP_TEST_MODE: lane === "native" ? "foreground" : "background" },
        });
      }
    }
  }

  return deduplicateCommands(commands);
}

export function matchCoreSpecs(file, availableCoreSpecs) {
  return matchDesktopSpecs(file, availableCoreSpecs);
}

export function matchDesktopSpecs(file, availableDesktopSpecs) {
  const available = new Set(availableDesktopSpecs);
  const explicitMatches = desktopFeatureRules
    .filter((rule) => rule.pattern.test(file))
    .flatMap((rule) => rule.specs)
    .filter((spec) => available.has(spec));
  if (explicitMatches.length > 0) {
    return [...new Set(explicitMatches)];
  }

  const tokens = tokenize(path.basename(file, path.extname(file)));
  if (tokens.size === 0) {
    return [];
  }
  return availableDesktopSpecs.filter((spec) => {
    const specTokens = tokenize(path.basename(spec, ".spec.ts"));
    return [...tokens].some((token) => specTokens.has(token));
  });
}

function tokenize(value) {
  return new Set(
    value
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !ignoredTokens.has(token)),
  );
}

function listDesktopSpecs() {
  const directory = path.join(repoDir, "apps", "desktop", "tests");
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => readdirSync(path.join(directory, entry.name))
      .filter((name) => name.endsWith(".spec.ts"))
      .map((name) => `apps/desktop/tests/${entry.name}/${name}`));
}

function isGlobalTestConfig(file) {
  return ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "playwright.config.ts"].includes(file);
}

function deduplicateCommands(commands) {
  const seen = new Set();
  return commands.filter((command) => {
    const key = JSON.stringify([command.executable, command.args, command.env]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizePath(file) {
  return file.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function readChangedFiles() {
  const tracked = runGit(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"]);
  return [...tracked, ...untracked];
}

function runGit(args) {
  const result = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function runCommand(command) {
  const executable = command.executable ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
  console.log(`\n[test:changed] ${command.label}`);
  const result = spawnSync(executable, command.args, {
    cwd: repoDir,
    env: { ...process.env, ...command.env },
    stdio: "inherit",
    shell: process.platform === "win32" && executable.endsWith(".cmd"),
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const listOnly = process.argv.includes("--list");
  const changedFiles = readChangedFiles();
  console.log(`[test:changed] ${changedFiles.length} changed file(s)`);
  const plan = createChangedTestPlan(changedFiles);
  if (plan.length === 0) {
    console.log("[test:changed] No tests are mapped to the current changes.");
    return;
  }
  for (const command of plan) {
    console.log(`[test:changed] -> ${command.label}`);
  }
  if (!listOnly) {
    plan.forEach(runCommand);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
