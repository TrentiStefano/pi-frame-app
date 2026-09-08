import type { RuntimeConfiguredPackage, RuntimeSettingsSnapshot } from "@pi-frame/session-driver/runtime-types";
import type {
  CapabilityCenterSnapshot,
  InstallCapabilityPackageInput,
  SetCapabilityConnectorInput,
} from "./capability-types";
import type {
  ConfiguredModelRecord,
  DeleteModelConfigurationInput,
  ModelConfigurationDefaultsInput,
  ModelConfigurationSnapshot,
  SaveModelConfigurationInput,
} from "@pi-frame/pi-sdk-driver";
export type {
  ConfiguredModelRecord,
  DeleteModelConfigurationInput,
  ModelConfigurationDefaultsInput,
  ModelConfigurationSnapshot,
  SaveModelConfigurationInput,
} from "@pi-frame/pi-sdk-driver";
import { defaultShortcutBindings, shortcutMatches, type ShortcutBindings } from "./keyboard-shortcuts";
import type {
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionTreeSnapshot,
} from "@pi-frame/session-driver/types";
import type {
  AppView,
  AppLanguage,
  ComposerAttachment,
  ComposerImageAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  DesktopAppState,
  ForkThreadInput,
  NotificationPreferences,
  RemoveWorktreeInput,
  SendChildThreadFollowUpInput,
  SetChildSupervisionLoopInput,
  SelectedTranscriptRecord,
  StartThreadInput,
  ThemeMode,
  WorkspaceSessionTarget,
} from "./desktop-state";
import type {
  BrowserCommand,
  BrowserElementSelectedEvent,
  BrowserSessionState,
  BrowserSessionTarget,
  BrowserSurfaceBounds,
} from "./browser-types";

export type DesktopNotificationPermissionStatus =
  | "granted"
  | "denied"
  | "default"
  | "system-managed"
  | "unsupported"
  | "unknown";

export type MicrophonePermissionStatus = "granted" | "denied" | "prompt" | "unsupported";

export interface SoftwareUpdateSnapshot {
  readonly checkedAt: string;
  readonly app: {
    readonly currentVersion: string;
    readonly latestVersion?: string;
    readonly updateAvailable: boolean;
    readonly canInstall: boolean;
    readonly checkError?: "release-metadata-unavailable" | "unavailable";
  };
  readonly pi: {
    readonly currentVersion: string;
    readonly latestVersion?: string;
    readonly updateAvailable: boolean;
  };
  readonly extensions: readonly {
    readonly source: string;
    readonly displayName: string;
    readonly type: "npm" | "git";
    readonly scope: "user" | "project";
  }[];
  readonly extensionError?: string;
}

export interface VoiceTranscriptionInput {
  readonly requestId: string;
  readonly sampleRate: number;
  readonly samples: ArrayBuffer;
}

export interface VoiceTranscriptionResult {
  readonly text: string;
}


export interface CustomProviderModelConfig {
  readonly id: string;
  readonly contextWindow?: number;
}

export interface CustomProviderConfig {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly models: readonly CustomProviderModelConfig[];
}

export interface CustomProviderProbeInput {
  readonly baseUrl: string;
  readonly apiKey?: string;
}

export type CustomProviderProbeResult =
  | { readonly ok: true; readonly models: readonly string[] }
  | { readonly ok: false; readonly error: string };

export const desktopIpc = {
  stateRequest: "pi-frame:state-request",
  stateChanged: "pi-frame:state-changed",
  selectedTranscriptRequest: "pi-frame:selected-transcript-request",
  selectedTranscriptChanged: "pi-frame:selected-transcript-changed",
  assistantStreamPatch: "pi-frame:assistant-stream-patch",
  sessionMetadataPatch: "pi-frame:session-metadata-patch",
  browserGetState: "pi-frame:browser-get-state",
  browserCommand: "pi-frame:browser-command",
  browserSetSurface: "pi-frame:browser-set-surface",
  browserStateChanged: "pi-frame:browser-state-changed",
  browserElementSelected: "pi-frame:browser-element-selected",
  appCommand: "pi-frame:app-command",
  workspacePicked: "pi-gui:workspace-picked",
  clipboardImagePasted: "pi-gui:clipboard-image-pasted",
  addWorkspacePath: "pi-gui:add-workspace-path",
  pickWorkspace: "pi-gui:pick-workspace",
  selectWorkspace: "pi-gui:select-workspace",
  renameWorkspace: "pi-gui:rename-workspace",
  removeWorkspace: "pi-gui:remove-workspace",
  reorderWorkspaces: "pi-gui:reorder-workspaces",
  reorderPinnedSessions: "pi-gui:reorder-pinned-sessions",
  openWorkspaceInFinder: "pi-gui:open-workspace-in-finder",
  createWorktree: "pi-gui:create-worktree",
  removeWorktree: "pi-gui:remove-worktree",
  openSkillInFinder: "pi-gui:open-skill-in-finder",
  openExtensionInFinder: "pi-gui:open-extension-in-finder",
  syncCurrentWorkspace: "pi-gui:sync-current-workspace",
  selectSession: "pi-gui:select-session",
  renameSession: "pi-gui:rename-session",
  archiveSession: "pi-gui:archive-session",
  unarchiveSession: "pi-gui:unarchive-session",
  deleteSession: "pi-gui:delete-session",
  markSessionRead: "pi-gui:mark-session-read",
  setSessionPinned: "pi-gui:set-session-pinned",
  createSession: "pi-gui:create-session",
  startThread: "pi-gui:start-thread",
  forkThread: "pi-gui:fork-thread",
  sendChildThreadFollowUp: "pi-gui:send-child-thread-follow-up",
  setChildSupervisionLoop: "pi-gui:set-child-supervision-loop",
  cancelCurrentRun: "pi-gui:cancel-current-run",
  setActiveView: "pi-gui:set-active-view",
  setSidebarCollapsed: "pi-gui:set-sidebar-collapsed",
  setWorkspaceCollapsed: "pi-gui:set-workspace-collapsed",
  refreshRuntime: "pi-gui:refresh-runtime",
  getCapabilityCenter: "pi-gui:get-capability-center",
  listCapabilityPackages: "pi-gui:list-capability-packages",
  installCapabilityPackage: "pi-gui:install-capability-package",
  removeCapabilityPackage: "pi-gui:remove-capability-package",
  setCapabilityConnector: "pi-gui:set-capability-connector",
  reconnectCapabilityConnector: "pi-gui:reconnect-capability-connector",
  checkForUpdates: "pi-gui:check-for-updates",
  installAppUpdate: "pi-gui:install-app-update",
  updateExtensions: "pi-gui:update-extensions",
  getModelConfiguration: "pi-gui:get-model-configuration",
  saveModelConfiguration: "pi-gui:save-model-configuration",
  deleteModelConfiguration: "pi-gui:delete-model-configuration",
  setModelConfigurationDefaults: "pi-gui:set-model-configuration-defaults",
  setDefaultModel: "pi-gui:set-default-model",
  setDefaultThinkingLevel: "pi-gui:set-default-thinking-level",
  setSessionModel: "pi-gui:set-session-model",
  setSessionThinkingLevel: "pi-gui:set-session-thinking-level",
  loginProvider: "pi-gui:login-provider",
  logoutProvider: "pi-gui:logout-provider",
  setProviderApiKey: "pi-gui:set-provider-api-key",
  setCustomProvider: "pi-gui:set-custom-provider",
  deleteCustomProvider: "pi-gui:delete-custom-provider",
  probeCustomProviderModels: "pi-gui:probe-custom-provider-models",
  setEnableSkillCommands: "pi-gui:set-enable-skill-commands",
  setScopedModelPatterns: "pi-gui:set-scoped-model-patterns",
  setSkillEnabled: "pi-gui:set-skill-enabled",
  setExtensionEnabled: "pi-gui:set-extension-enabled",
  respondToHostUiRequest: "pi-gui:respond-to-host-ui-request",
  setNotificationPreferences: "pi-gui:set-notification-preferences",
  setAppLanguage: "pi-gui:set-app-language",
  setIntegratedTerminalShell: "pi-gui:set-integrated-terminal-shell",
  setShortcutBindings: "pi-gui:set-shortcut-bindings",
  setComputerUseEnabled: "pi-gui:set-computer-use-enabled",
  terminalEnsurePanel: "pi-gui:terminal-ensure-panel",
  terminalCreateSession: "pi-gui:terminal-create-session",
  terminalSetActiveSession: "pi-gui:terminal-set-active-session",
  terminalWrite: "pi-gui:terminal-write",
  terminalResize: "pi-gui:terminal-resize",
  terminalRestartSession: "pi-gui:terminal-restart-session",
  terminalCloseSession: "pi-gui:terminal-close-session",
  terminalSetTitle: "pi-gui:terminal-set-title",
  terminalSetFocused: "pi-gui:terminal-set-focused",
  terminalData: "pi-gui:terminal-data",
  terminalExit: "pi-gui:terminal-exit",
  terminalError: "pi-gui:terminal-error",
  getNotificationPermissionStatus: "pi-gui:get-notification-permission-status",
  requestNotificationPermission: "pi-gui:request-notification-permission",
  openSystemNotificationSettings: "pi-gui:open-system-notification-settings",
  notificationPermissionStatusChanged: "pi-gui:notification-permission-status-changed",
  requestMicrophonePermission: "pi-gui:request-microphone-permission",
  transcribeVoice: "pi-gui:transcribe-voice",
  cancelVoiceTranscription: "pi-gui:cancel-voice-transcription",
  pickComposerAttachments: "pi-gui:pick-composer-attachments",
  readClipboardImage: "pi-gui:read-clipboard-image",
  readClipboardText: "pi-gui:read-clipboard-text",
  addComposerAttachments: "pi-gui:add-composer-attachments",
  removeComposerAttachment: "pi-gui:remove-composer-attachment",
  editQueuedComposerMessage: "pi-gui:edit-queued-composer-message",
  cancelQueuedComposerEdit: "pi-gui:cancel-queued-composer-edit",
  removeQueuedComposerMessage: "pi-gui:remove-queued-composer-message",
  steerQueuedComposerMessage: "pi-gui:steer-queued-composer-message",
  updateComposerDraft: "pi-gui:update-composer-draft",
  submitComposer: "pi-gui:submit-composer",
  getSessionTree: "pi-gui:get-session-tree",
  navigateSessionTree: "pi-gui:navigate-session-tree",
  showApplicationMenu: "pi-gui:show-application-menu",
  toggleWindowMaximize: "pi-gui:toggle-window-maximize",
  listWorkspaceFiles: "pi-gui:list-workspace-files",
  readWorkspaceFile: "pi-gui:read-workspace-file",
  getChangedFiles: "pi-gui:get-changed-files",
  getFileDiff: "pi-gui:get-file-diff",
  stageFile: "pi-gui:stage-file",
  getThemeMode: "pi-gui:get-theme-mode",
  getResolvedTheme: "pi-gui:get-resolved-theme",
  setThemeMode: "pi-gui:set-theme-mode",
  setThemeId: "pi-frame:set-theme-id",
  importVSCodeTheme: "pi-frame:import-vscode-theme",
  deleteCustomTheme: "pi-frame:delete-custom-theme",
  themeChanged: "pi-gui:theme-changed",
  ping: "app:ping",
  openExternal: "app:open-external",
} as const;

export const applicationMenuIds = {
  file: "application-menu.file",
  edit: "application-menu.edit",
  view: "application-menu.view",
  window: "application-menu.window",
} as const;

export type ApplicationMenuId = (typeof applicationMenuIds)[keyof typeof applicationMenuIds];

export interface ShowApplicationMenuInput {
  readonly menuId: ApplicationMenuId;
  readonly x: number;
  readonly y: number;
}

export const desktopCommands = {
  openSettings: "open-settings",
  openNewThread: "open-new-thread",
  toggleTerminal: "toggle-terminal",
  toggleBrowser: "toggle-browser",
  toggleSidebar: "toggle-sidebar",
} as const;

export function getDesktopShortcutLabel(platform: NodeJS.Platform, key: string): string {
  return `${platform === "darwin" ? "⌘" : "Ctrl+"}${key.toUpperCase()}`;
}

export interface SessionMetadataPatch {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly title: string;
  readonly updatedAt: string;
  readonly preview: string;
  readonly status: "idle" | "running" | "failed";
  readonly runningSince?: string;
  readonly hasUnseenUpdate: boolean;
  readonly activeAssistantMessageId?: string;
}

export interface AssistantStreamPatch {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly runId?: string;
  readonly assistantMessageId: string;
  readonly assistantMessageCreatedAt: string;
  /** Sequence of last delta represented by this patch. */
  readonly sequence: number;
  /** Number of adjacent deltas represented by this patch. */
  readonly deltaCount: number;
  readonly text: string;
}

export type PiDesktopStateListener = (state: DesktopAppState) => void;
export type PiDesktopSelectedTranscriptListener = (payload: SelectedTranscriptRecord | null) => void;
export type PiDesktopSessionMetadataPatchListener = (patch: SessionMetadataPatch) => void;
export type PiDesktopAssistantStreamPatchListener = (patch: AssistantStreamPatch) => void;
export type PiDesktopBrowserStateListener = (state: BrowserSessionState) => void;
export type PiDesktopBrowserElementListener = (event: BrowserElementSelectedEvent) => void;
export type PiDesktopCommand = (typeof desktopCommands)[keyof typeof desktopCommands];

export interface ChangedFileEntry {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}

export interface WorkspaceFilePreview {
  readonly path: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly binary: boolean;
  readonly sizeBytes: number;
}

export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export type TerminalSessionStatus = "running" | "exited" | "error";

export interface TerminalSessionSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly cwd: string;
  readonly shell: string;
  readonly title: string;
  readonly status: TerminalSessionStatus;
  readonly replay: string;
  readonly truncated: boolean;
  readonly exitCode?: number;
  readonly signal?: number;
}

export interface TerminalPanelSnapshot {
  readonly workspaceId: string;
  readonly rootKey: string;
  readonly activeSessionId: string;
  readonly sessions: readonly TerminalSessionSnapshot[];
}

export interface TerminalDataEvent {
  readonly terminalId: string;
  readonly data: string;
}

export interface TerminalExitEvent {
  readonly terminalId: string;
  readonly exitCode?: number;
  readonly signal?: number;
}

export interface TerminalErrorEvent {
  readonly terminalId: string;
  readonly message: string;
}

export interface DesktopShortcutInput {
  readonly modifier: boolean;
  readonly shift: boolean;
  readonly key: string;
  readonly code?: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly alt?: boolean;
  readonly platform?: NodeJS.Platform;
  readonly bindings?: ShortcutBindings;
}

export function getDesktopCommandFromShortcut(input: DesktopShortcutInput): PiDesktopCommand | undefined {
  const bindings = input.bindings ?? defaultShortcutBindings;
  const platform = input.platform ?? (process.platform as NodeJS.Platform);
  const event = {
    key: input.key,
    code: input.code,
    ctrlKey: input.ctrl ?? (platform !== "darwin" && input.modifier),
    metaKey: input.meta ?? (platform === "darwin" && input.modifier),
    altKey: input.alt ?? false,
    shiftKey: input.shift,
  };
  if (shortcutMatches(event, bindings.openSettings, platform)) return desktopCommands.openSettings;
  if (shortcutMatches(event, bindings.toggleTerminal, platform)) return desktopCommands.toggleTerminal;
  if (shortcutMatches(event, bindings.toggleBrowser, platform)) return desktopCommands.toggleBrowser;
  if (shortcutMatches(event, bindings.toggleSidebar, platform)) return desktopCommands.toggleSidebar;
  if (shortcutMatches(event, bindings.newThread, platform)) return desktopCommands.openNewThread;
  return undefined;
}

export interface PiDesktopApi {
  platform: NodeJS.Platform;
  versions: NodeJS.ProcessVersions;
  initialAppLanguage: AppLanguage;
  initialResolvedTheme: "light" | "dark";
  ping(): Promise<string>;
  getState(): Promise<DesktopAppState>;
  onStateChanged(listener: PiDesktopStateListener): () => void;
  getSelectedTranscript(): Promise<SelectedTranscriptRecord | null>;
  onSelectedTranscriptChanged(listener: PiDesktopSelectedTranscriptListener): () => void;
  onAssistantStreamPatch(listener: PiDesktopAssistantStreamPatchListener): () => void;
  onSessionMetadataPatch(listener: PiDesktopSessionMetadataPatchListener): () => void;
  getBrowserState(target: BrowserSessionTarget): Promise<BrowserSessionState>;
  sendBrowserCommand(target: BrowserSessionTarget, command: BrowserCommand): Promise<BrowserSessionState>;
  setBrowserSurface(input: BrowserSurfaceBounds): Promise<BrowserSessionState>;
  onBrowserStateChanged(listener: PiDesktopBrowserStateListener): () => void;
  onBrowserElementSelected(listener: PiDesktopBrowserElementListener): () => void;
  onCommand(listener: (command: PiDesktopCommand) => void): () => void;
  onWorkspacePicked(listener: (workspaceId: string) => void): () => void;
  onClipboardImagePasted(listener: (attachment: ComposerImageAttachment) => void): () => void;
  getPathForFile(file: File): string;
  addWorkspacePath(path: string): Promise<DesktopAppState>;
  pickWorkspace(): Promise<DesktopAppState>;
  selectWorkspace(workspaceId: string): Promise<DesktopAppState>;
  renameWorkspace(workspaceId: string, displayName: string): Promise<DesktopAppState>;
  removeWorkspace(workspaceId: string): Promise<DesktopAppState>;
  reorderWorkspaces(workspaceOrder: readonly string[]): Promise<DesktopAppState>;
  reorderPinnedSessions(pinnedSessionOrder: readonly string[]): Promise<DesktopAppState>;
  openWorkspaceInFinder(workspaceId: string): Promise<void>;
  createWorktree(input: CreateWorktreeInput): Promise<DesktopAppState>;
  removeWorktree(input: RemoveWorktreeInput): Promise<DesktopAppState>;
  openSkillInFinder(workspaceId: string, filePath: string): Promise<void>;
  openExtensionInFinder(workspaceId: string, filePath: string): Promise<void>;
  syncCurrentWorkspace(): Promise<DesktopAppState>;
  selectSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  renameSession(target: WorkspaceSessionTarget, title: string): Promise<DesktopAppState>;
  archiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  unarchiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  deleteSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  markSessionRead(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  setSessionPinned(target: WorkspaceSessionTarget, pinned: boolean): Promise<DesktopAppState>;
  createSession(input: CreateSessionInput): Promise<DesktopAppState>;
  startThread(input: StartThreadInput): Promise<DesktopAppState>;
  forkThread(input: ForkThreadInput): Promise<DesktopAppState>;
  sendChildThreadFollowUp(input: SendChildThreadFollowUpInput): Promise<DesktopAppState>;
  setChildSupervisionLoop(input: SetChildSupervisionLoopInput): Promise<DesktopAppState>;
  cancelCurrentRun(): Promise<DesktopAppState>;
  setActiveView(view: AppView): Promise<DesktopAppState>;
  setSidebarCollapsed(collapsed: boolean): Promise<DesktopAppState>;
  setWorkspaceCollapsed(workspaceId: string, collapsed: boolean): Promise<DesktopAppState>;
  refreshRuntime(workspaceId?: string): Promise<DesktopAppState>;
  getCapabilityCenter(refresh?: boolean): Promise<CapabilityCenterSnapshot>;
  listCapabilityPackages(workspaceId: string): Promise<readonly RuntimeConfiguredPackage[]>;
  installCapabilityPackage(input: InstallCapabilityPackageInput): Promise<DesktopAppState>;
  removeCapabilityPackage(input: InstallCapabilityPackageInput): Promise<DesktopAppState>;
  setCapabilityConnector(workspaceId: string, input: SetCapabilityConnectorInput): Promise<DesktopAppState>;
  reconnectCapabilityConnector(workspaceId: string, connectorId: string): Promise<DesktopAppState>;
  checkForUpdates(workspaceId?: string): Promise<SoftwareUpdateSnapshot>;
  installAppUpdate(): Promise<void>;
  updateExtensions(workspaceId: string, sources?: readonly string[]): Promise<DesktopAppState>;
  getModelConfiguration(): Promise<ModelConfigurationSnapshot>;
  saveModelConfiguration(input: SaveModelConfigurationInput): Promise<DesktopAppState>;
  deleteModelConfiguration(input: DeleteModelConfigurationInput): Promise<DesktopAppState>;
  setModelConfigurationDefaults(input: ModelConfigurationDefaultsInput): Promise<DesktopAppState>;
  setDefaultModel(workspaceId: string, provider: string, modelId: string): Promise<DesktopAppState>;
  setDefaultThinkingLevel(
    workspaceId: string,
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ): Promise<DesktopAppState>;
  setSessionModel(
    workspaceId: string,
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<DesktopAppState>;
  setSessionThinkingLevel(
    workspaceId: string,
    sessionId: string,
    thinkingLevel: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>,
  ): Promise<DesktopAppState>;
  loginProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  logoutProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  setProviderApiKey(workspaceId: string, providerId: string, apiKey: string): Promise<DesktopAppState>;
  setCustomProvider(workspaceId: string, config: CustomProviderConfig): Promise<DesktopAppState>;
  deleteCustomProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  probeCustomProviderModels(input: CustomProviderProbeInput): Promise<CustomProviderProbeResult>;
  setEnableSkillCommands(workspaceId: string, enabled: boolean): Promise<DesktopAppState>;
  setScopedModelPatterns(workspaceId: string, patterns: readonly string[]): Promise<DesktopAppState>;
  setSkillEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<DesktopAppState>;
  setExtensionEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<DesktopAppState>;
  respondToHostUiRequest(
    workspaceId: string,
    sessionId: string,
    response:
      | { readonly requestId: string; readonly value: string }
      | { readonly requestId: string; readonly confirmed: boolean }
      | { readonly requestId: string; readonly cancelled: true },
  ): Promise<DesktopAppState>;
  setNotificationPreferences(preferences: Partial<NotificationPreferences>): Promise<DesktopAppState>;
  setAppLanguage(language: AppLanguage): Promise<DesktopAppState>;
  setIntegratedTerminalShell(shell: string): Promise<DesktopAppState>;
  setShortcutBindings(bindings: ShortcutBindings): Promise<DesktopAppState>;
  setComputerUseEnabled(enabled: boolean): Promise<DesktopAppState>;
  ensureTerminalPanel(
    workspaceId: string,
    terminalScopeId: string,
    size?: Partial<TerminalSize>,
  ): Promise<TerminalPanelSnapshot>;
  createTerminalSession(
    workspaceId: string,
    terminalScopeId: string,
    size?: Partial<TerminalSize>,
  ): Promise<TerminalPanelSnapshot>;
  setActiveTerminalSession(
    workspaceId: string,
    terminalScopeId: string,
    terminalId: string,
  ): Promise<TerminalPanelSnapshot>;
  writeTerminal(terminalId: string, data: string): Promise<void>;
  resizeTerminal(terminalId: string, size: TerminalSize): Promise<void>;
  restartTerminalSession(terminalId: string, size?: Partial<TerminalSize>): Promise<TerminalPanelSnapshot>;
  closeTerminalSession(terminalId: string): Promise<TerminalPanelSnapshot | null>;
  setTerminalTitle(terminalId: string, title: string): Promise<void>;
  setTerminalFocused(focused: boolean, terminalId?: string): Promise<void>;
  onTerminalData(listener: (event: TerminalDataEvent) => void): () => void;
  onTerminalExit(listener: (event: TerminalExitEvent) => void): () => void;
  onTerminalError(listener: (event: TerminalErrorEvent) => void): () => void;
  getNotificationPermissionStatus(): Promise<DesktopNotificationPermissionStatus>;
  requestNotificationPermission(): Promise<DesktopNotificationPermissionStatus>;
  openSystemNotificationSettings(): Promise<void>;
  onNotificationPermissionStatusChanged(
    callback: (status: DesktopNotificationPermissionStatus) => void,
  ): () => void;
  requestMicrophonePermission(): Promise<MicrophonePermissionStatus>;
  transcribeVoice(input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult>;
  cancelVoiceTranscription(requestId: string): Promise<void>;
  pickComposerAttachments(): Promise<DesktopAppState>;
  readClipboardImage(): ComposerImageAttachment | null;
  readClipboardText(): string;
  addComposerAttachments(attachments: readonly ComposerAttachment[]): Promise<DesktopAppState>;
  removeComposerAttachment(attachmentId: string): Promise<DesktopAppState>;
  editQueuedComposerMessage(messageId: string, currentDraft?: string): Promise<DesktopAppState>;
  cancelQueuedComposerEdit(): Promise<DesktopAppState>;
  removeQueuedComposerMessage(messageId: string): Promise<DesktopAppState>;
  steerQueuedComposerMessage(messageId: string): Promise<DesktopAppState>;
  updateComposerDraft(composerDraft: string): Promise<DesktopAppState>;
  submitComposer(text: string, options?: {
    readonly deliverAs?: "steer" | "followUp";
    readonly preserveComposer?: boolean;
  }): Promise<DesktopAppState>;
  getSessionTree(target: WorkspaceSessionTarget): Promise<SessionTreeSnapshot>;
  navigateSessionTree(
    target: WorkspaceSessionTarget,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ): Promise<{ readonly state: DesktopAppState; readonly result: NavigateSessionTreeResult }>;
  listWorkspaceFiles(workspaceId: string, options?: { readonly force?: boolean }): Promise<string[]>;
  readWorkspaceFile(workspaceId: string, filePath: string): Promise<WorkspaceFilePreview>;
  getChangedFiles(workspaceId: string): Promise<ChangedFileEntry[]>;
  getFileDiff(workspaceId: string, filePath: string): Promise<string>;
  stageFile(workspaceId: string, filePath: string): Promise<void>;
  showApplicationMenu(input: ShowApplicationMenuInput): Promise<boolean>;
  toggleWindowMaximize(): Promise<void>;
  openExternal(url: string): Promise<void>;
  getThemeMode(): Promise<ThemeMode>;
  getResolvedTheme(): Promise<"light" | "dark">;
  setThemeMode(mode: ThemeMode): Promise<DesktopAppState>;
  setThemeId(themeId: string): Promise<DesktopAppState>;
  importVSCodeTheme(): Promise<DesktopAppState | null>;
  deleteCustomTheme(themeId: string): Promise<DesktopAppState>;
  onThemeChanged(callback: (theme: "light" | "dark") => void): () => void;
}
