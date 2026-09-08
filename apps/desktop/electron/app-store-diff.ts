import { execFile } from "node:child_process";
import type { ChangedFileEntry } from "../src/ipc";
import { resolveWorkspacePath } from "./workspace-paths";

const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

function cleanPathString(p: string): string {
  return p.trim().replace(/^"|"$/g, "").replace(/\\/g, "/");
}

export function getChangedFiles(workspacePath: string): Promise<ChangedFileEntry[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain", "-z"],
      { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024, timeout: 10_000 },
      (error, stdout) => {
        if (error) {
          // Fallback without -z if git version is old
          execFile(
            "git",
            ["status", "--porcelain"],
            { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024, timeout: 10_000 },
            (fallbackError, fallbackStdout) => {
              if (fallbackError) {
                resolve([]);
                return;
              }
              const entries: ChangedFileEntry[] = [];
              for (const line of fallbackStdout.split("\n")) {
                if (!line.trim()) continue;
                const xy = line.slice(0, 2);
                let filePath = line.slice(3).trim();
                const renameArrow = filePath.indexOf(" -> ");
                if (renameArrow >= 0) {
                  filePath = filePath.slice(renameArrow + 4);
                }
                entries.push({
                  path: cleanPathString(filePath),
                  status: parseStatus(xy),
                  staged: isFullyStaged(xy),
                });
              }
              resolve(entries);
            },
          );
          return;
        }

        const entries: ChangedFileEntry[] = [];
        const items = stdout.split("\0");
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          if (!item || item.length < 3) {
            continue;
          }
          const xy = item.slice(0, 2);
          const status = parseStatus(xy);
          let filePath = item.slice(3);
          if (xy[0] === "R" || xy[0] === "C" || xy[1] === "R" || xy[1] === "C") {
            const nextPath = items[i + 1];
            if (nextPath) {
              filePath = nextPath;
              i += 1;
            }
          }
          entries.push({
            path: cleanPathString(filePath),
            status,
            staged: isFullyStaged(xy),
          });
        }
        resolve(entries);
      },
    );
  });
}

export function getFileDiff(workspacePath: string, filePath: string): Promise<string> {
  const cleanPath = cleanPathString(filePath);
  resolveWorkspacePath(workspacePath, cleanPath);
  return new Promise((resolve) => {
    execFile(
      "git",
      ["diff", "--", cleanPath],
      { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024, timeout: 10_000 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          // Try staged diff
          execFile(
            "git",
            ["diff", "--cached", "--", cleanPath],
            { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024, timeout: 10_000 },
            (error2, stdout2) => {
              if (!error2 && stdout2.trim()) {
                resolve(stdout2);
                return;
              }
              // Untracked file — show content as all-additions diff
              execFile(
                "git",
                ["diff", "--no-index", "--", NULL_DEVICE, cleanPath],
                { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024, timeout: 10_000 },
                (_error3, stdout3) => {
                  // git diff --no-index exits 1 when files differ, which is expected
                  resolve(stdout3 || "");
                },
              );
            },
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export function stageFile(workspacePath: string, filePath: string): Promise<void> {
  const cleanPath = cleanPathString(filePath);
  resolveWorkspacePath(workspacePath, cleanPath);
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["add", "--", cleanPath],
      { cwd: workspacePath, timeout: 10_000 },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}

function parseStatus(xy: string): ChangedFileEntry["status"] {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";

  if (x === "?" && y === "?") {
    return "untracked";
  }
  if (x === "A" || y === "A") {
    return "added";
  }
  if (x === "D" || y === "D") {
    return "deleted";
  }
  return "modified";
}

function isFullyStaged(xy: string): boolean {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";
  if (x === "?" || x === " ") return false;
  return y === " ";
}
