import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage } from "@electron/asar";
import { computerUsePackageName, computerUseVersion } from "./desktop-package-metadata.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const releaseDir = path.resolve(desktopDir, process.env.PI_APP_TEST_RELEASE_DIR?.trim() || "release");
const unpackedDir = readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^win(?:-[\w]+)?-unpacked$/.test(entry.name))
  .map((entry) => path.join(releaseDir, entry.name))
  .find((candidate) => existsSync(path.join(candidate, "resources", "app.asar")));

if (!unpackedDir) {
  throw new Error(`Packaged Windows app was not found under ${releaseDir}.`);
}

const resourcesDir = path.join(unpackedDir, "resources");
const asarPath = path.join(resourcesDir, "app.asar");
const helperPath = path.join(resourcesDir, "computer-use", "windows-bridge.exe");
const sourceHelperPath = path.join(desktopDir, "resources", "computer-use", "windows-bridge.exe");
const packageRoot = "node_modules/@injaneity/pi-computer-use";
const entries = new Set(listPackage(asarPath).map((entry) => entry.replace(/^[/\\]/, "").replaceAll("\\", "/")));

for (const requiredPath of [
  `${packageRoot}/package.json`,
  `${packageRoot}/scripts/setup-helper.mjs`,
  "out/main/main.js",
]) {
  if (!entries.has(requiredPath)) {
    throw new Error(`Packaged app.asar is missing ${requiredPath}.`);
  }
}

const packageJson = JSON.parse(extract(`${packageRoot}/package.json`).toString("utf8"));
if (packageJson.version !== computerUseVersion) {
  throw new Error(`Packaged ${computerUsePackageName} version is ${packageJson.version}; expected ${computerUseVersion}.`);
}
if (!existsSync(helperPath)) {
  throw new Error(`Packaged Windows helper is missing at ${helperPath}.`);
}

const sourceHash = sha256(sourceHelperPath);
const packagedHash = sha256(helperPath);
if (packagedHash !== sourceHash) {
  throw new Error(`Packaged Windows helper hash ${packagedHash} does not match source ${sourceHash}.`);
}

const mainBundle = extract("out/main/main.js").toString("utf8");
if (!mainBundle.includes("computer-use") || !mainBundle.includes("windows-bridge.exe")) {
  throw new Error("Packaged main process does not contain the Computer Use runtime path.");
}

const requestId = "packaged-computer-use-diagnostics";
const diagnostics = spawnSync(helperPath, [], {
  input: `${JSON.stringify({ protocolVersion: 4, id: requestId, cmd: "diagnostics", args: {} })}\n`,
  encoding: "utf8",
  timeout: 15_000,
  windowsHide: true,
});
if (diagnostics.error) {
  throw diagnostics.error;
}
if (diagnostics.status !== 0) {
  throw new Error(`Packaged Windows helper exited ${diagnostics.status}: ${diagnostics.stderr.trim()}`);
}
const response = diagnostics.stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .find((entry) => entry.id === requestId);
if (!response?.ok || response.protocolVersion !== 4 || response.result?.protocolVersion !== 4) {
  throw new Error(`Packaged Windows helper diagnostics failed: ${JSON.stringify(response)}`);
}

console.log(
  `Verified packaged Computer Use ${packageJson.version}: helper ${packagedHash}, protocol ${response.result.protocolVersion}.`,
);

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function extract(logicalPath) {
  return extractFile(asarPath, logicalPath.replaceAll("/", path.sep));
}
