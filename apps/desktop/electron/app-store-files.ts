import { execFile } from "node:child_process";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspaceFilePreview } from "../src/ipc";
import { resolveExistingWorkspacePath } from "./workspace-paths";

const fileCache = new Map<string, { files: string[]; timestamp: number }>();
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 20;
const MAX_PREVIEW_BYTES = 200 * 1024;

const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".cache",
  ".next",
  ".nuxt",
  ".turbo",
  ".output",
  "dist",
  "out",
  "build",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".tmp",
  "coverage",
  ".idea",
  ".vscode",
  ".ds_store",
]);

async function walkFilesystem(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  const maxFiles = 10_000;

  async function walk(currentDir: string, relativePrefix: string) {
    if (results.length >= maxFiles) return;
    try {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxFiles) break;
        const name = entry.name;
        const normalizedName = name.toLowerCase();

        if (entry.isDirectory()) {
          if (DEFAULT_IGNORED_DIRS.has(normalizedName) || name.startsWith(".")) {
            continue;
          }
          const subRel = relativePrefix ? `${relativePrefix}/${name}` : name;
          const subAbs = join(currentDir, name);
          await walk(subAbs, subRel);
        } else if (entry.isFile()) {
          if (DEFAULT_IGNORED_DIRS.has(normalizedName) || name === ".DS_Store" || name === "thumbs.db") {
            continue;
          }
          const fileRel = relativePrefix ? `${relativePrefix}/${name}` : name;
          results.push(fileRel.replace(/\\/g, "/"));
        }
      }
    } catch {
      // Ignore unreadable subdirectories
    }
  }

  await walk(rootDir, "");
  return results.sort();
}

function updateFileCache(workspacePath: string, files: string[]): string[] {
  if (fileCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = fileCache.keys().next().value;
    if (oldest !== undefined) {
      fileCache.delete(oldest);
    }
  }
  fileCache.set(workspacePath, { files, timestamp: Date.now() });
  return files;
}

export function listWorkspaceFiles(workspacePath: string, options: { readonly force?: boolean } = {}): Promise<string[]> {
  const cached = fileCache.get(workspacePath);
  if (!options.force && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return Promise.resolve(cached.files);
  }

  return new Promise((resolve) => {
    execFile(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: workspacePath, maxBuffer: 10 * 1024 * 1024 },
      async (error, stdout) => {
        if (error) {
          const fallbackFiles = await walkFilesystem(workspacePath);
          resolve(updateFileCache(workspacePath, fallbackFiles));
          return;
        }
        const rawFiles = stdout
          .split("\0")
          .map((line) => line.trim().replace(/^"|"$/g, "").replace(/\\/g, "/"))
          .filter(Boolean);
        
        let files = Array.from(new Set(rawFiles)).sort();
        if (files.length === 0) {
          const fallbackFiles = await walkFilesystem(workspacePath);
          if (fallbackFiles.length > 0) {
            files = fallbackFiles;
          }
        }
        resolve(updateFileCache(workspacePath, files));
      },
    );
  });
}

export async function readWorkspaceFile(workspacePath: string, filePath: string): Promise<WorkspaceFilePreview> {
  const resolved = await resolveExistingWorkspacePath(workspacePath, filePath);
  const handle = await open(resolved, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      return {
        path: filePath,
        content: "",
        truncated: false,
        binary: true,
        sizeBytes: stats.size,
      };
    }

    const readLength = Math.min(stats.size, MAX_PREVIEW_BYTES + 1);
    const buffer = Buffer.alloc(readLength);
    const { bytesRead } = await handle.read(buffer, 0, readLength, 0);
    const previewBytes = buffer.subarray(0, Math.min(bytesRead, MAX_PREVIEW_BYTES));
    const binary = previewBytes.includes(0);

    return {
      path: filePath,
      content: binary ? "" : new TextDecoder("utf-8", { fatal: false }).decode(previewBytes),
      truncated: bytesRead > MAX_PREVIEW_BYTES || stats.size > MAX_PREVIEW_BYTES,
      binary,
      sizeBytes: stats.size,
    };
  } finally {
    await handle.close();
  }
}
