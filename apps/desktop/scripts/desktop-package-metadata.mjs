import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopPackage = JSON.parse(readFileSync(path.resolve(scriptDir, "..", "package.json"), "utf8"));

export const computerUsePackageName = "@injaneity/pi-computer-use";
export const computerUseVersion = requiredDependencyVersion(computerUsePackageName);

function requiredDependencyVersion(packageName) {
  const version = desktopPackage.dependencies?.[packageName];
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Desktop dependency ${packageName} must use an exact version; received ${String(version)}.`);
  }
  return version;
}
