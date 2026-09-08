"use strict";

const path = require("node:path");

function sanitizeSegment(segment) {
  if (!segment) return "";
  let clean = segment.trim();
  while (
    (clean.startsWith("'") && clean.endsWith("'")) ||
    (clean.startsWith('"') && clean.endsWith('"'))
  ) {
    clean = clean.slice(1, -1).trim();
  }
  return clean.replace(/^['"]+|['"]+$/g, "").trim();
}

/**
 * Add common CLI locations for Finder/Dock launches on macOS and Node/Git CLI locations
 * on Windows. Sanitizes malformed quotes in PATH entries so child process spawning
 * succeeds reliably on Windows.
 *
 * @param {{ platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, delimiter?: string }} [options]
 * @returns {{ changed: boolean, path: string }}
 */
function augmentMacPath(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const delimiter = options.delimiter ?? path.delimiter;
  const currentPath = env.PATH ?? "";

  const extraBinPaths = [];
  if (platform === "darwin") {
    extraBinPaths.push(
      "/usr/local/bin",
      env.HOME ? `${env.HOME}/.npm-global/bin` : undefined,
    );
  } else if (platform === "win32") {
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA || (env.USERPROFILE ? `${env.USERPROFILE}\\AppData\\Local` : undefined);
    const appData = env.APPDATA || (env.USERPROFILE ? `${env.USERPROFILE}\\AppData\\Roaming` : undefined);

    // Node.js CLI locations
    if (env.NVM_SYMLINK) extraBinPaths.push(env.NVM_SYMLINK);
    if (env.NVM_HOME) extraBinPaths.push(env.NVM_HOME);
    extraBinPaths.push(
      path.join(programFiles, "nodejs"),
      path.join(programFilesX86, "nodejs"),
      "C:\\nvm4w\\nodejs",
      appData ? path.join(appData, "npm") : undefined,
      localAppData ? path.join(localAppData, "Programs", "node") : undefined,
    );

    // Git CLI locations
    extraBinPaths.push(
      path.join(programFiles, "Git", "cmd"),
      path.join(programFiles, "Git", "bin"),
      path.join(programFilesX86, "Git", "cmd"),
      path.join(programFilesX86, "Git", "bin"),
      localAppData ? path.join(localAppData, "Programs", "Git", "cmd") : undefined,
      localAppData ? path.join(localAppData, "Programs", "Git", "bin") : undefined,
    );
  } else {
    return { changed: false, path: currentPath };
  }

  const rawPaths = currentPath.split(delimiter).filter(Boolean);
  const sanitizedPaths = platform === "win32"
    ? rawPaths.map(sanitizeSegment).filter(Boolean)
    : rawPaths;
  const existingPaths = new Set(
    sanitizedPaths.map((p) => (platform === "win32" ? p.toLowerCase() : p))
  );

  const missingPaths = [];
  for (const candidate of extraBinPaths) {
    if (!candidate) continue;
    const sanitized = platform === "win32" ? sanitizeSegment(candidate) : candidate;
    if (!sanitized) continue;
    const key = platform === "win32" ? sanitized.toLowerCase() : sanitized;
    if (!existingPaths.has(key)) {
      existingPaths.add(key);
      missingPaths.push(sanitized);
    }
  }

  const finalPaths = [...missingPaths, ...sanitizedPaths];
  const newPath = finalPaths.join(delimiter);

  if (newPath === currentPath) {
    return { changed: false, path: currentPath };
  }

  return {
    changed: true,
    path: newPath,
  };
}

module.exports = { augmentMacPath };
