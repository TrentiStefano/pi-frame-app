import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Suffix of the transient files writeFileAtomic creates before renaming into place. */
export const TMP_SUFFIX = ".tmp";

let tmpCounter = 0;
const writeQueueByPath = new Map<string, Promise<void>>();

/**
 * Write `data` to `filePath` durably. A concurrent reader or a crash at any
 * point always observes either the previous file contents or the fully-written
 * new contents — never a missing, truncated, or partially-written file.
 *
 * Steps:
 * - Write to a uniquely-named temp file in the same directory and fsync it.
 * - rename() straight over the target (atomic replace on POSIX). There is no
 *   unlink first, so a crash in the write window cannot leave the target gone.
 *   Windows rejects replacement renames with EPERM/EEXIST, so that platform
 *   uses a remove-then-rename fallback with weaker replacement atomicity.
 * - fsync the containing directory so the rename entry itself survives power
 *   loss, not just the temp file's data blocks.
 */
export async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const queueKey = resolve(filePath);
  const previous = writeQueueByPath.get(queueKey) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(() => writeFileAtomicNow(filePath, data));
  writeQueueByPath.set(queueKey, write);

  try {
    await write;
  } finally {
    if (writeQueueByPath.get(queueKey) === write) {
      writeQueueByPath.delete(queueKey);
    }
  }
}

async function writeFileAtomicNow(filePath: string, data: string | Uint8Array): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  // Collision-safe temp name: a pid + monotonic counter + randomness so two
  // writers, or two writes within the same millisecond, never share a path
  // (Date.now() alone is not unique under concurrent writes).
  tmpCounter = (tmpCounter + 1) >>> 0;
  const tmpPath = `${filePath}.${process.pid}.${tmpCounter}.${randomBytes(6).toString("hex")}${TMP_SUFFIX}`;

  const handle = await open(tmpPath, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(tmpPath, filePath);
  } catch (error) {
    if (!isReplaceRenameError(error)) {
      await rm(tmpPath, { force: true }).catch(() => {});
      throw error;
    }

    // Windows does not replace an existing file with rename(). Removing the
    // destination first is the smallest compatible fallback, but leaves a
    // brief missing-file window and is not replacement-atomic on that platform.
    try {
      await rm(filePath, { force: true });
      await rename(tmpPath, filePath);
    } catch (fallbackError) {
      await rm(tmpPath, { force: true }).catch(() => {});
      throw fallbackError;
    }
  }

  await syncDirectory(dir);
}

/** Serialize `value` as pretty JSON with a trailing newline and write it atomically. */
export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function isReplaceRenameError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error.code === "EEXIST" || error.code === "EPERM");
}

async function syncDirectory(dir: string): Promise<void> {
  let handle;
  try {
    handle = await open(dir, "r");
  } catch {
    // Some platforms (notably Windows) reject opening a directory for fsync.
    // The rename above is still atomic; skip the extra durability step.
    return;
  }
  try {
    await handle.sync();
  } catch {
    // Best effort — a failed directory fsync must not fail the write.
  } finally {
    await handle.close();
  }
}
