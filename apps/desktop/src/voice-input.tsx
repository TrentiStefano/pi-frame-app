import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { MicrophoneIcon, StopSquareIcon } from "./icons";

type VoiceState = "idle" | "requesting" | "recording" | "transcribing" | "error";

interface VoiceInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}

interface ActiveCapture {
  readonly context: AudioContext;
  readonly processor: ScriptProcessorNode;
  readonly source: MediaStreamAudioSourceNode;
  readonly mute: GainNode;
  readonly stream: MediaStream;
  readonly chunks: Float32Array[];
  readonly timeout: ReturnType<typeof setTimeout>;
}

const MAX_RECORDING_MS = 120_000;
const MIN_RECORDING_SAMPLES = 1_600;

export function VoiceInput({ value, onChange, textareaRef }: VoiceInputProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<VoiceState>("idle");
  const [errorDetail, setErrorDetail] = useState("");
  const captureRef = useRef<ActiveCapture | undefined>(undefined);
  const requestIdRef = useRef("");
  const mountedRef = useRef(true);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  const releaseCapture = useCallback(async (): Promise<{ sampleRate: number; samples: Float32Array }> => {
    const capture = captureRef.current;
    captureRef.current = undefined;
    if (!capture) {
      return { sampleRate: 16_000, samples: new Float32Array() };
    }
    clearTimeout(capture.timeout);
    capture.processor.disconnect();
    capture.source.disconnect();
    capture.mute.disconnect();
    for (const track of capture.stream.getTracks()) {
      track.stop();
    }
    const sampleRate = capture.context.sampleRate;
    await capture.context.close().catch(() => undefined);
    const length = capture.chunks.reduce((total, chunk) => total + chunk.length, 0);
    const samples = new Float32Array(length);
    let offset = 0;
    for (const chunk of capture.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    return { sampleRate, samples };
  }, []);

  const cancel = useCallback(async () => {
    await releaseCapture();
    const requestId = requestIdRef.current;
    requestIdRef.current = "";
    if (requestId) {
      await window.piApp?.cancelVoiceTranscription(requestId).catch(() => undefined);
    }
    if (mountedRef.current) {
      setErrorDetail("");
      setState("idle");
      textareaRef.current?.focus();
    }
  }, [releaseCapture, textareaRef]);

  const stopAndTranscribe = useCallback(async () => {
    if (!captureRef.current) {
      return;
    }
    setState("transcribing");
    const selectionStart = textareaRef.current?.selectionStart ?? valueRef.current.length;
    const selectionEnd = textareaRef.current?.selectionEnd ?? selectionStart;
    const { sampleRate, samples } = await releaseCapture();
    if (samples.length < MIN_RECORDING_SAMPLES) {
      setErrorDetail(t("composer.voiceTooShort"));
      setState("error");
      return;
    }

    const api = window.piApp;
    if (!api) {
      setErrorDetail(t("composer.voiceUnavailable"));
      setState("error");
      return;
    }
    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;
    try {
      const samplesBuffer = new ArrayBuffer(samples.byteLength);
      new Float32Array(samplesBuffer).set(samples);
      const result = await api.transcribeVoice({ requestId, sampleRate, samples: samplesBuffer });
      if (!mountedRef.current || requestIdRef.current !== requestId) {
        return;
      }
      requestIdRef.current = "";
      if (!result.text) {
        setErrorDetail(t("composer.voiceNoSpeech"));
        setState("error");
        return;
      }
      const currentValue = valueRef.current;
      const start = Math.min(selectionStart, currentValue.length);
      const end = Math.min(Math.max(selectionEnd, start), currentValue.length);
      const nextValue = `${currentValue.slice(0, start)}${result.text}${currentValue.slice(end)}`;
      onChangeRef.current(nextValue);
      setState("idle");
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        const caret = start + result.text.length;
        textarea?.focus();
        textarea?.setSelectionRange(caret, caret);
      });
    } catch (error) {
      if (!mountedRef.current || requestIdRef.current !== requestId) {
        return;
      }
      requestIdRef.current = "";
      setErrorDetail(error instanceof Error ? error.message : t("composer.voiceFailed"));
      setState("error");
    }
  }, [releaseCapture, t, textareaRef]);

  const start = useCallback(async () => {
    if (state !== "idle" && state !== "error") {
      return;
    }
    setErrorDetail("");
    setState("requesting");
    try {
      const permission = await window.piApp?.requestMicrophonePermission();
      if (permission === "denied") {
        throw new Error(t("composer.voicePermissionDenied"));
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(t("composer.voiceUnavailable"));
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (event) => {
        chunks.push(event.inputBuffer.getChannelData(0).slice());
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
      const timeout = setTimeout(() => {
        void stopAndTranscribe();
      }, MAX_RECORDING_MS);
      captureRef.current = { context, processor, source, mute, stream, chunks, timeout };
      setState("recording");
    } catch (error) {
      await releaseCapture();
      setErrorDetail(error instanceof Error ? error.message : t("composer.voiceFailed"));
      setState("error");
    }
  }, [releaseCapture, state, stopAndTranscribe, t]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && (captureRef.current || requestIdRef.current)) {
        event.preventDefault();
        void cancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancel]);

  useEffect(() => () => {
    mountedRef.current = false;
    void releaseCapture();
    const requestId = requestIdRef.current;
    if (requestId) {
      void window.piApp?.cancelVoiceTranscription(requestId);
    }
  }, [releaseCapture]);

  const isRecording = state === "recording";
  const isTranscribing = state === "transcribing";
  const label = isRecording
    ? t("composer.voiceStop")
    : isTranscribing
      ? t("composer.voiceCancel")
      : t("composer.voiceStart");
  const status = state === "requesting"
    ? t("composer.voiceRequesting")
    : isRecording
      ? t("composer.voiceListening")
      : isTranscribing
        ? t("composer.voiceTranscribing")
        : state === "error"
          ? errorDetail
          : "";

  return (
    <div className={`voice-input voice-input--${state}`}>
      {status ? <span className="voice-input__status" role="status" title={status}>{status}</span> : null}
      <button
        aria-label={label}
        aria-pressed={isRecording}
        className="icon-button composer__voice"
        data-testid="voice-input"
        disabled={state === "requesting"}
        title={label}
        type="button"
        onClick={isRecording ? () => void stopAndTranscribe() : isTranscribing ? () => void cancel() : () => void start()}
      >
        {isRecording ? <StopSquareIcon /> : <MicrophoneIcon />}
      </button>
    </div>
  );
}
