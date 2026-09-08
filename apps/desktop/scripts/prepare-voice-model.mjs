import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, open, rename } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const modelDir = path.join(desktopDir, ".cache", "voice-model", "sherpa-onnx-paraformer-zh-2023-09-14");
const downloadTimeoutMs = Number.parseInt(process.env.PI_APP_VOICE_DOWNLOAD_TIMEOUT_MS ?? "600000", 10);
const repositories = [
  "https://hf-mirror.com/csukuangfj/sherpa-onnx-paraformer-zh-2023-09-14/resolve/main",
  "https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-2023-09-14/resolve/main",
];
const files = [
  {
    name: "model.int8.onnx",
    size: 243_371_218,
    sha256: "f36a0433bcf096bd6d6f11b80a3ac8bed110bdca632fe0d731df8d1a84475945",
  },
  {
    name: "tokens.txt",
    size: 75_756,
    sha256: "59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6",
  },
  {
    name: "test_wavs/0.wav",
    size: 179_712,
    sha256: "1a6bf94091d9c35e11aea5d494d05e3287b8f5c767f6de3bfd796d91b637500c",
  },
];

await mkdir(modelDir, { recursive: true });
for (const file of files) {
  await ensureFile(file);
}
console.log(`Offline Mandarin voice model is ready: ${modelDir}`);

async function ensureFile(file) {
  const destination = path.join(modelDir, file.name);
  await mkdir(path.dirname(destination), { recursive: true });
  if (await hasExpectedHash(destination, file.sha256)) {
    console.log(`Using cached ${file.name}`);
    return;
  }

  try {
    await access(destination);
    await rename(destination, `${destination}.invalid-${Date.now()}`);
  } catch {
    // The destination does not exist yet.
  }

  let lastError;
  for (const repository of repositories) {
    const temporary = `${destination}.part-${process.pid}-${Date.now()}`;
    try {
      console.log(`Downloading ${file.name} from ${new URL(repository).host}...`);
      const url = `${repository}/${file.name}`;
      if (file.size > 20_000_000) {
        await downloadInRanges(url, temporary, file.size);
      } else {
        await downloadStream(url, temporary);
      }
      if (!(await hasExpectedHash(temporary, file.sha256))) {
        await rename(temporary, `${temporary}.invalid`);
        throw new Error(`SHA-256 mismatch for ${file.name}`);
      }
      await rename(temporary, destination);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Unable to download ${file.name} from ${new URL(repository).host}: ${describeError(error)}`);
    }
  }
  throw new Error(`Unable to prepare ${file.name}: ${describeError(lastError)}`);
}

async function downloadStream(url, destination) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(downloadTimeoutMs) });
  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: "wx" }));
}

async function downloadInRanges(url, destination, size) {
  const chunkSize = 4 * 1024 * 1024;
  const concurrency = 8;
  const ranges = [];
  for (let start = 0; start < size; start += chunkSize) {
    ranges.push({ start, end: Math.min(start + chunkSize - 1, size - 1) });
  }
  const file = await open(destination, "wx");
  try {
    await file.truncate(size);
    for (let index = 0; index < ranges.length; index += concurrency) {
      const batch = ranges.slice(index, index + concurrency);
      await Promise.all(batch.map(({ start, end }) => downloadRangeWithRetries(url, file, start, end)));
      const completed = Math.min(index + batch.length, ranges.length);
      console.log(`Downloaded ${Math.round(completed / ranges.length * 100)}% of ${path.basename(destination)}`);
    }
  } finally {
    await file.close();
  }
}

async function downloadRangeWithRetries(url, file, start, end) {
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        redirect: "follow",
        signal: AbortSignal.timeout(downloadTimeoutMs),
      });
      if (response.status !== 206) {
        throw new Error(`Range ${start}-${end} returned ${response.status} ${response.statusText}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== end - start + 1) {
        throw new Error(`Range ${start}-${end} returned ${bytes.byteLength} bytes`);
      }
      await file.write(bytes, 0, bytes.byteLength, start);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Retrying range ${start}-${end} (${attempt}/10): ${describeError(error)}`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 1_000, 5_000)));
    }
  }
  throw lastError;
}

async function hasExpectedHash(filePath, expected) {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) {
      hash.update(chunk);
    }
    return hash.digest("hex") === expected;
  } catch {
    return false;
  }
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
