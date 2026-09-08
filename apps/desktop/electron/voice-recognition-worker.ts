import { parentPort } from "node:worker_threads";

interface WorkerRequest {
  readonly requestId: string;
  readonly modelDir: string;
  readonly sampleRate: number;
  readonly samples: ArrayBuffer;
}

interface WorkerResponse {
  readonly requestId: string;
  readonly text?: string;
  readonly error?: string;
}

interface SherpaStream {
  acceptWaveform(input: { readonly sampleRate: number; readonly samples: Float32Array }): void;
}

interface SherpaRecognizer {
  createStream(): SherpaStream;
  decode(stream: SherpaStream): void;
  getResult(stream: SherpaStream): { readonly text?: string };
}

interface SherpaOnnx {
  readonly OfflineRecognizer: new (config: unknown) => SherpaRecognizer;
}

const SAMPLE_RATE = 16_000;
let recognizer: SherpaRecognizer | undefined;
let loadedModelDir = "";

function getRecognizer(modelDir: string): SherpaRecognizer {
  if (recognizer && loadedModelDir === modelDir) {
    return recognizer;
  }

  // sherpa-onnx is a synchronous native runtime. Keeping it in this worker prevents
  // model loading and decoding from blocking Electron's main thread.
  const sherpaOnnx = require("sherpa-onnx-node") as SherpaOnnx;
  recognizer = new sherpaOnnx.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      paraformer: { model: `${modelDir}/model.int8.onnx` },
      tokens: `${modelDir}/tokens.txt`,
      numThreads: 2,
      debug: 0,
      provider: "cpu",
    },
  });
  loadedModelDir = modelDir;
  return recognizer;
}

function resample(samples: Float32Array, inputRate: number): Float32Array {
  if (inputRate === SAMPLE_RATE) {
    return samples;
  }

  const outputLength = Math.max(1, Math.round(samples.length * SAMPLE_RATE / inputRate));
  const output = new Float32Array(outputLength);
  const ratio = inputRate / SAMPLE_RATE;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const fraction = position - left;
    output[index] = (samples[left] ?? 0) * (1 - fraction) + (samples[right] ?? 0) * fraction;
  }
  return output;
}

function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

if (!parentPort) {
  throw new Error("Voice recognition worker requires a parent port.");
}

parentPort.on("message", (request: WorkerRequest) => {
  try {
    const activeRecognizer = getRecognizer(request.modelDir);
    const samples = resample(new Float32Array(request.samples), request.sampleRate);
    const stream = activeRecognizer.createStream();
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
    activeRecognizer.decode(stream);
    const text = normalizeTranscript(activeRecognizer.getResult(stream).text ?? "");
    parentPort?.postMessage({ requestId: request.requestId, text } satisfies WorkerResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    parentPort?.postMessage({ requestId: request.requestId, error: message } satisfies WorkerResponse);
  }
});
