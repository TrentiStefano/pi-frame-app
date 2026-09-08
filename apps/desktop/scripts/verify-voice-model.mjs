import { createRequire } from "node:module";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sherpaOnnx = require("sherpa-onnx-node");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const modelDir = path.join(desktopDir, ".cache", "voice-model", "sherpa-onnx-paraformer-zh-2023-09-14");
const wave = sherpaOnnx.readWave(path.join(modelDir, "test_wavs", "0.wav"));
const samples = new Float32Array(wave.samples);
const samplesBuffer = new ArrayBuffer(samples.byteLength);
new Float32Array(samplesBuffer).set(samples);
const worker = new Worker(path.join(desktopDir, "out", "main", "voice-recognition-worker.js"));

try {
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Voice model verification timed out.")), 60_000);
    worker.once("error", reject);
    worker.once("message", (message) => {
      clearTimeout(timeout);
      if (message.error) {
        reject(new Error(message.error));
        return;
      }
      resolve(message);
    });
    worker.postMessage({
      requestId: "verify-voice-model",
      modelDir,
      sampleRate: wave.sampleRate,
      samples: samplesBuffer,
    }, [samplesBuffer]);
  });
  if (!result.text?.trim()) {
    throw new Error("Offline voice model returned an empty transcript.");
  }
  console.log(`Offline Mandarin transcript: ${result.text}`);
} finally {
  await worker.terminate();
}
