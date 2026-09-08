import { app } from "electron";
import { access } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { VoiceTranscriptionInput, VoiceTranscriptionResult } from "../src/ipc";

interface WorkerResponse {
  readonly requestId: string;
  readonly text?: string;
  readonly error?: string;
}

interface PendingRequest {
  readonly resolve: (result: VoiceTranscriptionResult) => void;
  readonly reject: (error: Error) => void;
}

const MODEL_DIRECTORY_NAME = "sherpa-onnx-paraformer-zh-2023-09-14";
const MAX_RECORDING_SECONDS = 120;

export class VoiceRecognitionService {
  private worker: Worker | undefined;
  private readonly pending = new Map<string, PendingRequest>();

  async transcribe(input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult> {
    validateInput(input);

    const testTranscript = process.env.PI_APP_TEST_VOICE_TRANSCRIPT;
    if (testTranscript !== undefined) {
      return { text: testTranscript };
    }

    if (this.pending.has(input.requestId)) {
      throw new Error("A voice transcription with this request ID is already running.");
    }

    const modelDir = await resolveModelDir();
    const worker = this.getWorker();
    return new Promise<VoiceTranscriptionResult>((resolve, reject) => {
      this.pending.set(input.requestId, { resolve, reject });
      worker.postMessage(
        {
          requestId: input.requestId,
          modelDir,
          sampleRate: input.sampleRate,
          samples: input.samples,
        },
        [input.samples],
      );
    });
  }

  cancel(requestId: string): void {
    const request = this.pending.get(requestId);
    if (!request) {
      return;
    }
    this.pending.delete(requestId);
    request.reject(new Error("Voice transcription cancelled."));
    this.rejectAll(new Error("Voice transcription cancelled."));
    this.restartWorker();
  }

  dispose(): void {
    this.rejectAll(new Error("Voice recognition stopped."));
    void this.worker?.terminate();
    this.worker = undefined;
  }

  private getWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }
    const worker = new Worker(path.join(__dirname, "voice-recognition-worker.js"));
    worker.on("message", (response: WorkerResponse) => this.handleResponse(response));
    worker.on("error", (error) => {
      this.rejectAll(error);
      this.worker = undefined;
    });
    worker.on("exit", (code) => {
      if (this.worker !== worker) {
        return;
      }
      this.worker = undefined;
      if (code !== 0) {
        this.rejectAll(new Error(`Voice recognition worker exited with code ${code}.`));
      }
    });
    this.worker = worker;
    return worker;
  }

  private handleResponse(response: WorkerResponse): void {
    const request = this.pending.get(response.requestId);
    if (!request) {
      return;
    }
    this.pending.delete(response.requestId);
    if (response.error) {
      request.reject(new Error(response.error));
      return;
    }
    request.resolve({ text: response.text ?? "" });
  }

  private restartWorker(): void {
    const worker = this.worker;
    this.worker = undefined;
    void worker?.terminate();
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}

function validateInput(input: VoiceTranscriptionInput): void {
  if (!input.requestId || !Number.isFinite(input.sampleRate) || input.sampleRate < 8_000 || input.sampleRate > 192_000) {
    throw new Error("Invalid voice transcription request.");
  }
  const samples = new Float32Array(input.samples);
  if (samples.length === 0) {
    throw new Error("No microphone audio was captured.");
  }
  if (samples.length > input.sampleRate * MAX_RECORDING_SECONDS) {
    throw new Error(`Voice recordings are limited to ${MAX_RECORDING_SECONDS} seconds.`);
  }
}

async function resolveModelDir(): Promise<string> {
  const configured = process.env.PI_APP_VOICE_MODEL_DIR?.trim();
  const modelDir = configured
    ? path.resolve(configured)
    : app.isPackaged
      ? path.join(process.resourcesPath, "voice-model", MODEL_DIRECTORY_NAME)
      : path.join(app.getAppPath(), ".cache", "voice-model", MODEL_DIRECTORY_NAME);

  try {
    await Promise.all([
      access(path.join(modelDir, "model.int8.onnx")),
      access(path.join(modelDir, "tokens.txt")),
    ]);
  } catch {
    throw new Error("Offline Mandarin voice model is not installed. Run `pnpm --filter @pi-frame/desktop prepare:voice-model`.");
  }
  return modelDir;
}
