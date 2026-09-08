import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
  systemPreferences,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";
import { isValidHttpBaseUrl, sessionKey } from "@pi-frame/pi-sdk-driver";
import { randomUUID } from "node:crypto";
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { augmentMacPath } from "../scripts/augment-path.cjs";
import { DesktopAppStore, type DesktopAppViewState } from "./app-store";
import { readPersistedUiState } from "./app-store-persistence";
import {
  createOrchestrationRuntimeExtension,
  createOrchestrationRuntimeTools,
  type OrchestrationRuntimeBridge,
} from "./orchestration-runtime";
import * as orchestrationTools from "./app-store-orchestration";
import { getChangedFiles, getFileDiff, stageFile } from "./app-store-diff";
import { listWorkspaceFiles, readWorkspaceFile } from "./app-store-files";
import { MAIN_DEV_RELOAD_MARKER } from "./dev-reload-main-probe";
import { NotificationManager } from "./notification-manager";
import {
  NotificationPermissionService,
} from "./notification-permission";
import { getWindowsTitleBarOverlay, ThemeManager } from "./theme-manager";
import { TerminalService } from "./terminal-service";
import { VoiceRecognitionService } from "./voice-recognition-service";
import { CapabilityCatalogService } from "./capability-catalog-service";
import { createMcpRuntimeExtension, McpConnectorService } from "./mcp-connector-service";
import { mainT, setMainLanguage } from "./i18n";
import type { AppView, DesktopAppState, ThemeMode } from "../src/desktop-state";
import { type AppLanguage } from "../src/desktop-state";
import { isAppLanguage, resolveSystemAppLanguage } from "../src/i18n/resources";
import {
  desktopIpc,
  applicationMenuIds,
  getDesktopCommandFromShortcut,
  type ApplicationMenuId,
  type AssistantStreamPatch,
  type CustomProviderConfig,
  type CustomProviderProbeInput,
  type CustomProviderProbeResult,
  type DeleteModelConfigurationInput,
  type ModelConfigurationDefaultsInput,
  type SaveModelConfigurationInput,
  type ShowApplicationMenuInput,
  type VoiceTranscriptionInput,
} from "../src/ipc";
import type { InstallCapabilityPackageInput, SetCapabilityConnectorInput } from "../src/capability-types";
import { SUPPORTED_COMPOSER_IMAGE_TYPES } from "../src/composer-attachments";
import { APP_DISPLAY_NAME, DESKTOP_APP_ID, LEGACY_USER_DATA_DIR_NAME } from "../src/branding";
import type {
  ComposerAttachment,
  BrowserElementAttachment,
  ComposerFileAttachment,
  ComposerImageAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  ForkThreadInput,
  RemoveWorktreeInput,
  SendChildThreadFollowUpInput,
  SetChildSupervisionLoopInput,
  SelectedTranscriptRecord,
  StartThreadInput,
  WorkspaceSessionTarget,
} from "../src/desktop-state";
import type { SessionDriverEvent } from "@pi-frame/session-driver";
import type { GenerateThreadTitleOptions } from "@pi-frame/pi-sdk-driver";
import type { SessionRef, WorkspaceRef } from "@pi-frame/session-driver";
import { createPlanTools, PLAN_MODE_SYSTEM_PROMPT } from "./plan-runtime";
import { createComputerUseRuntimeExtension } from "./computer-use-runtime";
import { UpdateService } from "./update-service";
import { BrowserService } from "./browser-service";
import type { BrowserCommand, BrowserSessionTarget, BrowserSurfaceBounds } from "../src/browser-types";
import { createBrowserRuntimeExtension, createBrowserRuntimeTools } from "./browser-runtime";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const windowTestMode = resolveWindowTestMode();
const devReloadMarkersEnabled = process.env.PI_APP_DEV_RELOAD_MARKERS === "1";
const testVoiceAudioPath = process.env.PI_APP_TEST_VOICE_AUDIO_PATH?.trim();
if (process.env.PI_APP_TEST_VOICE_TRANSCRIPT !== undefined || testVoiceAudioPath) {
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  if (testVoiceAudioPath) {
    app.commandLine.appendSwitch("use-file-for-fake-audio-capture", path.resolve(testVoiceAudioPath));
  }
}

let store: DesktopAppStore;
let browserService: BrowserService | undefined;
const themeManager = new ThemeManager();
let mainWindow: BrowserWindow | null = null;
let startupWindow: BrowserWindow | null = null;
let pendingSecondInstanceActivation = false;
let notificationManager: NotificationManager | undefined;
let notificationPermissionService: NotificationPermissionService | undefined;
let terminalService: TerminalService | undefined;
const voiceRecognitionService = new VoiceRecognitionService();
let integratedTerminalShell = "";
let appLanguage: AppLanguage = resolveSystemAppLanguage(app.getLocale());

interface WindowViewState {
  readonly selectedWorkspaceId: string;
  readonly selectedSessionId: string;
  readonly activeView: AppView;
  readonly sidebarCollapsed: boolean;
}

interface OrchestrationRuntimeToolTestInput {
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly sessionRef: SessionRef;
  readonly params: unknown;
}

const appWindows = new Set<BrowserWindow>();
const windowViews = new Map<number, WindowViewState>();
const stopPublishingStateByWebContentsId = new Map<number, () => void>();
const stopPublishingSelectedTranscriptByWebContentsId = new Map<number, () => void>();
const stopPublishingAssistantStreamByWebContentsId = new Map<number, () => void>();
const stopPublishingSessionMetadataByWebContentsId = new Map<number, () => void>();
const stopTrackingWindowActivationByWebContentsId = new Map<number, () => void>();
let stopNotifications: (() => void) | undefined;
let stopPruningTerminals: (() => void) | undefined;
let retainedTerminalWorkspacePathSignature = "";
const terminalFocusedWebContentsIds = new Set<number>();
const focusedTerminalIdByWebContentsId = new Map<number, string>();
let quittingAfterStoreFlush = false;
let windowScopedActionQueue: Promise<void> = Promise.resolve();
let currentComposerDraftPersistOriginWebContentsId: number | undefined;
let currentWindowScopedWebContentsId: number | undefined;
let deferredActivationWebContentsId: number | undefined;
/** Test-only tracking for detached selected-transcript IPC work. */
const pendingTestRendererPublications = new Set<Promise<void>>();
const testSelectedTranscriptPublicationCounts = new Map<string, number>();
const testStatePublicationDiagnostics = {
  count: 0,
  elapsedMs: 0,
  payloadBytes: 0,
  maxPayloadBytes: 0,
  projectionCount: 0,
  projectionElapsedMs: 0,
};
const testSelectedTranscriptPublicationDiagnostics = {
  count: 0,
  elapsedMs: 0,
  payloadBytes: 0,
  maxPayloadBytes: 0,
};
const testAssistantStreamPatchDiagnostics = {
  count: 0,
  payloadBytes: 0,
};

function estimatePayloadBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

function resetTestStatePublicationDiagnostics(): void {
  testStatePublicationDiagnostics.count = 0;
  testStatePublicationDiagnostics.elapsedMs = 0;
  testStatePublicationDiagnostics.payloadBytes = 0;
  testStatePublicationDiagnostics.maxPayloadBytes = 0;
  testStatePublicationDiagnostics.projectionCount = 0;
  testStatePublicationDiagnostics.projectionElapsedMs = 0;
  testSelectedTranscriptPublicationDiagnostics.count = 0;
  testSelectedTranscriptPublicationDiagnostics.elapsedMs = 0;
  testSelectedTranscriptPublicationDiagnostics.payloadBytes = 0;
  testSelectedTranscriptPublicationDiagnostics.maxPayloadBytes = 0;
  testAssistantStreamPatchDiagnostics.count = 0;
  testAssistantStreamPatchDiagnostics.payloadBytes = 0;
}

function trackTestRendererPublication(publication: Promise<void>): void {
  const tracked = publication.finally(() => pendingTestRendererPublications.delete(tracked));
  pendingTestRendererPublications.add(tracked);
}

async function waitForTestRendererPublications(): Promise<void> {
  for (;;) {
    await store.waitForTestSessionEventIdle();
    if (pendingTestRendererPublications.size === 0) {
      store.recordStreamPipelineDrain();
      return;
    }
    await Promise.all([...pendingTestRendererPublications]);
  }
}

const SUPPORTED_IMAGE_TYPES = SUPPORTED_COMPOSER_IMAGE_TYPES;
const SUPPORTED_IMAGE_MIME_TYPES = new Set<string>(SUPPORTED_IMAGE_TYPES.map((type) => type.mimeType));
const NEW_WINDOW_MENU_ITEM_ID = "file.new-window";
const WINDOW_BACKGROUND = {
  light: "#eceef3",
  dark: "#1a1b1e",
} as const;



function createStoreBackedOrchestrationRuntimeBridge(): OrchestrationRuntimeBridge {
  return {
    createChildThread: async (ctx, input) => {
      await store.initialize();
      return orchestrationTools.createChildThreadToolResult(store, sessionRefFromExtensionContext(ctx), input);
    },
    listThreads: async (ctx) => {
      await store.initialize();
      return orchestrationTools.listThreadsToolResult(store, sessionRefFromExtensionContext(ctx));
    },
    readThread: async (ctx, threadId) => {
      await store.initialize();
      return orchestrationTools.readThreadToolResult(store, sessionRefFromExtensionContext(ctx), threadId);
    },
    sendMessageToThread: async (ctx, input) => {
      await store.initialize();
      return orchestrationTools.sendMessageToThreadToolResult(store, sessionRefFromExtensionContext(ctx), input);
    },
  };
}

function sessionRefFromExtensionContext(ctx: ExtensionContext): SessionRef {
  const sessionId = ctx.sessionManager.getSessionId();
  const cwd = path.resolve(ctx.sessionManager.getCwd?.() ?? ctx.cwd);
  const workspace = store.state.workspaces.find(
    (entry) => path.resolve(entry.path) === cwd && entry.sessions.some((session) => session.id === sessionId),
  );
  if (!workspace) {
    throw new Error(`Unable to resolve orchestration session for ${cwd}:${sessionId}`);
  }
  return {
    workspaceId: workspace.id,
    sessionId,
  };
}

async function runOrchestrationRuntimeToolForTest(
  bridge: OrchestrationRuntimeBridge,
  input: OrchestrationRuntimeToolTestInput,
): Promise<AgentToolResult<unknown>> {
  await store.initialize();
  const tool = createOrchestrationRuntimeTools(bridge).find((entry) => entry.name === input.toolName);
  if (!tool) {
    throw new Error(`Unknown orchestration runtime tool: ${input.toolName}`);
  }
  return tool.execute(
    input.toolCallId ?? `test-${input.toolName}`,
    input.params,
    undefined,
    undefined,
    createTestExtensionContext(input.sessionRef),
  );
}

function createTestExtensionContext(sessionRef: SessionRef): ExtensionContext {
  const workspace = store.state.workspaces.find(
    (entry) => entry.id === sessionRef.workspaceId && entry.sessions.some((session) => session.id === sessionRef.sessionId),
  );
  if (!workspace) {
    throw new Error(`Unknown test session: ${sessionRef.workspaceId}:${sessionRef.sessionId}`);
  }

  return {
    hasUI: false,
    mode: "json",
    cwd: workspace.path,
    sessionManager: {
      getSessionId: () => sessionRef.sessionId,
      getCwd: () => workspace.path,
    } as ExtensionContext["sessionManager"],
    ui: {} as ExtensionContext["ui"],
    modelRegistry: {} as ExtensionContext["modelRegistry"],
    model: undefined,
    signal: undefined,
    isIdle: () => true,
    isProjectTrusted: () => true,
    abort: () => undefined,
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => "",
  };
}
const OPEN_FOLDER_MENU_ITEM_ID = "file.open-folder";
const QUIT_FLUSH_TIMEOUT_MS = 5_000;
const MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CLIPBOARD_IMAGE_DIMENSION = 8_192;

function getTerminalService(): TerminalService {
  if (!terminalService) {
    terminalService = new TerminalService({
      getWorkspacePath: (workspaceId) => store.getWorkspacePath(workspaceId),
      getIntegratedTerminalShell: () => integratedTerminalShell,
      isPackaged: app.isPackaged,
    });
  }
  return terminalService;
}

// Resolve the bundled application icon. In dev the repo's `resources/icon.png`
// sits two levels up from the compiled `out/main/main.js`; in a packaged build
// it is copied to `process.resourcesPath` via `extraResources` in
// electron-builder.yml. On macOS packaged builds the window/dock icon already
// comes from `icon.icns` in the app bundle, so we only need the PNG for dev
// and for Linux/Windows window chrome.
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icon.png")
  : path.join(__dirname, "..", "..", "resources", "icon.png");
const appIcon = nativeImage.createFromPath(appIconPath);

function parseExternalWebUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function appRendererUrl(): string {
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    return process.env.ELECTRON_RENDERER_URL;
  }
  const indexPath = path.join(__dirname, "..", "renderer", "index.html");
  return pathToFileURL(indexPath).toString();
}

function isInAppNavigationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const appUrl = new URL(appRendererUrl());
    return parsed.href === appUrl.href || (isDev && parsed.origin === appUrl.origin);
  } catch {
    return false;
  }
}

function openExternalWebUrl(url: string): boolean {
  const parsed = parseExternalWebUrl(url);
  if (!parsed) {
    return false;
  }
  void shell.openExternal(parsed.toString()).catch((error) => {
    console.error(`Failed to open external URL: ${parsed.toString()}`, error);
  });
  return true;
}

function readClipboardImageAttachment(): ComposerImageAttachment | null {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return null;
  }

  const size = image.getSize();
  if (size.width > MAX_CLIPBOARD_IMAGE_DIMENSION || size.height > MAX_CLIPBOARD_IMAGE_DIMENSION) {
    return null;
  }

  const png = image.toPNG();
  if (png.length === 0 || png.length > MAX_CLIPBOARD_IMAGE_BYTES) {
    return null;
  }

  return {
    id: randomUUID(),
    kind: "image",
    name: "pasted-image.png",
    mimeType: "image/png",
    data: png.toString("base64"),
  };
}

function createWindow(options: { readonly loadRenderer?: boolean } = {}): BrowserWindow {
  const loadRenderer = options.loadRenderer ?? true;
  const backgroundTestMode = windowTestMode === "background";
  const isWindows = process.platform === "win32";
  const resolvedTheme = themeManager.getResolvedTheme();
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 560,
    minHeight: 600,
    titleBarStyle: isWindows ? "hidden" : "hiddenInset",
    titleBarOverlay: isWindows ? getWindowsTitleBarOverlay(resolvedTheme) : undefined,
    backgroundColor: WINDOW_BACKGROUND[resolvedTheme],
    trafficLightPosition: { x: 18, y: 18 },
    show: false,
    // The renderer is hidden until ready-to-show; avoid an extra hidden paint
    // on Windows startup while keeping the first visible frame unchanged.
    paintWhenInitiallyHidden: false,
    title: APP_DISPLAY_NAME,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        `--pi-app-language=${appLanguage}`,
        `--pi-app-theme=${resolvedTheme}`,
      ],
      // Keep hidden test windows responsive so Playwright exercises the same UI flows.
      backgroundThrottling: !backgroundTestMode,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInAppNavigationUrl(url)) {
      openExternalWebUrl(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isInAppNavigationUrl(url)) {
      return;
    }
    event.preventDefault();
    openExternalWebUrl(url);
  });


  window.once("ready-to-show", () => {
    if (!backgroundTestMode) {
      window.show();
    }
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (!loadRenderer) {
      return;
    }
    if (input.type !== "keyDown") {
      return;
    }

    const lowerKey = input.key.toLowerCase();
    const platformModifier = process.platform === "darwin" ? input.meta : input.control;
    const terminalFocused = terminalFocusedWebContentsIds.has(window.webContents.id);
    if (terminalFocused) {
      if (platformModifier && !input.shift && lowerKey === "v") {
        const terminalId = focusedTerminalIdByWebContentsId.get(window.webContents.id);
        const text = terminalId ? clipboard.readText() : "";
        if (terminalId && text) {
          event.preventDefault();
          getTerminalService().write(window.webContents, terminalId, text);
        }
      }
      return;
    }
    if (platformModifier && !input.shift && lowerKey === "n") {
      event.preventDefault();
      createAppWindow(viewForWebContents(window.webContents.id));
      return;
    }

    if (platformModifier && !input.shift && lowerKey === "o") {
      event.preventDefault();
      void pickWorkspaceViaDialog(window);
      return;
    }

    if (platformModifier && !input.shift && lowerKey === "v") {
      const clipboardImage = readClipboardImageAttachment();
      if (clipboardImage) {
        event.preventDefault();
        window.webContents.send(desktopIpc.clipboardImagePasted, clipboardImage);
        return;
      }
    }

    const command = getDesktopCommandFromShortcut({
      modifier: process.platform === "darwin" ? input.meta : input.control,
      shift: input.shift,
      key: input.key,
      code: input.code,
      ctrl: input.control,
      meta: input.meta,
      alt: input.alt,
      platform: process.platform,
      bindings: store.state.shortcutBindings,
    });
    if (command) {
      event.preventDefault();
      window.webContents.send(desktopIpc.appCommand, command);
    }
  });

  if (!loadRenderer) {
    const startupDocument = `<!doctype html>
      <html lang="${appLanguage}">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            :root {
              color-scheme: ${resolvedTheme};
              --background: ${WINDOW_BACKGROUND[resolvedTheme]};
              --text: ${resolvedTheme === "dark" ? "#f4f4f5" : "#1f2638"};
              --muted: ${resolvedTheme === "dark" ? "#8b8d94" : "#747d93"};
              --track: ${resolvedTheme === "dark" ? "#3a3c42" : "#d2d7e2"};
              --accent: ${resolvedTheme === "dark" ? "#7c6bf5" : "#6a55f2"};
            }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              overflow: hidden;
              background: var(--background);
              color: var(--text);
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }
            main {
              display: grid;
              justify-items: center;
              gap: 18px;
              width: min(360px, calc(100vw - 48px));
              text-align: center;
              animation: loading-enter 420ms cubic-bezier(0.25, 1, 0.5, 1) both;
            }
            .loader {
              position: relative;
              width: 32px;
              height: 32px;
              border: 2px solid var(--track);
              border-top-color: var(--accent);
              border-radius: 50%;
              animation: loading-spin 800ms linear infinite;
            }
            .copy { display: grid; gap: 6px; }
            h1 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: 0; }
            p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
            @keyframes loading-spin { to { transform: rotate(360deg); } }
            @keyframes loading-enter {
              from { opacity: 0; transform: translateY(4px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @media (prefers-reduced-motion: reduce) {
              main { animation: none; }
              .loader { animation-duration: 1.6s; }
            }
          </style>
        </head>
        <body>
          <main role="status" aria-live="polite">
            <div class="loader" aria-hidden="true"></div>
            <div class="copy"><h1>${APP_DISPLAY_NAME}</h1><p>${mainT("native.restoringWorkspace")}</p></div>
          </main>
        </body>
      </html>`;
    void window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(startupDocument)}`);
  } else if (isDev) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL as string);
    if (process.env.PI_APP_OPEN_DEVTOOLS !== "0") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    void window.loadURL(appRendererUrl());
  }

  return window;
}

function showStartupFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const renderFailure = () => {
    if (!startupWindow || startupWindow.isDestroyed() || startupWindow.webContents.isDestroyed()) {
      return;
    }
    const encodedMessage = encodeURIComponent(message);
    void startupWindow.webContents.executeJavaScript(`(() => {
      const status = document.querySelector('[role="status"]');
      if (status) {
        status.innerHTML = '<div class="copy"><h1>${APP_DISPLAY_NAME}</h1><p>Unable to start. Check the app log for details.</p><p></p></div>';
        const detail = status.querySelector('p:last-child');
        if (detail) detail.textContent = decodeURIComponent(${JSON.stringify(encodedMessage)});
      }
      document.querySelector('.loader')?.remove();
    })()`).catch(() => undefined);
    startupWindow.show();
    startupWindow.focus();
  };

  if (startupWindow && !startupWindow.isDestroyed()) {
    if (startupWindow.webContents.isLoading()) {
      startupWindow.webContents.once("did-finish-load", renderFailure);
    } else {
      renderFailure();
    }
    return;
  }

  startupWindow = createWindow({ loadRenderer: false });
  startupWindow.once("closed", () => {
    startupWindow = null;
  });
  startupWindow.webContents.once("did-finish-load", renderFailure);
}

function viewFromState(state: DesktopAppState): WindowViewState {
  return {
    selectedWorkspaceId: state.selectedWorkspaceId,
    selectedSessionId: state.selectedSessionId,
    activeView: state.activeView,
    sidebarCollapsed: state.sidebarCollapsed,
  };
}

function resolveWindowView(sourceView?: DesktopAppViewState): WindowViewState {
  return viewFromState(store.projectStateForView({ ...viewFromState(store.state), ...sourceView }, store.state));
}

function viewForWebContents(webContentsId: number): WindowViewState {
  return windowViews.get(webContentsId) ?? viewFromState(store.state);
}

async function runBrowserRuntimeToolForTest(input: OrchestrationRuntimeToolTestInput): Promise<AgentToolResult<unknown>> {
  if (!browserService) throw new Error("Browser service is unavailable");
  await store.initialize();
  const tool = createBrowserRuntimeTools(browserService, sessionRefFromExtensionContext)
    .find((entry) => entry.name === input.toolName);
  if (!tool) throw new Error(`Unknown browser runtime tool: ${input.toolName}`);
  return tool.execute(
    input.toolCallId ?? `test-${input.toolName}`,
    input.params,
    undefined,
    undefined,
    createTestExtensionContext(input.sessionRef),
  );
}

function assertBrowserTarget(webContentsId: number, target: BrowserSessionTarget): void {
  const view = viewForWebContents(webContentsId);
  if (
    !target ||
    typeof target.workspaceId !== "string" ||
    typeof target.sessionId !== "string" ||
    view.activeView !== "threads" ||
    view.selectedWorkspaceId !== target.workspaceId ||
    view.selectedSessionId !== target.sessionId
  ) {
    throw new Error("Browser target does not match the invoking window's selected thread");
  }
}

function rememberWindowView(webContentsId: number, state: DesktopAppState): void {
  windowViews.set(webContentsId, viewFromState(state));
}

function applyWindowViewToStore(webContentsId: number): void {
  store.state = store.projectStateForView(viewForWebContents(webContentsId), store.state);
}

function projectStateForWindow(
  webContentsId: number,
  state: DesktopAppState = store.state,
  view: WindowViewState = viewForWebContents(webContentsId),
  previousView: WindowViewState | undefined = windowViews.get(webContentsId),
): DesktopAppState {
  const projected = store.projectStateForView(view, state, previousView);
  if (
    projected.composerDraftSyncSource === "persist" &&
    currentComposerDraftPersistOriginWebContentsId !== undefined &&
    webContentsId !== currentComposerDraftPersistOriginWebContentsId
  ) {
    return {
      ...projected,
      composerDraftSyncSource: "remote-persist",
    };
  }
  return projected;
}

function publishStateToWindow(window: BrowserWindow, state: DesktopAppState = store.state): void {
  if (!canPublishToWindow(window)) {
    return;
  }
  const webContentsId = window.webContents.id;
  const view = webContentsId === currentWindowScopedWebContentsId ? viewFromState(state) : viewForWebContents(webContentsId);
  const projectionStartedAt = process.env.PI_APP_TEST_MODE ? performance.now() : 0;
  const projected = projectStateForWindow(webContentsId, state, view);
  if (process.env.PI_APP_TEST_MODE) {
    testStatePublicationDiagnostics.projectionCount += 1;
    testStatePublicationDiagnostics.projectionElapsedMs += performance.now() - projectionStartedAt;
  }
  rememberWindowView(webContentsId, projected);
  if (process.env.PI_APP_TEST_MODE) {
    const startedAt = performance.now();
    const payloadBytes = estimatePayloadBytes(projected);
    window.webContents.send(desktopIpc.stateChanged, projected);
    testStatePublicationDiagnostics.count += 1;
    testStatePublicationDiagnostics.elapsedMs += performance.now() - startedAt;
    testStatePublicationDiagnostics.payloadBytes += payloadBytes;
    testStatePublicationDiagnostics.maxPayloadBytes = Math.max(
      testStatePublicationDiagnostics.maxPayloadBytes,
      payloadBytes,
    );
  } else {
    window.webContents.send(desktopIpc.stateChanged, projected);
  }
}

async function publishSelectedTranscriptToWindow(
  window: BrowserWindow,
  reason: string,
  suppliedPayload?: SelectedTranscriptRecord | null,
): Promise<void> {
  if (!canPublishToWindow(window)) {
    return;
  }
  const webContentsId = window.webContents.id;
  const payload = suppliedPayload === undefined
    ? await store.getSelectedTranscriptForView(viewForWebContents(webContentsId))
    : suppliedPayload;
  if (canPublishToWindow(window)) {
    const projected = projectStateForWindow(webContentsId);
    if (payload) {
      if (projected.selectedWorkspaceId !== payload.workspaceId || projected.selectedSessionId !== payload.sessionId) {
        return;
      }
    } else if (projected.selectedSessionId) {
      return;
    }
    if (process.env.PI_APP_TEST_MODE) {
      const startedAt = performance.now();
      const payloadBytes = estimatePayloadBytes(payload);
      window.webContents.send(desktopIpc.selectedTranscriptChanged, payload);
      testSelectedTranscriptPublicationDiagnostics.count += 1;
      testSelectedTranscriptPublicationDiagnostics.elapsedMs += performance.now() - startedAt;
      testSelectedTranscriptPublicationDiagnostics.payloadBytes += payloadBytes;
      testSelectedTranscriptPublicationDiagnostics.maxPayloadBytes = Math.max(
        testSelectedTranscriptPublicationDiagnostics.maxPayloadBytes,
        payloadBytes,
      );
      const session = payload ? `${payload.workspaceId}/${payload.sessionId}` : "none";
      const key = `${webContentsId}/${session}/${reason}`;
      testSelectedTranscriptPublicationCounts.set(key, (testSelectedTranscriptPublicationCounts.get(key) ?? 0) + 1);
    } else {
      window.webContents.send(desktopIpc.selectedTranscriptChanged, payload);
    }
  }
}

/** Publish selected transcript without blocking the caller; test mode drains every publication. */
function publishSelectedTranscriptDetached(
  window: BrowserWindow,
  reason: string,
  suppliedPayload?: SelectedTranscriptRecord | null,
): void {
  const publication = publishSelectedTranscriptToWindow(window, reason, suppliedPayload);
  if (process.env.PI_APP_TEST_MODE) {
    trackTestRendererPublication(publication);
  } else {
    void publication.catch(() => undefined);
  }
}

function setActiveWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  mainWindow = window;
  notificationManager?.trackWindow(window);
  notificationPermissionService?.trackWindow(window);
}

function windowForWebContentsId(webContentsId: number): BrowserWindow | undefined {
  return [...appWindows].find((window) => !window.isDestroyed() && window.webContents.id === webContentsId);
}

function applyWindowActivation(window: BrowserWindow): void {
  const webContentsId = window.webContents.id;
  setActiveWindow(window);
  applyWindowViewToStore(webContentsId);
  store.handleWindowActivation();
  rememberWindowView(webContentsId, store.state);
}

function applyDeferredWindowActivation(): boolean {
  const webContentsId = deferredActivationWebContentsId;
  deferredActivationWebContentsId = undefined;
  if (webContentsId === undefined) {
    return false;
  }
  const window = windowForWebContentsId(webContentsId);
  if (!window || !canPublishToWindow(window)) {
    return false;
  }
  applyWindowActivation(window);
  return true;
}

function getForegroundAppWindow(): BrowserWindow | null {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && windowViews.has(focusedWindow.webContents.id) && canPublishToWindow(focusedWindow)) {
    return focusedWindow;
  }
  if (mainWindow && canPublishToWindow(mainWindow)) {
    return mainWindow;
  }
  return [...appWindows].find((window) => canPublishToWindow(window)) ?? null;
}

function getForegroundAppView(): DesktopAppViewState | undefined {
  const window = getForegroundAppWindow();
  return window ? viewForWebContents(window.webContents.id) : undefined;
}

function restoreStoreToView(view: DesktopAppViewState | undefined): void {
  if (!view) {
    return;
  }
  store.state = store.projectStateForView(view, store.state);
}

function restoreStoreToViewAndEmit(view: DesktopAppViewState | undefined): void {
  restoreStoreToView(view);
  store.emit();
}

function restoreStoreToForegroundUnlessSender(senderWebContentsId: number | undefined): void {
  const foregroundWindow = getForegroundAppWindow();
  if (!foregroundWindow) {
    return;
  }
  if (senderWebContentsId !== undefined && foregroundWindow.webContents.id === senderWebContentsId) {
    return;
  }
  restoreStoreToViewAndEmit(viewForWebContents(foregroundWindow.webContents.id));
}

function isSessionVisibleInAnotherWindow(sessionRef: SessionRef): boolean {
  for (const window of appWindows) {
    if (!canPublishToWindow(window) || window.isMinimized() || !window.isVisible()) {
      continue;
    }
    const webContentsId = window.webContents.id;
    if (webContentsId === currentWindowScopedWebContentsId) {
      continue;
    }
    const view = windowViews.get(webContentsId);
    if (
      view?.activeView === "threads" &&
      view.selectedWorkspaceId === sessionRef.workspaceId &&
      view.selectedSessionId === sessionRef.sessionId
    ) {
      return true;
    }
  }
  return false;
}

function enqueueWindowScopedAction<T>(action: () => Promise<T>): Promise<T> {
  const run = windowScopedActionQueue.then(action, action);
  windowScopedActionQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

interface WindowScopedActionOptions {
  readonly forceActiveWindow?: boolean;
}

async function runWindowScopedForWindow(
  window: BrowserWindow | null | undefined,
  action: () => Promise<DesktopAppState>,
  options: WindowScopedActionOptions = {},
): Promise<DesktopAppState> {
  return enqueueWindowScopedAction(async () => {
    const webContentsId = window && !window.isDestroyed() ? window.webContents.id : undefined;
    const foregroundWindow = getForegroundAppWindow();
    const senderIsForeground =
      Boolean(window && foregroundWindow && window.webContents.id === foregroundWindow.webContents.id);
    const windowIsFocused =
      Boolean(window && !window.isDestroyed() && window.isFocused()) ||
      senderIsForeground ||
      options.forceActiveWindow === true;
    if (window && webContentsId !== undefined) {
      if (windowIsFocused) {
        setActiveWindow(window);
      }
      applyWindowViewToStore(webContentsId);
    }

    const previousWindowScopedWebContentsId = currentWindowScopedWebContentsId;
    currentWindowScopedWebContentsId = webContentsId;
    try {
      const state = await action();
      if (!window || webContentsId === undefined) {
        return state;
      }

      const previousView = windowViews.get(webContentsId);
      const projected = projectStateForWindow(webContentsId, state, viewFromState(state), previousView);
      rememberWindowView(webContentsId, projected);
      return projected;
    } finally {
      currentWindowScopedWebContentsId = previousWindowScopedWebContentsId;
      if (!applyDeferredWindowActivation()) {
        restoreStoreToForegroundUnlessSender(webContentsId);
      }
    }
  });
}

function runWindowScopedForEvent(
  event: IpcMainInvokeEvent,
  action: () => Promise<DesktopAppState>,
): Promise<DesktopAppState> {
  return runWindowScopedForWindow(BrowserWindow.fromWebContents(event.sender), action);
}

async function runUnscopedStateResultForWindow(
  window: BrowserWindow | null | undefined,
  action: () => Promise<DesktopAppState>,
): Promise<DesktopAppState> {
  const state = await action();
  if (!window || !canPublishToWindow(window)) {
    return state;
  }
  const webContentsId = window.webContents.id;
  const projected = projectStateForWindow(webContentsId, state);
  rememberWindowView(webContentsId, projected);
  return projected;
}

async function runImmediateStateResultForWindow(
  window: BrowserWindow | null | undefined,
  action: () => Promise<DesktopAppState>,
): Promise<DesktopAppState> {
  const state = await action();
  if (!window || !canPublishToWindow(window)) {
    return state;
  }

  const webContentsId = window.webContents.id;
  const projected = projectStateForWindow(webContentsId, state);
  rememberWindowView(webContentsId, projected);
  return projected;
}

async function runWindowScopedStateResult<T extends { readonly state: DesktopAppState }>(
  window: BrowserWindow | null | undefined,
  action: () => Promise<T>,
  options: WindowScopedActionOptions = {},
): Promise<T> {
  return enqueueWindowScopedAction(async () => {
    const webContentsId = window && !window.isDestroyed() ? window.webContents.id : undefined;
    const foregroundWindow = getForegroundAppWindow();
    const senderIsForeground =
      Boolean(window && foregroundWindow && window.webContents.id === foregroundWindow.webContents.id);
    const windowIsFocused =
      Boolean(window && !window.isDestroyed() && window.isFocused()) ||
      senderIsForeground ||
      options.forceActiveWindow === true;
    if (window && webContentsId !== undefined) {
      if (windowIsFocused) {
        setActiveWindow(window);
      }
      applyWindowViewToStore(webContentsId);
    }

    const previousWindowScopedWebContentsId = currentWindowScopedWebContentsId;
    currentWindowScopedWebContentsId = webContentsId;
    try {
      const result = await action();
      if (!window || webContentsId === undefined) {
        return result;
      }

      const previousView = windowViews.get(webContentsId);
      const projected = projectStateForWindow(webContentsId, result.state, viewFromState(result.state), previousView);
      rememberWindowView(webContentsId, projected);
      return { ...result, state: projected };
    } finally {
      currentWindowScopedWebContentsId = previousWindowScopedWebContentsId;
      if (!applyDeferredWindowActivation()) {
        restoreStoreToForegroundUnlessSender(webContentsId);
      }
    }
  });
}

function createAppWindow(sourceView?: DesktopAppViewState): BrowserWindow {
  const window = createWindow();
  const webContentsId = window.webContents.id;
  appWindows.add(window);
  windowViews.set(webContentsId, resolveWindowView(sourceView));
  setActiveWindow(window);
  themeManager.trackWindow(window);
  attachStatePublisher(window);
  attachViewedSessionTracking(window);

  window.once("closed", () => {
    appWindows.delete(window);
    windowViews.delete(webContentsId);
    browserService?.disposeWindow(window);
    terminalFocusedWebContentsIds.delete(webContentsId);
    focusedTerminalIdByWebContentsId.delete(webContentsId);
    terminalService?.disposeWebContents(webContentsId);
    void store.cancelPendingDialogsWithoutVisibleWindow((sessionRef) => isSessionVisibleInAnotherWindow(sessionRef));
    if (mainWindow === window) {
      mainWindow = [...appWindows].find((candidate) => !candidate.isDestroyed()) ?? null;
      if (mainWindow) {
        setActiveWindow(mainWindow);
        applyWindowViewToStore(mainWindow.webContents.id);
      }
    }
    if (appWindows.size === 0) {
      terminalService?.dispose();
      terminalService = undefined;
    }
  });

  return window;
}

function attachStatePublisher(window: BrowserWindow): void {
  const webContentsId = window.webContents.id;
  const startPublishing = (recovery = false) => {
    stopPublishingStateByWebContentsId.get(webContentsId)?.();
    stopPublishingSelectedTranscriptByWebContentsId.get(webContentsId)?.();
    stopPublishingAssistantStreamByWebContentsId.get(webContentsId)?.();
    stopPublishingSessionMetadataByWebContentsId.get(webContentsId)?.();
    const stopPublishingState = store.subscribe((state) => {
      publishStateToWindow(window, state);
    });
    const stopPublishingSelectedTranscript = store.subscribeToSelectedTranscript((payload, sessionRef) => {
      const reason = recovery ? "recovery" : "selected-transcript";
      if (sessionRef) {
        publishSelectedTranscriptDetached(window, reason, payload);
      } else {
        publishSelectedTranscriptDetached(window, reason);
      }
    });
    const stopPublishingSessionMetadata = store.subscribeToSessionMetadata((patch) => {
      if (!canPublishToWindow(window)) {
        return;
      }
      window.webContents.send(desktopIpc.sessionMetadataPatch, patch);
    });
    const stopPublishingAssistantStream = store.subscribeToAssistantStream((patch) => {
      if (!canPublishToWindow(window)) {
        return;
      }
      const view = viewForWebContents(webContentsId);
      if (
        view.activeView !== "threads" ||
        view.selectedWorkspaceId !== patch.workspaceId ||
        view.selectedSessionId !== patch.sessionId
      ) {
        return;
      }
      if (process.env.PI_APP_TEST_MODE) {
        testAssistantStreamPatchDiagnostics.count += 1;
        testAssistantStreamPatchDiagnostics.payloadBytes += estimatePayloadBytes(patch);
      }
      window.webContents.send(desktopIpc.assistantStreamPatch, patch);
    });
    stopPublishingStateByWebContentsId.set(webContentsId, stopPublishingState);
    stopPublishingSelectedTranscriptByWebContentsId.set(webContentsId, stopPublishingSelectedTranscript);
    stopPublishingAssistantStreamByWebContentsId.set(webContentsId, stopPublishingAssistantStream);
    stopPublishingSessionMetadataByWebContentsId.set(webContentsId, stopPublishingSessionMetadata);
  };
  const stopPublishing = () => {
    stopPublishingStateByWebContentsId.get(webContentsId)?.();
    stopPublishingStateByWebContentsId.delete(webContentsId);
    stopPublishingSelectedTranscriptByWebContentsId.get(webContentsId)?.();
    stopPublishingSelectedTranscriptByWebContentsId.delete(webContentsId);
    stopPublishingAssistantStreamByWebContentsId.get(webContentsId)?.();
    stopPublishingAssistantStreamByWebContentsId.delete(webContentsId);
    stopPublishingSessionMetadataByWebContentsId.get(webContentsId)?.();
    stopPublishingSessionMetadataByWebContentsId.delete(webContentsId);
  };

  startPublishing();

  // A renderer crash detaches the (now-dead) subscriptions, but View > Reload
  // brings the same webContents back — re-subscribe on recovery so the reloaded
  // window resumes live state pushes instead of going permanently stale.
  let recovering = false;
  window.webContents.on("render-process-gone", () => {
    recovering = true;
    stopPublishing();
  });
  window.webContents.on("did-finish-load", () => {
    if (!recovering) {
      return;
    }
    recovering = false;
    startPublishing(true);
    // Push the current state immediately so the reloaded UI is fresh.
    publishStateToWindow(window);
  });
  window.once("closed", stopPublishing);
}

function attachViewedSessionTracking(window: BrowserWindow): void {
  const webContentsId = window.webContents.id;
  stopTrackingWindowActivationByWebContentsId.get(webContentsId)?.();

  const handleActivation = () => {
    if (currentWindowScopedWebContentsId !== undefined) {
      deferredActivationWebContentsId = webContentsId;
      return;
    }
    applyWindowActivation(window);
  };
  const clearTracking = () => {
    stopTrackingWindowActivationByWebContentsId.get(webContentsId)?.();
    stopTrackingWindowActivationByWebContentsId.delete(webContentsId);
  };

  window.on("focus", handleActivation);
  window.on("show", handleActivation);
  window.on("restore", handleActivation);
  window.once("closed", clearTracking);

  stopTrackingWindowActivationByWebContentsId.set(webContentsId, () => {
    window.off("focus", handleActivation);
    window.off("show", handleActivation);
    window.off("restore", handleActivation);
    window.off("closed", clearTracking);
  });
}

function canPublishToWindow(window: BrowserWindow): boolean {
  return !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isCrashed();
}

function resolveWindowTestMode(): "foreground" | "background" {
  return process.env.PI_APP_TEST_MODE?.trim().toLowerCase() === "background" ? "background" : "foreground";
}

function resolveDialogWindow(parentWindow?: BrowserWindow | null): BrowserWindow | undefined {
  if (parentWindow && canPublishToWindow(parentWindow)) {
    return parentWindow;
  }
  if (mainWindow && canPublishToWindow(mainWindow)) {
    return mainWindow;
  }
  return undefined;
}

async function stateForWindow(window?: BrowserWindow | null): Promise<DesktopAppState> {
  if (window && canPublishToWindow(window)) {
    return store.getStateForView(viewForWebContents(window.webContents.id));
  }
  return store.getState();
}

async function pickWorkspacePathViaDialog(parentWindow?: BrowserWindow | null): Promise<string | undefined> {
  const window = resolveDialogWindow(parentWindow);
  const result = window
    ? await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: mainT("native.openWorkspaceFolder"),
      })
    : await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: mainT("native.openWorkspaceFolder"),
      });
  if (result.canceled || result.filePaths.length === 0) {
    return undefined;
  }
  return result.filePaths[0] as string;
}

async function addPickedWorkspace(window: BrowserWindow | null | undefined, workspacePath: string): Promise<DesktopAppState> {
  const nextState = await store.addWorkspace(workspacePath);
  if (!nextState.selectedWorkspaceId) {
    return nextState;
  }
  const newThreadState =
    nextState.activeView === "new-thread" ? nextState : await store.setActiveView("new-thread");
  if (window) {
    window.webContents.send(desktopIpc.workspacePicked, nextState.selectedWorkspaceId);
  }
  return newThreadState;
}

async function pickWorkspaceViaDialog(parentWindow?: BrowserWindow | null): Promise<DesktopAppState> {
  const window = resolveDialogWindow(parentWindow);
  const workspacePath = await pickWorkspacePathViaDialog(window);
  if (!workspacePath) {
    return stateForWindow(window);
  }
  return runWindowScopedForWindow(window, () => addPickedWorkspace(window, workspacePath));
}

function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      id: applicationMenuIds.file,
      label: mainT("native.fileMenu"),
      submenu: [
        {
          id: NEW_WINDOW_MENU_ITEM_ID,
          label: mainT("native.newWindow"),
          accelerator: "CommandOrControl+N",
          click: () => {
            createAppWindow(getForegroundAppView());
          },
        },
        { type: "separator" },
        {
          id: OPEN_FOLDER_MENU_ITEM_ID,
          label: mainT("native.openFolder"),
          accelerator: "CommandOrControl+O",
          click: () => {
            void pickWorkspaceViaDialog(mainWindow);
          },
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      id: applicationMenuIds.edit,
      label: mainT("native.editMenu"),
      role: "editMenu",
      submenu: [
        { role: "undo", label: mainT("native.undo") },
        { role: "redo", label: mainT("native.redo") },
        { type: "separator" },
        { role: "cut", label: mainT("native.cut") },
        { role: "copy", label: mainT("native.copy") },
        { role: "paste", label: mainT("native.paste") },
        { role: "selectAll", label: mainT("native.selectAll") },
      ],
    },
    {
      id: applicationMenuIds.view,
      label: mainT("native.viewMenu"),
      role: "viewMenu",
      submenu: [
        { role: "reload", label: mainT("native.reload") },
        { role: "forceReload", label: mainT("native.forceReload") },
        { role: "toggleDevTools", label: mainT("native.toggleDevTools") },
        { type: "separator" },
        { role: "resetZoom", label: mainT("native.zoom") },
        { role: "zoomIn", label: mainT("native.zoom") },
        { role: "zoomOut", label: mainT("native.zoom") },
        { role: "togglefullscreen", label: mainT("native.toggleFullScreen") },
      ],
    },
    {
      id: applicationMenuIds.window,
      label: mainT("native.windowMenu"),
      role: "windowMenu",
      submenu: [
        { role: "minimize", label: mainT("native.minimize") },
        { role: "zoom", label: mainT("native.zoom") },
        { type: "separator" },
        { role: "togglefullscreen", label: mainT("native.toggleFullScreen") },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function isApplicationMenuId(value: unknown): value is ApplicationMenuId {
  return Object.values(applicationMenuIds).includes(value as ApplicationMenuId);
}

function showApplicationMenu(event: IpcMainInvokeEvent, input: ShowApplicationMenuInput): boolean {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (process.platform !== "win32" || !window || !isApplicationMenuId(input?.menuId)) {
    return false;
  }

  const menuItem = Menu.getApplicationMenu()?.getMenuItemById(input.menuId);
  if (!menuItem?.submenu) {
    return false;
  }

  const x = Number.isFinite(input.x) ? Math.max(0, Math.round(input.x)) : 0;
  const y = Number.isFinite(input.y) ? Math.max(0, Math.round(input.y)) : 0;
  menuItem.submenu.popup({ window, x, y });
  return true;
}

const augmentedPath = augmentMacPath();
if (augmentedPath.changed) {
  process.env.PATH = augmentedPath.path;
  if (process.platform === "win32") {
    process.env.Path = augmentedPath.path;
  }
}

if (process.platform === "win32") {
  app.setAppUserModelId(DESKTOP_APP_ID);
}
app.setName(APP_DISPLAY_NAME);

const configuredUserDataDir = process.env.PI_APP_USER_DATA_DIR?.trim()
  || path.join(app.getPath("appData"), LEGACY_USER_DATA_DIR_NAME);
app.setPath("userData", configuredUserDataDir);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  const window = getForegroundAppWindow() ?? startupWindow;
  if (!window) {
    pendingSecondInstanceActivation = true;
    return;
  }
  pendingSecondInstanceActivation = false;
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }

  // On macOS, packaged builds already render the dock icon from `icon.icns`
  // in the app bundle. In dev we override the generic Electron dock icon with
  // the real PNG so the running app looks right end-to-end.
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(appIcon);
  }

  const persistedUiState = await readPersistedUiState(path.join(configuredUserDataDir, "ui-state.json"));
  const initialThemeMode = persistedUiState.themeMode ?? (nativeTheme.shouldUseDarkColors ? "dark" : "light");
  const initialPersistedUiState = { ...persistedUiState, themeMode: initialThemeMode };
  appLanguage = initialPersistedUiState.appLanguage ?? appLanguage;
  setMainLanguage(appLanguage);
  themeManager.setMode(initialThemeMode);

  const useStartupWindow = !process.env.PI_APP_TEST_MODE || process.env.PI_APP_TEST_STARTUP_WINDOW === "1";
  if (useStartupWindow && !startupWindow) {
    startupWindow = createWindow({ loadRenderer: false });
    startupWindow.once("closed", () => {
      startupWindow = null;
    });
    if (pendingSecondInstanceActivation) {
      pendingSecondInstanceActivation = false;
      startupWindow.show();
      startupWindow.focus();
    }
  }

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const owner = BrowserWindow.fromWebContents(webContents);
    const mediaTypes = permission === "media" && "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
    const isAudioOnly = mediaTypes.length > 0 && mediaTypes.every((type) => type === "audio");
    callback(permission === "media" && isAudioOnly && Boolean(owner && appWindows.has(owner)));
  });

  browserService = new BrowserService({
    preloadPath: path.join(__dirname, "..", "preload", "browser-page.js"),
    userDataDir: configuredUserDataDir,
    onStateChanged: (target, state) => {
      for (const window of appWindows) {
        if (!canPublishToWindow(window)) continue;
        const view = viewForWebContents(window.webContents.id);
        if (view.selectedWorkspaceId === target.workspaceId && view.selectedSessionId === target.sessionId) {
          window.webContents.send(desktopIpc.browserStateChanged, state);
        }
      }
    },
    onElementSelected: (event) => {
      const ownerId = browserService?.getState(event.target).surfaceOwnerWebContentsId;
      const owner = ownerId ? windowForWebContentsId(ownerId) : undefined;
      const targets = owner ? [owner] : [...appWindows];
      for (const window of targets) {
        if (!canPublishToWindow(window)) continue;
        const view = viewForWebContents(window.webContents.id);
        if (view.selectedWorkspaceId === event.target.workspaceId && view.selectedSessionId === event.target.sessionId) {
          window.webContents.send(desktopIpc.browserElementSelected, event);
        }
      }
    },
  });
  await browserService.initialize();

  let generateThreadTitleOverride:
    | ((workspace: WorkspaceRef, options: GenerateThreadTitleOptions) => Promise<string | null | undefined>)
    | undefined;
  let deferredThreadTitle:
    | {
        resolve: (title: string | null) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  const orchestrationRuntimeBridge = createStoreBackedOrchestrationRuntimeBridge();
  const mcpConnectorService = new McpConnectorService(configuredUserDataDir);
  const capabilityCatalogService = new CapabilityCatalogService({
    userDataDir: configuredUserDataDir,
    connectors: mcpConnectorService,
  });
  await capabilityCatalogService.initialize();
  const driverOptions = {
    extensionFactories: [
      createOrchestrationRuntimeExtension(orchestrationRuntimeBridge),
      createComputerUseRuntimeExtension(() => store.state.computerUseEnabled),
      createBrowserRuntimeExtension(browserService!, sessionRefFromExtensionContext),
      createMcpRuntimeExtension(mcpConnectorService),
    ],
    sessionProfileFactory: async (context: { readonly workspace: WorkspaceRef; readonly sessionRef?: SessionRef }) => {
      if (context.sessionRef) {
        const mode = store.sessionState.collaborationModeBySession.get(sessionKey(context.sessionRef)) ?? "default";
        if (mode === "plan") {
          return {
            excludeTools: ["write", "edit"],
            customTools: createPlanTools(),
            resourceLoaderOptions: { appendSystemPrompt: [PLAN_MODE_SYSTEM_PROMPT] },
          };
        }
        return undefined;
      }
      return undefined;
    },
    inlineExtensionMetadata: [
      {
        displayName: "Thread orchestration",
        description: `Start child ${APP_DISPLAY_NAME} threads from transcript tool calls`,
      },
    ],
  };
  store = new DesktopAppStore({
    userDataDir: configuredUserDataDir,
    initialWorkspacePaths: resolveInitialWorkspacePaths(),
    defaultAppLanguage: appLanguage,
    initialPersistedUiState,
    getWindow: () => mainWindow,
    shouldKeepSessionDialogs: (sessionRef) => isSessionVisibleInAnotherWindow(sessionRef),
    driverOptions,
    generateThreadTitleOverride: async (workspace, options) => generateThreadTitleOverride?.(workspace, options),
  });
  const updateService = new UpdateService();
  await store.initialize();
  appLanguage = store.state.appLanguage;
  setMainLanguage(appLanguage);
  themeManager.setMode(store.state.themeMode);
  integratedTerminalShell = (await store.getState()).integratedTerminalShell;
  stopPruningTerminals = store.subscribe((state) => {
    integratedTerminalShell = state.integratedTerminalShell;
    const workspacePaths = state.workspaces.map((workspace) => workspace.path);
    const workspacePathSignature = workspacePaths.join("\0");
    if (workspacePathSignature !== retainedTerminalWorkspacePathSignature) {
      retainedTerminalWorkspacePathSignature = workspacePathSignature;
      terminalService?.retainWorkspacePaths(workspacePaths);
    }
  });
  installApplicationMenu();
  if (process.env.PI_APP_TEST_MODE) {
    Object.assign(globalThis, {
      __PI_APP_TEST_HOOKS: {
        emitSessionEvent: (event: SessionDriverEvent) => store.emitTestSessionEvent(event),
        emitSessionEvents: (events: readonly SessionDriverEvent[]) => store.emitTestSessionEvents(events),
        emitAssistantStreamPatch: (patch: AssistantStreamPatch) => store.emitTestAssistantStreamPatch(patch),
        suspendStreamPublishTimerForTest: () => store.suspendStreamPublishTimerForTest(),
        resumeStreamPublishTimerForTest: () => store.resumeStreamPublishTimerForTest(),
        waitForSessionEventIdle: () => waitForTestRendererPublications(),
        resetStreamDiagnostics: () => {
          testSelectedTranscriptPublicationCounts.clear();
          resetTestStatePublicationDiagnostics();
          store.resetStreamDiagnostics();
        },
        getSelectedTranscriptPublicationCounts: () => Object.fromEntries(testSelectedTranscriptPublicationCounts),
        invokeRendererRecoveryForTest: () => {
          if (!mainWindow) return;
          mainWindow.webContents.emit("render-process-gone", {} as Electron.Event, { reason: "crashed", exitCode: 1 });
          mainWindow.webContents.emit("did-finish-load");
        },
        recordRendererConvergence: () => store.recordRendererConvergence(),
        getStreamDiagnostics: () => ({
          ...store.getStreamDiagnostics(),
          stateIpcPublicationCount: testStatePublicationDiagnostics.count,
          stateIpcPublicationElapsedMs: testStatePublicationDiagnostics.elapsedMs,
          stateIpcPayloadBytes: testStatePublicationDiagnostics.payloadBytes,
          stateIpcMaxPayloadBytes: testStatePublicationDiagnostics.maxPayloadBytes,
          stateProjectionCount: testStatePublicationDiagnostics.projectionCount,
          stateProjectionElapsedMs: testStatePublicationDiagnostics.projectionElapsedMs,
          selectedTranscriptIpcPublicationCount: testSelectedTranscriptPublicationDiagnostics.count,
          selectedTranscriptIpcPublicationElapsedMs: testSelectedTranscriptPublicationDiagnostics.elapsedMs,
          selectedTranscriptIpcPayloadBytes: testSelectedTranscriptPublicationDiagnostics.payloadBytes,
          selectedTranscriptIpcMaxPayloadBytes: testSelectedTranscriptPublicationDiagnostics.maxPayloadBytes,
          assistantStreamPatchCount: testAssistantStreamPatchDiagnostics.count,
          assistantStreamPatchPayloadBytes: testAssistantStreamPatchDiagnostics.payloadBytes,
        }),
        installSessionEventFailureFixture: (eventType: SessionDriverEvent["type"]) => store.installTestSessionEventFailureFixture(eventType),
        getSessionEventFailureSequence: () => store.getTestSessionEventFailureSequence(),
        getPlatformEvidence: () => ({ mainProcessPlatform: process.platform, isPackaged: app.isPackaged }),
        handleWindowActivation: () => {
          if (mainWindow) {
            applyWindowActivation(mainWindow);
          }
        },
        promptForText: (message: string, placeholder?: string, allowEmpty?: boolean) =>
          promptForText(mainWindow, message, placeholder ?? "", allowEmpty ?? false),
        runOrchestrationRuntimeTool: (input: OrchestrationRuntimeToolTestInput) =>
          runOrchestrationRuntimeToolForTest(orchestrationRuntimeBridge, input),
        runBrowserRuntimeTool: (input: OrchestrationRuntimeToolTestInput) => runBrowserRuntimeToolForTest(input),
        setDeferredThreadTitleMode: () => {
          generateThreadTitleOverride = () =>
            new Promise<string | null>((resolve, reject) => {
              deferredThreadTitle = { resolve, reject };
            });
        },
        hasDeferredThreadTitle: () => Boolean(deferredThreadTitle),
        resolveDeferredThreadTitle: (title: string) => {
          if (!deferredThreadTitle) {
            throw new Error("Deferred thread-title request is unavailable");
          }
          const pending = deferredThreadTitle;
          deferredThreadTitle = undefined;
          pending.resolve(title);
        },
        rejectDeferredThreadTitle: () => {
          if (!deferredThreadTitle) {
            throw new Error("Deferred thread-title request is unavailable");
          }
          const pending = deferredThreadTitle;
          deferredThreadTitle = undefined;
          pending.reject(new Error("Deferred thread-title rejected by test"));
        },
      },
    });
  }
  notificationPermissionService = new NotificationPermissionService(() => mainWindow);
  notificationPermissionService.subscribe((status) => {
    for (const window of appWindows) {
      if (canPublishToWindow(window)) {
        window.webContents.send(desktopIpc.notificationPermissionStatusChanged, status);
      }
    }
  });
  notificationManager = new NotificationManager(
    store,
    () => mainWindow,
    notificationPermissionService,
    async (sessionRef) => {
      const window = getForegroundAppWindow();
      await runWindowScopedForWindow(window, () => store.selectSession(sessionRef), { forceActiveWindow: true });
    },
  );
  stopNotifications = notificationManager.start();
  ipcMain.handle(desktopIpc.ping, () =>
    devReloadMarkersEnabled ? `pi-frame ready:${MAIN_DEV_RELOAD_MARKER}` : "pi-frame ready",
  );
  ipcMain.handle(desktopIpc.getThemeMode, () => themeManager.getMode());
  ipcMain.handle(desktopIpc.getResolvedTheme, () => themeManager.getResolvedTheme());
  ipcMain.handle(desktopIpc.setThemeMode, async (event, mode: ThemeMode) => {
    const nextState = await runWindowScopedForEvent(event, () => store.setThemeMode(mode));
    themeManager.setMode(nextState.themeMode);
    return nextState;
  });
  ipcMain.handle(desktopIpc.setThemeId, async (event, themeId: string) => {
    const nextState = await runWindowScopedForEvent(event, () => store.setThemeId(themeId));
    themeManager.setMode(nextState.themeMode);
    return nextState;
  });
  ipcMain.handle(desktopIpc.importVSCodeTheme, async () => {
    const nextState = await store.importVSCodeTheme();
    if (nextState) {
      themeManager.setMode(nextState.themeMode);
    }
    return nextState;
  });
  ipcMain.handle(desktopIpc.deleteCustomTheme, async (event, themeId: string) => {
    const nextState = await runWindowScopedForEvent(event, () => store.deleteCustomTheme(themeId));
    themeManager.setMode(nextState.themeMode);
    return nextState;
  });
  ipcMain.handle(desktopIpc.openExternal, (_event, url: string) => {
    const parsed = parseExternalWebUrl(url);
    if (!parsed) {
      throw new Error(`Refusing to open unsupported URL: ${url}`);
    }
    return shell.openExternal(parsed.toString());
  });
  ipcMain.handle(desktopIpc.stateRequest, (event) => store.getStateForView(viewForWebContents(event.sender.id)));
  ipcMain.handle(desktopIpc.selectedTranscriptRequest, (event) =>
    store.getSelectedTranscriptForView(viewForWebContents(event.sender.id)),
  );
  ipcMain.handle(desktopIpc.browserGetState, (event, target: BrowserSessionTarget) => {
    assertBrowserTarget(event.sender.id, target);
    if (!browserService) throw new Error("Browser service is unavailable");
    return browserService.getState(target);
  });
  ipcMain.handle(desktopIpc.browserCommand, async (event, target: BrowserSessionTarget, command: BrowserCommand) => {
    assertBrowserTarget(event.sender.id, target);
    if (!browserService) throw new Error("Browser service is unavailable");
    return browserService.command(target, command);
  });
  ipcMain.handle(desktopIpc.browserSetSurface, (event, input: BrowserSurfaceBounds) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !browserService) throw new Error("Browser surface is unavailable");
    if (input.visible) {
      assertBrowserTarget(event.sender.id, input.target);
    } else if (
      !input.target ||
      typeof input.target.workspaceId !== "string" ||
      typeof input.target.sessionId !== "string"
    ) {
      throw new Error("Invalid browser surface target");
    }
    return browserService.setSurface(window, input);
  });
  ipcMain.handle(desktopIpc.addWorkspacePath, (event, workspacePath: string) =>
    runWindowScopedForEvent(event, () => store.addWorkspace(workspacePath)),
  );
  ipcMain.handle(desktopIpc.pickWorkspace, (event) =>
    pickWorkspaceViaDialog(BrowserWindow.fromWebContents(event.sender)),
  );
  ipcMain.handle(desktopIpc.selectWorkspace, (event, workspaceId: string) =>
    runWindowScopedForEvent(event, () => store.selectWorkspace(workspaceId)),
  );
  ipcMain.handle(desktopIpc.renameWorkspace, (event, workspaceId: string, displayName: string) =>
    runWindowScopedForEvent(event, () => store.renameWorkspace(workspaceId, displayName)),
  );
  ipcMain.handle(desktopIpc.removeWorkspace, (event, workspaceId: string) =>
    runWindowScopedForEvent(event, () => store.removeWorkspace(workspaceId)),
  );
  ipcMain.handle(desktopIpc.reorderWorkspaces, (event, order: readonly string[]) =>
    runWindowScopedForEvent(event, () => store.reorderWorkspaces(order)),
  );
  ipcMain.handle(desktopIpc.reorderPinnedSessions, (event, order: readonly string[]) =>
    runWindowScopedForEvent(event, () => store.reorderPinnedSessions(order)),
  );
  ipcMain.handle(desktopIpc.openWorkspaceInFinder, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await shell.openPath(workspacePath);
  });
  ipcMain.handle(desktopIpc.createWorktree, (event, input: CreateWorktreeInput) =>
    runWindowScopedForEvent(event, () => store.createWorktree(input)),
  );
  ipcMain.handle(desktopIpc.removeWorktree, (event, input: RemoveWorktreeInput) =>
    runWindowScopedForEvent(event, () => store.removeWorktree(input)),
  );
  ipcMain.handle(desktopIpc.syncCurrentWorkspace, (event) =>
    runWindowScopedForEvent(event, () => store.syncCurrentWorkspace()),
  );
  ipcMain.handle(desktopIpc.selectSession, (event, target: WorkspaceSessionTarget) =>
    runWindowScopedForEvent(event, () => store.selectSession(target)),
  );
  ipcMain.handle(desktopIpc.renameSession, (event, target: WorkspaceSessionTarget, title: string) =>
    runWindowScopedForEvent(event, () => store.renameSession(target, title)),
  );
  ipcMain.handle(desktopIpc.archiveSession, (event, target: WorkspaceSessionTarget) =>
    runWindowScopedForEvent(event, () => store.archiveSession(target)),
  );
  ipcMain.handle(desktopIpc.unarchiveSession, (event, target: WorkspaceSessionTarget) =>
    runWindowScopedForEvent(event, () => store.unarchiveSession(target)),
  );
  ipcMain.handle(desktopIpc.deleteSession, (event, target: WorkspaceSessionTarget) =>
    runWindowScopedForEvent(event, () => store.deleteSession(target)),
  );
  ipcMain.handle(desktopIpc.markSessionRead, (event, target: WorkspaceSessionTarget) =>
    runWindowScopedForEvent(event, () => store.markSessionRead(target)),
  );
  ipcMain.handle(desktopIpc.setSessionPinned, (event, target: WorkspaceSessionTarget, pinned: boolean) =>
    runWindowScopedForEvent(event, () => store.setSessionPinned(target, pinned)),
  );
  ipcMain.handle(desktopIpc.setActiveView, (event, activeView) =>
    runWindowScopedForEvent(event, () => store.setActiveView(activeView)),
  );
  ipcMain.handle(desktopIpc.setSidebarCollapsed, (event, collapsed: boolean) =>
    runWindowScopedForEvent(event, () => store.setSidebarCollapsed(collapsed)),
  );
  ipcMain.handle(desktopIpc.setWorkspaceCollapsed, (event, workspaceId: string, collapsed: boolean) =>
    runWindowScopedForEvent(event, () => store.setWorkspaceCollapsed(workspaceId, collapsed)),
  );
  ipcMain.handle(desktopIpc.refreshRuntime, (event, workspaceId?: string) =>
    runWindowScopedForEvent(event, () => store.refreshRuntime(workspaceId)),
  );
  ipcMain.handle(desktopIpc.getCapabilityCenter, (_event, refresh?: boolean) =>
    capabilityCatalogService.snapshot(refresh),
  );
  ipcMain.handle(desktopIpc.listCapabilityPackages, (_event, workspaceId: string) =>
    store.listCapabilityPackages(workspaceId),
  );
  ipcMain.handle(desktopIpc.installCapabilityPackage, (event, input: InstallCapabilityPackageInput) =>
    runWindowScopedForEvent(event, () => store.installCapabilityPackage(input.workspaceId, input.source, input.scope)),
  );
  ipcMain.handle(desktopIpc.removeCapabilityPackage, (event, input: InstallCapabilityPackageInput) =>
    runWindowScopedForEvent(event, () => store.removeCapabilityPackage(input.workspaceId, input.source, input.scope)),
  );
  ipcMain.handle(desktopIpc.setCapabilityConnector, (event, workspaceId: string, input: SetCapabilityConnectorInput) =>
    runWindowScopedForEvent(event, async () => {
      await mcpConnectorService.setConnector(input);
      return store.reloadCapabilities(workspaceId);
    }),
  );
  ipcMain.handle(desktopIpc.reconnectCapabilityConnector, (event, workspaceId: string, connectorId: string) =>
    runWindowScopedForEvent(event, async () => {
      await mcpConnectorService.reconnect(connectorId);
      return store.reloadCapabilities(workspaceId);
    }),
  );
  ipcMain.handle(desktopIpc.checkForUpdates, async (_event, workspaceId?: string) => {
    const core = await updateService.check();
    if (!workspaceId) {
      return { ...core, extensions: [] };
    }
    try {
      return { ...core, extensions: await store.checkForExtensionUpdates(workspaceId) };
    } catch (error) {
      return {
        ...core,
        extensions: [],
        extensionError: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.handle(desktopIpc.installAppUpdate, () => updateService.installAppUpdate());
  ipcMain.handle(desktopIpc.updateExtensions, (event, workspaceId: string, sources?: readonly string[]) =>
    runWindowScopedForEvent(event, () => store.updateExtensions(workspaceId, sources)),
  );
  ipcMain.handle(desktopIpc.getModelConfiguration, () => store.getModelConfiguration());
  ipcMain.handle(desktopIpc.saveModelConfiguration, (event, input: SaveModelConfigurationInput) =>
    runWindowScopedForEvent(event, () => store.saveModelConfiguration(input)),
  );
  ipcMain.handle(desktopIpc.deleteModelConfiguration, (event, input: DeleteModelConfigurationInput) =>
    runWindowScopedForEvent(event, () => store.deleteModelConfiguration(input)),
  );
  ipcMain.handle(desktopIpc.setModelConfigurationDefaults, (event, input: ModelConfigurationDefaultsInput) =>
    runWindowScopedForEvent(event, () => store.setModelConfigurationDefaults(input)),
  );
  ipcMain.handle(desktopIpc.setSessionModel, (event, workspaceId: string, sessionId: string, provider: string, modelId: string) =>
    runWindowScopedForEvent(event, () => store.setSessionModel({ workspaceId, sessionId }, provider, modelId)),
  );
  ipcMain.handle(desktopIpc.setDefaultModel, (event, workspaceId: string, provider: string, modelId: string) =>
    runWindowScopedForEvent(event, () => store.setDefaultModel(workspaceId, provider, modelId)),
  );
  ipcMain.handle(
    desktopIpc.setDefaultThinkingLevel,
    (event, workspaceId: string, thinkingLevel) =>
      runWindowScopedForEvent(event, () => store.setDefaultThinkingLevel(workspaceId, thinkingLevel)),
  );
  ipcMain.handle(
    desktopIpc.setSessionThinkingLevel,
    (event, workspaceId: string, sessionId: string, thinkingLevel) =>
      runWindowScopedForEvent(event, () => store.setSessionThinkingLevel({ workspaceId, sessionId }, thinkingLevel)),
  );
  ipcMain.handle(desktopIpc.loginProvider, (event, workspaceId: string, providerId: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return runUnscopedStateResultForWindow(window, () =>
      store.loginProvider(workspaceId, providerId, createRuntimeLoginCallbacks(window)),
    );
  });
  ipcMain.handle(desktopIpc.logoutProvider, (event, workspaceId: string, providerId: string) =>
    runWindowScopedForEvent(event, () => store.logoutProvider(workspaceId, providerId)),
  );
  ipcMain.handle(desktopIpc.setProviderApiKey, (event, workspaceId: string, providerId: string, apiKey: string) =>
    runWindowScopedForEvent(event, () => store.setProviderApiKey(workspaceId, providerId, apiKey)),
  );
  ipcMain.handle(desktopIpc.setEnableSkillCommands, (event, workspaceId: string, enabled: boolean) =>
    runWindowScopedForEvent(event, () => store.setEnableSkillCommands(workspaceId, enabled)),
  );
  ipcMain.handle(desktopIpc.probeCustomProviderModels, (_event, input: CustomProviderProbeInput) =>
    probeCustomProviderModels(input),
  );
  ipcMain.handle(desktopIpc.setScopedModelPatterns, (event, workspaceId: string, patterns: readonly string[]) =>
    runWindowScopedForEvent(event, () => store.setScopedModelPatterns(workspaceId, patterns)),
  );
  ipcMain.handle(desktopIpc.setSkillEnabled, (event, workspaceId: string, filePath: string, enabled: boolean) =>
    runWindowScopedForEvent(event, () => store.setSkillEnabled(workspaceId, filePath, enabled)),
  );
  ipcMain.handle(desktopIpc.setExtensionEnabled, (event, workspaceId: string, filePath: string, enabled: boolean) =>
    runWindowScopedForEvent(event, () => store.setExtensionEnabled(workspaceId, filePath, enabled)),
  );
  ipcMain.handle(desktopIpc.respondToHostUiRequest, (event, workspaceId: string, sessionId: string, response) =>
    runImmediateStateResultForWindow(
      BrowserWindow.fromWebContents(event.sender),
      () => store.respondToHostUiRequest({ workspaceId, sessionId }, response),
    ),
  );
  ipcMain.handle(desktopIpc.setNotificationPreferences, (event, preferences) =>
    runWindowScopedForEvent(event, () => store.setNotificationPreferences(preferences)),
  );
  ipcMain.handle(desktopIpc.setIntegratedTerminalShell, (event, shellPath: string) =>
    runWindowScopedForEvent(event, () => store.setIntegratedTerminalShell(shellPath)),
  );
  ipcMain.handle(desktopIpc.setCustomProvider, (event, workspaceId: string, config: CustomProviderConfig) =>
    runWindowScopedForEvent(event, () => store.setCustomProvider(workspaceId, config)),
  );
  ipcMain.handle(desktopIpc.deleteCustomProvider, (event, workspaceId: string, providerId: string) =>
    runWindowScopedForEvent(event, () => store.deleteCustomProvider(workspaceId, providerId)),
  );
  ipcMain.handle(desktopIpc.setShortcutBindings, (event, bindings) =>
    runWindowScopedForEvent(event, () => store.setShortcutBindings(bindings)),
  );
  ipcMain.handle(desktopIpc.setAppLanguage, async (event, language: AppLanguage) => {
    if (!isAppLanguage(language)) {
      throw new Error(`Unsupported app language: ${String(language)}`);
    }
    appLanguage = language;
    setMainLanguage(language);
    installApplicationMenu();
    const nextState = await runWindowScopedForEvent(event, () => store.setAppLanguage(language));
    return nextState;
  });
  ipcMain.handle(desktopIpc.setComputerUseEnabled, (event, enabled: boolean) =>
    runWindowScopedForEvent(event, () => store.setComputerUseEnabled(enabled)),
  );
  ipcMain.handle(desktopIpc.terminalEnsurePanel, (event, workspaceId: string, terminalScopeId: string, size) => {
    return getTerminalService().ensurePanel(event.sender, workspaceId, terminalScopeId, size);
  });
  ipcMain.handle(desktopIpc.terminalCreateSession, (event, workspaceId: string, terminalScopeId: string, size) => {
    return getTerminalService().createSession(event.sender, workspaceId, terminalScopeId, size);
  });
  ipcMain.handle(desktopIpc.terminalSetActiveSession, (event, workspaceId: string, terminalScopeId: string, terminalId: string) => {
    return getTerminalService().setActiveSession(event.sender, workspaceId, terminalScopeId, terminalId);
  });
  ipcMain.handle(desktopIpc.terminalWrite, (event, terminalId: string, data: string) => {
    terminalService?.write(event.sender, terminalId, data);
  });
  ipcMain.handle(desktopIpc.terminalResize, (event, terminalId: string, size) => {
    terminalService?.resize(event.sender, terminalId, size);
  });
  ipcMain.handle(desktopIpc.terminalRestartSession, (event, terminalId: string, size) => {
    return getTerminalService().restart(event.sender, terminalId, size);
  });
  ipcMain.handle(desktopIpc.terminalCloseSession, (event, terminalId: string) => {
    return getTerminalService().close(event.sender, terminalId);
  });
  ipcMain.handle(desktopIpc.terminalSetTitle, (event, terminalId: string, title: string) => {
    terminalService?.setTitle(event.sender, terminalId, title);
  });
  ipcMain.on(desktopIpc.terminalSetFocused, (event, focused: boolean, terminalId?: string) => {
    if (focused && terminalId) {
      terminalFocusedWebContentsIds.add(event.sender.id);
      focusedTerminalIdByWebContentsId.set(event.sender.id, terminalId);
    } else {
      terminalFocusedWebContentsIds.delete(event.sender.id);
      focusedTerminalIdByWebContentsId.delete(event.sender.id);
    }
  });
  ipcMain.handle(desktopIpc.getNotificationPermissionStatus, () =>
    notificationPermissionService?.getCurrentStatus() ?? Promise.resolve("unknown"),
  );
  ipcMain.handle(desktopIpc.requestNotificationPermission, () =>
    notificationPermissionService?.requestPermission() ?? Promise.resolve("unknown"),
  );
  ipcMain.handle(desktopIpc.openSystemNotificationSettings, () =>
    notificationPermissionService?.openSystemSettings() ?? Promise.resolve(),
  );
  ipcMain.handle(desktopIpc.requestMicrophonePermission, async () => {
    if (process.platform !== "darwin") {
      return "granted" as const;
    }
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") {
      return "granted" as const;
    }
    if (status === "denied" || status === "restricted") {
      return "denied" as const;
    }
    return (await systemPreferences.askForMediaAccess("microphone")) ? "granted" as const : "denied" as const;
  });
  ipcMain.handle(desktopIpc.transcribeVoice, (_event, input: VoiceTranscriptionInput) =>
    voiceRecognitionService.transcribe(input),
  );
  ipcMain.handle(desktopIpc.cancelVoiceTranscription, (_event, requestId: string) => {
    voiceRecognitionService.cancel(requestId);
  });
  ipcMain.handle(desktopIpc.createSession, (event, input: CreateSessionInput) =>
    runWindowScopedForEvent(event, () => store.createSession(input)),
  );
  ipcMain.handle(desktopIpc.startThread, (event, input: StartThreadInput) =>
    runWindowScopedForEvent(event, () => store.startThread(input)),
  );
  ipcMain.handle(desktopIpc.forkThread, (event, input: ForkThreadInput) =>
    runWindowScopedForEvent(event, () => store.forkThread(input)),
  );
  ipcMain.handle(desktopIpc.sendChildThreadFollowUp, (event, input: SendChildThreadFollowUpInput) =>
    runWindowScopedForEvent(event, () => store.sendChildThreadFollowUp(input)),
  );
  ipcMain.handle(desktopIpc.setChildSupervisionLoop, (event, input: SetChildSupervisionLoopInput) =>
    runWindowScopedForEvent(event, () => store.setChildSupervisionLoop(input)),
  );
  ipcMain.handle(desktopIpc.openSkillInFinder, async (_event, workspaceId: string, filePath: string) => {
    const resolved = store.getSkillFilePath(workspaceId, filePath);
    if (!resolved) {
      throw new Error(`Unknown skill: ${filePath}`);
    }
    await shell.openPath(path.dirname(resolved));
  });
  ipcMain.handle(desktopIpc.openExtensionInFinder, async (_event, workspaceId: string, filePath: string) => {
    const resolved = store.getExtensionFilePath(workspaceId, filePath);
    if (!resolved) {
      throw new Error(`Unknown extension: ${filePath}`);
    }
    await shell.openPath(path.dirname(resolved));
  });
  ipcMain.handle(desktopIpc.cancelCurrentRun, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const view = viewForWebContents(event.sender.id);
    const sessionRef = view.selectedWorkspaceId && view.selectedSessionId
      ? { workspaceId: view.selectedWorkspaceId, sessionId: view.selectedSessionId }
      : undefined;
    return runImmediateStateResultForWindow(
      window,
      () => sessionRef ? store.cancelCurrentRun(sessionRef) : store.getState(),
    );
  });
  ipcMain.handle(desktopIpc.pickComposerAttachments, async (event) => {
    const window = resolveDialogWindow(BrowserWindow.fromWebContents(event.sender));
    const result =
      window
        ? await dialog.showOpenDialog(window, {
            properties: ["openFile", "multiSelections"],
            title: mainT("native.attachFiles"),
          })
        : await dialog.showOpenDialog({
            properties: ["openFile", "multiSelections"],
            title: mainT("native.attachFiles"),
          });
    if (result.canceled || result.filePaths.length === 0) {
      return stateForWindow(window);
    }
    const attachments = await Promise.all(result.filePaths.map(readComposerAttachment));
    return runWindowScopedForWindow(window, () => store.addComposerAttachments(attachments));
  });
  ipcMain.on(desktopIpc.readClipboardImage, (event) => {
    event.returnValue = readClipboardImageAttachment();
  });
  ipcMain.on(desktopIpc.readClipboardText, (event) => {
    event.returnValue = clipboard.readText();
  });
  ipcMain.handle(desktopIpc.addComposerAttachments, (event, attachments: readonly ComposerAttachment[]) => {
    const validated = attachments.flatMap(validateComposerAttachmentPayload);
    return runWindowScopedForEvent(event, () => store.addComposerAttachments(validated));
  });
  ipcMain.handle(desktopIpc.removeComposerAttachment, (event, attachmentId: string) =>
    runWindowScopedForEvent(event, () => store.removeComposerAttachment(attachmentId)),
  );
  ipcMain.handle(desktopIpc.editQueuedComposerMessage, (event, messageId: string, currentDraft?: string) =>
    runWindowScopedForEvent(event, () => store.editQueuedComposerMessage(messageId, currentDraft)),
  );
  ipcMain.handle(desktopIpc.cancelQueuedComposerEdit, (event) =>
    runWindowScopedForEvent(event, () => store.cancelQueuedComposerEdit()),
  );
  ipcMain.handle(desktopIpc.removeQueuedComposerMessage, (event, messageId: string) =>
    runWindowScopedForEvent(event, () => store.removeQueuedComposerMessage(messageId)),
  );
  ipcMain.handle(desktopIpc.steerQueuedComposerMessage, (event, messageId: string) =>
    runWindowScopedForEvent(event, () => store.steerQueuedComposerMessage(messageId)),
  );
  ipcMain.handle(desktopIpc.updateComposerDraft, (event, composerDraft: string) =>
    runWindowScopedForEvent(event, async () => {
      currentComposerDraftPersistOriginWebContentsId = event.sender.id;
      try {
        return await store.updateComposerDraft(composerDraft);
      } finally {
        currentComposerDraftPersistOriginWebContentsId = undefined;
      }
    }),
  );
  ipcMain.handle(
    desktopIpc.submitComposer,
    (event, text: string, options?: {
      readonly deliverAs?: "steer" | "followUp";
      readonly preserveComposer?: boolean;
    }) =>
      runWindowScopedForEvent(event, () => store.submitComposer(text, options)),
  );
  ipcMain.handle(desktopIpc.getSessionTree, (_event, target: WorkspaceSessionTarget) =>
    store.getSessionTree(target),
  );
  ipcMain.handle(
    desktopIpc.navigateSessionTree,
    (event, target: WorkspaceSessionTarget, targetId: string, options) =>
      runWindowScopedStateResult(BrowserWindow.fromWebContents(event.sender), () =>
        store.navigateSessionTree(target, targetId, options),
      ),
  );
  ipcMain.handle(desktopIpc.listWorkspaceFiles, async (_event, workspaceId: string, options?: { readonly force?: boolean }) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return [];
    }
    return listWorkspaceFiles(workspacePath, options);
  });
  ipcMain.handle(desktopIpc.readWorkspaceFile, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    return readWorkspaceFile(workspacePath, filePath);
  });
  ipcMain.handle(desktopIpc.getChangedFiles, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return [];
    }
    return getChangedFiles(workspacePath);
  });
  ipcMain.handle(desktopIpc.getFileDiff, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return "";
    }
    return getFileDiff(workspacePath, filePath);
  });
  ipcMain.handle(desktopIpc.stageFile, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await stageFile(workspacePath, filePath);
  });
  ipcMain.handle(desktopIpc.showApplicationMenu, showApplicationMenu);
  ipcMain.handle(desktopIpc.toggleWindowMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }

    if (window.isMaximized()) {
      window.unmaximize();
      return;
    }

    window.maximize();
  });

  const initialWindow = createAppWindow();
  const windowBeingReplaced = startupWindow;
  if (windowBeingReplaced && !windowBeingReplaced.isDestroyed()) {
    let replaced = false;
    const cleanupStartupWindow = () => {
      if (replaced) return;
      replaced = true;
      if (!windowBeingReplaced.isDestroyed()) {
        windowBeingReplaced.destroy();
      }
      if (startupWindow === windowBeingReplaced) {
        startupWindow = null;
      }
    };

    // Keep the painted startup surface in place until the renderer has a frame
    // ready, so native window chrome never exposes the desktop between windows.
    initialWindow.once("ready-to-show", cleanupStartupWindow);

    // Fallback: If ready-to-show is delayed or missed, ensure startup window is cleaned up and initial window is shown
    const fallbackTimer = setTimeout(() => {
      if (!replaced && !initialWindow.isDestroyed()) {
        if (windowTestMode !== "background") {
          initialWindow.show();
        }
        cleanupStartupWindow();
      }
    }, 10_000);

    initialWindow.once("closed", () => {
      clearTimeout(fallbackTimer);
      cleanupStartupWindow();
    });

    initialWindow.webContents.once("did-fail-load", (_event, errorCode, errorDescription) => {
      clearTimeout(fallbackTimer);
      console.error(`[pi-frame] renderer failed to load: ${errorCode} (${errorDescription})`);
      cleanupStartupWindow();
      showStartupFailure(new Error(`Failed to load renderer: ${errorDescription} (${errorCode})`));
    });
  } else {
    startupWindow = null;
  }
  if (pendingSecondInstanceActivation) {
    pendingSecondInstanceActivation = false;
    initialWindow.once("ready-to-show", () => {
      initialWindow.show();
      initialWindow.focus();
    });
  }
  void notificationPermissionService.getCurrentStatus();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAppWindow();
      void notificationPermissionService?.getCurrentStatus();
    }
  });
}).catch((error: unknown) => {
  console.error("[pi-frame] application startup failed", error);
  if (hasSingleInstanceLock) {
    showStartupFailure(error);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopNotifications?.();
    stopNotifications = undefined;
    notificationManager = undefined;
    notificationPermissionService?.dispose();
    notificationPermissionService = undefined;
    stopPruningTerminals?.();
    stopPruningTerminals = undefined;
    terminalService?.dispose();
    terminalService = undefined;
    app.quit();
  }
});

app.on("before-quit", (event) => {
  voiceRecognitionService.dispose();
  browserService?.dispose();
  browserService = undefined;
  stopNotifications?.();
  stopNotifications = undefined;
  notificationManager = undefined;
  notificationPermissionService?.dispose();
  notificationPermissionService = undefined;
  stopPruningTerminals?.();
  stopPruningTerminals = undefined;
  terminalService?.dispose();
  terminalService = undefined;
  if (quittingAfterStoreFlush || !store) {
    return;
  }

  event.preventDefault();
  quittingAfterStoreFlush = true;
  const flush = store
    .flushPersistence()
    .catch((error) => {
      console.error("pi-gui: persistence flush failed during quit:", error);
    });
  // Never let a hung flush block quit forever — quit after a bounded wait.
  const flushDeadline = new Promise<void>((resolve) => {
    setTimeout(() => {
      console.warn("pi-gui: persistence flush timed out during quit; quitting anyway.");
      resolve();
    }, QUIT_FLUSH_TIMEOUT_MS);
  });
  void Promise.race([flush, flushDeadline]).finally(() => {
    app.quit();
  });
});

function resolveInitialWorkspacePaths(): readonly string[] {
  const raw = process.env.PI_APP_INITIAL_WORKSPACES;
  if (raw !== undefined) {
    return raw
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

async function readComposerAttachment(filePath: string): Promise<ComposerAttachment> {
  const mimeType = mimeTypeForPath(filePath);
  if (mimeType.startsWith("image/")) {
    return readComposerImageAttachment(filePath, mimeType);
  }

  const stats = await stat(filePath);
  return {
    id: randomUUID(),
    kind: "file",
    name: path.basename(filePath),
    mimeType,
    fsPath: filePath,
    ...(typeof stats.size === "number" ? { sizeBytes: stats.size } : {}),
  };
}

async function readComposerImageAttachment(filePath: string, mimeType: string): Promise<ComposerImageAttachment> {
  const buffer = await readFile(filePath);
  return {
    id: randomUUID(),
    kind: "image",
    name: path.basename(filePath),
    mimeType,
    data: buffer.toString("base64"),
  };
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const supported = SUPPORTED_IMAGE_TYPES.find((type) => type.extension === extension);
  if (supported) {
    return supported.mimeType;
  }
  return "application/octet-stream";
}

function validateComposerAttachmentPayload(attachment: ComposerAttachment): ComposerAttachment[] {
  if (attachment.kind === "image") {
    if (typeof attachment.data !== "string" || typeof attachment.mimeType !== "string" || !SUPPORTED_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
      return [];
    }
    return [
      {
        ...attachment,
        kind: "image",
      },
    ];
  }

  if (attachment.kind === "browser-element") {
    if (
      typeof attachment.id !== "string" ||
      typeof attachment.name !== "string" ||
      typeof attachment.tabId !== "string" ||
      typeof attachment.capturedAt !== "string" ||
      typeof attachment.frameUrl !== "string" ||
      typeof attachment.page?.url !== "string" ||
      typeof attachment.page?.title !== "string" ||
      typeof attachment.page?.revision !== "number" ||
      typeof attachment.element?.tag !== "string" ||
      !attachment.element.attributes ||
      typeof attachment.element.attributes !== "object" ||
      typeof attachment.element.locator?.kind !== "string" ||
      typeof attachment.element.locator?.value !== "string" ||
      typeof attachment.element.locator?.unique !== "boolean" ||
      !Array.isArray(attachment.element.ancestors)
    ) {
      return [];
    }
    const serialized = JSON.stringify(attachment);
    if (Buffer.byteLength(serialized, "utf8") > 8192) return [];
    return [{ ...attachment } satisfies BrowserElementAttachment];
  }

  if (
    attachment.kind !== "file" ||
    typeof attachment.fsPath !== "string" ||
    typeof attachment.mimeType !== "string" ||
    typeof attachment.name !== "string"
  ) {
    return [];
  }

  const normalized: ComposerFileAttachment = {
    ...attachment,
    kind: "file",
    fsPath: attachment.fsPath.trim(),
    name: attachment.name.trim() || path.basename(attachment.fsPath),
  };
  if (!normalized.fsPath) {
    return [];
  }
  return [normalized];
}

function createRuntimeLoginCallbacks(window?: BrowserWindow | null) {
  return {
    onAuth: async ({ url, instructions }: { readonly url: string; readonly instructions?: string }) => {
      await shell.openExternal(url);
      if (instructions?.trim()) {
        await showLoginInstructions(window, instructions.trim());
      }
    },
    onPrompt: async ({ message, placeholder, allowEmpty }: { readonly message: string; readonly placeholder?: string; readonly allowEmpty?: boolean }) =>
      promptForText(window, message, placeholder, allowEmpty ?? false),
  };
}

async function showLoginInstructions(parentWindow: BrowserWindow | null | undefined, message: string): Promise<void> {
  const window = resolveDialogWindow(parentWindow);
  if (!window) {
    throw new Error("Main window is not available for login instructions.");
  }
  window.show();
  window.focus();
  await window.webContents.executeJavaScript(`window.alert(${JSON.stringify(message)})`, true);
}

// Electron does not implement window.prompt(), so provider-login text prompts
// are served by a small dedicated modal window instead.
async function promptForText(
  parentWindow: BrowserWindow | null | undefined,
  message: string,
  placeholder = "",
  allowEmpty = false,
): Promise<string> {
  const parent = resolveDialogWindow(parentWindow);
  if (!parent) {
    throw new Error("Main window is not available for login.");
  }
  parent.show();
  parent.focus();

  const modal = new BrowserWindow({
    parent,
    modal: true,
    show: false,
    width: 460,
    height: 220,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: APP_DISPLAY_NAME,
    icon: appIcon,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });

  try {
    await modal.loadURL(promptDataUrl(message, placeholder));
    modal.show();
    modal.focus();

    const result = await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      // Closing the window (title-bar close) counts as a cancel.
      modal.once("closed", () => finish(null));
      // The page wires its own buttons on load and exposes the outcome as a
      // promise; awaiting it here avoids any handler-attachment race.
      modal.webContents
        .executeJavaScript("window.__piPromptResult", true)
        .then((value) => finish(typeof value === "string" ? value : null))
        .catch(() => finish(null));
    });

    if (result === null) {
      throw new Error("Login cancelled.");
    }
    const trimmedResult = result.trim();
    if (!allowEmpty && trimmedResult.length === 0) {
      throw new Error("Login cancelled.");
    }
    return trimmedResult;
  } finally {
    if (!modal.isDestroyed()) {
      modal.destroy();
    }
  }
}

function promptDataUrl(message: string, placeholder: string): string {
  const html = `<!doctype html><html><head><meta charset="utf-8" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 18px 20px; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f4f5f7; color: #1b1d22; display: flex; flex-direction: column; gap: 14px; height: 100vh; }
  @media (prefers-color-scheme: dark) { body { background: #23262d; color: #e7e9ee; } input { background: #171a1f; color: #e7e9ee; border-color: #3a3f4a; } }
  .msg { line-height: 1.4; white-space: pre-wrap; }
  input { width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid #c3c8d0; border-radius: 6px;
    background: #fff; color: inherit; }
  input:focus { outline: 2px solid #4a8cff; outline-offset: 0; border-color: #4a8cff; }
  .row { margin-top: auto; display: flex; justify-content: flex-end; gap: 8px; }
  button { padding: 6px 16px; font-size: 13px; border-radius: 6px; border: 1px solid transparent; cursor: pointer; }
  #pi-prompt-cancel { background: transparent; border-color: #b7bdc7; color: inherit; }
  #pi-prompt-ok { background: #2f6ae0; color: #fff; }
</style></head>
<body>
  <div class="msg">${escapeHtml(message)}</div>
  <input id="pi-prompt-input" type="text" placeholder="${escapeHtml(placeholder)}" autofocus />
  <div class="row">
    <button id="pi-prompt-cancel" type="button">Cancel</button>
    <button id="pi-prompt-ok" type="button">OK</button>
  </div>
  <script>
    (function () {
      var resolveResult;
      window.__piPromptResult = new Promise(function (resolve) { resolveResult = resolve; });
      function wire() {
        var input = document.getElementById('pi-prompt-input');
        var ok = document.getElementById('pi-prompt-ok');
        var cancel = document.getElementById('pi-prompt-cancel');
        if (!input || !ok || !cancel) { resolveResult(null); return; }
        ok.addEventListener('click', function () { resolveResult(input.value); });
        cancel.addEventListener('click', function () { resolveResult(null); });
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') { event.preventDefault(); resolveResult(input.value); }
          else if (event.key === 'Escape') { event.preventDefault(); resolveResult(null); }
        });
        input.focus();
        document.body.dataset.piReady = '1';
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wire);
      } else {
        wire();
      }
    })();
  </script>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function probeCustomProviderModels(input: CustomProviderProbeInput): Promise<CustomProviderProbeResult> {
  const baseUrl = input.baseUrl?.trim();
  if (!baseUrl || !isValidHttpBaseUrl(baseUrl)) {
    return { ok: false, error: "Base URL must start with http:// or https://" };
  }
  const target = `${baseUrl.replace(/\/+$/, "")}/models`;
  const apiKey = input.apiKey?.trim();
  try {
    const response = await net.fetch(target, {
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { ok: false, error: `${response.status} ${response.statusText} from ${target}` };
    }
    const payload = (await response.json()) as unknown;
    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      return { ok: false, error: `Response from ${target} is missing a "data" array` };
    }
    const models = data
      .map((entry) => {
        if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
          return (entry as { id: string }).id;
        }
        return undefined;
      })
      .filter((id): id is string => Boolean(id && id.length > 0));
    return { ok: true, models };
  } catch (error) {
    return { ok: false, error: describeProbeError(error, target) };
  }
}

function describeProbeError(error: unknown, target: string): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `Timed out after 5s contacting ${target}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
