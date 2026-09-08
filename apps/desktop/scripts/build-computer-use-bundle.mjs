import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(desktopDir, "..", "..", "node_modules", "@injaneity", "pi-computer-use");
const entry = path.join(packageRoot, "extensions", "computer-use.ts");
const outfile = path.join(desktopDir, "electron", "computer-use-bundle.mjs");
const piShim = path.join(desktopDir, "scripts", "computer-use-pi-shim.mjs");

if (process.platform === "win32") {
  const prebuiltDir = path.join(packageRoot, "prebuilt", "windows");
  await mkdir(prebuiltDir, { recursive: true });
  await copyFile(
    path.join(desktopDir, "resources", "computer-use", "windows-bridge.exe"),
    path.join(prebuiltDir, "windows-bridge.exe"),
  );
}

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  outfile,
  alias: {
    "@earendil-works/pi-coding-agent": piShim,
  },
  external: ["typebox"],
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  logLevel: "warning",
});

let bundle = await readFile(outfile, "utf8");
// The upstream helper resolves assets relative to its package. After bundling,
// import.meta.url points at out/main, so resolve the installed package instead.
bundle = replaceRequired(bundle,
  /path(\d+)\.resolve\(path\d+\.dirname\(fileURLToPath\d*\(import\.meta\.url\)\), "\.\."\, "\.\."\, "\.\."\)/g,
  (_match, pathId) => `path${pathId}.dirname(require.resolve("@injaneity/pi-computer-use/package.json"))`,
  "package asset roots",
);
bundle = replaceRequired(bundle,
  /var WINDOWS_HELPER_PATH = (path\d+)\.join\((os\d+)\.homedir\(\), "\.pi", "agent", "helpers", "pi-computer-use", "windows-bridge\.exe"\);/,
  (_match, pathId, osId) => `var PACKAGED_WINDOWS_HELPER_PATH = ${pathId}.join(process.resourcesPath ?? "", "computer-use", "windows-bridge.exe");
var WINDOWS_HELPER_PATH = process.env.PI_COMPUTER_USE_WINDOWS_HELPER_PATH || (require("node:fs").existsSync(PACKAGED_WINDOWS_HELPER_PATH) ? PACKAGED_WINDOWS_HELPER_PATH : ${pathId}.join(${osId}.homedir(), ".pi", "agent", "helpers", "pi-computer-use", "windows-bridge.exe"));`,
  "packaged Windows helper path",
);
bundle = replaceRequired(bundle,
  /if \(await (isExecutable\d*)\(WINDOWS_HELPER_PATH\) && this\.installChecked\) return;/,
  (_match, executableFunction) => `if (await ${executableFunction}(WINDOWS_HELPER_PATH) && (this.installChecked || WINDOWS_HELPER_PATH === PACKAGED_WINDOWS_HELPER_PATH)) {
      this.installChecked = true;
      return;
    }`,
  "packaged Windows helper readiness",
);
// Do not install or launch a native helper while a session is being rebound.
// Each tool already calls ensureReady before doing work, so setup stays lazy
// and enabling the setting remains responsive.
bundle = replaceRequired(bundle,
  /\s*if \(!ctx\.hasUI\) return;\s*try \{\s*await ensureComputerUseSetup\(ctx\);\s*\} catch \(error\) \{\s*ctx\.ui\.notify\(error instanceof Error \? error\.message : String\(error\), "warning"\);\s*\}/,
  "",
  "lazy session setup",
);
bundle = bundle.replace(/import \{ fileURLToPath(?: as fileURLToPath\d+)? \} from "node:url";\r?\n/g, "");
await writeFile(outfile, bundle, "utf8");

function replaceRequired(source, pattern, replacement, label) {
  let matches = 0;
  const next = source.replace(pattern, (...args) => {
    matches += 1;
    return typeof replacement === "function" ? replacement(...args) : replacement;
  });
  if (matches === 0) throw new Error(`Computer Use bundle patch did not match: ${label}`);
  return next;
}
