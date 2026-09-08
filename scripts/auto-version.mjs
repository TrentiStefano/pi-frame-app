import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

export function computeNextVersion(currentVersion, commitMessage) {
  const match = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9_.-]+)\.(\d+))?$/);
  if (!match) {
    return null;
  }

  const [_, majorStr, minorStr, patchStr, preTag, preNumStr] = match;
  const major = Number.parseInt(majorStr, 10);
  const minor = Number.parseInt(minorStr, 10);
  const patch = Number.parseInt(patchStr, 10);

  const isBreaking = /^[a-z]+(\([^)]+\))?!:/i.test(commitMessage) || /BREAKING[- ]CHANGE:/i.test(commitMessage);
  const isFeat = /^feat(\([^)]+\))?:/i.test(commitMessage);

  if (preTag && preNumStr !== undefined) {
    const preNum = Number.parseInt(preNumStr, 10);
    // In pre-release cycle: breaking changes start next minor beta, otherwise increment prerelease number
    if (isBreaking && major === 0) {
      return `${major}.${minor + 1}.0-${preTag}.1`;
    }
    return `${major}.${minor}.${patch}-${preTag}.${preNum + 1}`;
  }

  if (isBreaking) {
    return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
  }
  if (isFeat) {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

export function updateVersionInFiles(repoDir, currentVersion, nextVersion) {
  const jsonTargets = [
    path.join(repoDir, "package.json"),
    path.join(repoDir, "apps", "desktop", "package.json"),
    path.join(repoDir, "apps", "website", "package.json"),
  ];

  for (const filePath of jsonTargets) {
    if (fs.existsSync(filePath)) {
      const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
      json.version = nextVersion;
      fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
    }
  }

  const readmePath = path.join(repoDir, "README.md");
  if (fs.existsSync(readmePath)) {
    const content = fs.readFileSync(readmePath, "utf8");
    const currentBadgePattern = new RegExp(
      currentVersion.replace(/\./g, "\\.").replace(/-/g, "--"),
      "g",
    );
    const updated = content.replace(
      currentBadgePattern,
      nextVersion.replace(/-/g, "--"),
    );
    fs.writeFileSync(readmePath, updated);
  }
}

function run() {
  if (process.env.AMENDING_VERSION === "1" ||
      process.env.SKIP_VERSION_BUMP === "1" ||
      process.env.NO_VERSION_BUMP === "1") {
    return;
  }

  let gitDir;
  try {
    gitDir = execSync("git rev-parse --git-dir", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return;
  }

  // Skip during active rebase, merge, cherry-pick, or revert
  const isGitOperation = [
    "rebase-merge",
    "rebase-apply",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
  ].some((name) => fs.existsSync(path.resolve(repoRoot, gitDir, name)));

  if (isGitOperation) {
    return;
  }

  let commitMsg;
  try {
    commitMsg = execSync("git log -1 --pretty=%B", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return;
  }

  // Skip if this is already a version commit or marked to skip
  if (/^(chore\(version\)|release|chose\(version\)|merge)/i.test(commitMsg) ||
      commitMsg.includes("[skip version]") ||
      commitMsg.includes("[skip ci]")) {
    return;
  }

  const rootPkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(rootPkgPath)) {
    return;
  }
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
  const currentVersion = rootPkg.version;

  const nextVersion = computeNextVersion(currentVersion, commitMsg);
  if (!nextVersion || nextVersion === currentVersion) {
    return;
  }

  console.log(`[auto-version] Automatically bumping version: ${currentVersion} -> ${nextVersion}`);
  updateVersionInFiles(repoRoot, currentVersion, nextVersion);

  const filesToStage = [
    "package.json",
    "apps/desktop/package.json",
    "apps/website/package.json",
    "README.md",
  ];

  try {
    execFileSync("git", ["add", ...filesToStage], { cwd: repoRoot, stdio: "inherit" });
    execFileSync("git", ["commit", "--amend", "--no-edit"], {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        AMENDING_VERSION: "1",
      },
    });
  } catch (error) {
    console.error("[auto-version] Failed to amend commit with updated version:", error);
  }
}

// Run if called directly as CLI/hook
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  run();
}
