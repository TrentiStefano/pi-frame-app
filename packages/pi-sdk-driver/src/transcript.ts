export interface SessionTranscriptImageAttachment {
  readonly kind: "image";
  readonly mimeType: string;
  readonly data: string;
  readonly name?: string;
}

export interface SessionTranscriptFileAttachment {
  readonly kind: "file";
  readonly name: string;
  readonly mimeType: string;
  readonly fsPath: string;
  readonly sizeBytes?: number;
}

export interface SessionTranscriptBrowserElementAttachment {
  readonly kind: "browser-element";
  readonly id: string;
  readonly name: string;
  readonly tabId: string;
  readonly capturedAt: string;
  readonly page: { readonly url: string; readonly title: string; readonly revision: number };
  readonly frameUrl: string;
  readonly element: {
    readonly tag: string;
    readonly role?: string;
    readonly accessibleName?: string;
    readonly text?: string;
    readonly attributes: Readonly<Record<string, string>>;
    readonly locator: {
      readonly kind: "role" | "test-id" | "label" | "text" | "id" | "css";
      readonly value: string;
      readonly unique: boolean;
    };
    readonly cssFallback?: string;
    readonly ancestors: readonly { readonly tag: string; readonly role?: string; readonly name?: string }[];
  };
}

export type SessionTranscriptAttachment =
  | SessionTranscriptImageAttachment
  | SessionTranscriptFileAttachment
  | SessionTranscriptBrowserElementAttachment;

export type SessionTranscriptRole = "user" | "assistant" | "branchSummary" | "compactionSummary";

export interface SessionMessageUsage {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly totalTokens?: number;
  readonly cost?: {
    readonly input?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
    readonly total?: number;
  };
}

export interface SessionTranscriptMessage {
  readonly kind: "message";
  readonly role: SessionTranscriptRole;
  readonly text: string;
  readonly thinking?: string;
  readonly attachments?: readonly SessionTranscriptAttachment[];
  readonly createdAt: string;
  readonly id: string;
  readonly usage?: SessionMessageUsage;
  readonly model?: string;
  readonly provider?: string;
}

export interface SessionTranscriptToolCall {
  readonly kind: "tool";
  readonly id: string;
  readonly callId: string;
  readonly toolName: string;
  /** "error" also covers calls whose result never arrived (interrupted runs). */
  readonly status: "success" | "error";
  readonly input?: unknown;
  readonly output?: unknown;
  readonly usage?: SessionMessageUsage;
  readonly createdAt: string;
}

export type SessionTranscriptItem = SessionTranscriptMessage | SessionTranscriptToolCall;
