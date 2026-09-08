export interface BrowserSessionTarget {
  readonly workspaceId: string;
  readonly sessionId: string;
}

export interface BrowserTabState {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly loading: boolean;
  readonly crashed: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly devToolsOpen: boolean;
  readonly revision: number;
  readonly faviconUrl?: string;
  readonly failure?: BrowserTabFailure;
}

export interface BrowserTabFailure {
  readonly kind: "network" | "certificate" | "blocked" | "crashed" | "timeout" | "unknown";
  readonly code?: string;
}

export interface BrowserAgentActivity {
  readonly status: "idle" | "running" | "paused";
  readonly action?: string;
  readonly tabId?: string;
  readonly startedAt?: string;
  readonly lastAction?: string;
  readonly lastResult?: "success" | "error";
  readonly completedAt?: string;
}

export interface BrowserPermissionRequest {
  readonly id: string;
  readonly permission: "clipboard" | "notifications" | "geolocation" | "file-upload" | "download";
  readonly origin: string;
  readonly requestedAt: string;
}

export interface BrowserSessionState {
  readonly target: BrowserSessionTarget;
  readonly tabs: readonly BrowserTabState[];
  readonly activeTabId: string | null;
  readonly selectionMode: boolean;
  readonly persistent: boolean;
  readonly closedTabCount: number;
  readonly agentActivity: BrowserAgentActivity;
  readonly pendingPermission?: BrowserPermissionRequest;
  readonly addressFocusRequest: number;
  readonly surfaceOwnerWebContentsId?: number;
}

export type BrowserCommand =
  | { readonly kind: "open-tab"; readonly url?: string }
  | { readonly kind: "activate-tab"; readonly tabId: string }
  | { readonly kind: "close-tab"; readonly tabId: string }
  | { readonly kind: "navigate"; readonly tabId?: string; readonly url: string }
  | { readonly kind: "history"; readonly tabId?: string; readonly action: "back" | "forward" | "reload" | "stop" }
  | { readonly kind: "toggle-devtools"; readonly tabId?: string; readonly open?: boolean }
  | { readonly kind: "set-selection-mode"; readonly enabled: boolean }
  | { readonly kind: "reopen-closed-tab" }
  | { readonly kind: "capture-context"; readonly mode: "page" | "screenshot" }
  | { readonly kind: "agent-control"; readonly action: "pause" | "resume" | "takeover" }
  | { readonly kind: "resolve-permission"; readonly requestId: string; readonly decision: "allow" | "deny" }
  | { readonly kind: "set-persistence"; readonly persistent: boolean }
  | { readonly kind: "clear-data" };

export interface BrowserSurfaceBounds {
  readonly target: BrowserSessionTarget;
  readonly visible: boolean;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface BrowserElementLocator {
  readonly kind: "role" | "test-id" | "label" | "text" | "id" | "css";
  readonly value: string;
  readonly unique: boolean;
}

export interface BrowserElementAttachment {
  readonly id: string;
  readonly kind: "browser-element";
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
    readonly locator: BrowserElementLocator;
    readonly cssFallback?: string;
    readonly ancestors: readonly { readonly tag: string; readonly role?: string; readonly name?: string }[];
  };
}

export interface BrowserScreenshotAttachment {
  readonly id: string;
  readonly kind: "image";
  readonly name: string;
  readonly mimeType: "image/jpeg";
  readonly data: string;
}

export interface BrowserDownloadAttachment {
  readonly id: string;
  readonly kind: "file";
  readonly name: string;
  readonly mimeType: string;
  readonly fsPath: string;
  readonly sizeBytes?: number;
}

export interface BrowserElementSelectedEvent {
  readonly target: BrowserSessionTarget;
  readonly attachment: BrowserElementAttachment | BrowserScreenshotAttachment | BrowserDownloadAttachment;
}
