import { contextBridge, ipcRenderer, webUtils } from "electron";
import { PRELOAD_DEV_RELOAD_MARKER } from "./dev-reload-preload-probe";
import {
  desktopIpc,
  type AssistantStreamPatch,
  type CustomProviderConfig,
  type SessionMetadataPatch,
  type CustomProviderProbeInput,
  type CustomProviderProbeResult,
  type DeleteModelConfigurationInput,
  type DesktopNotificationPermissionStatus,
  type WorkspaceFilePreview,
  type ShowApplicationMenuInput,
  type PiDesktopCommand,
  type TerminalDataEvent,
  type TerminalErrorEvent,
  type TerminalExitEvent,
  type TerminalPanelSnapshot,
  type TerminalSize,
  type MicrophonePermissionStatus,
  type ModelConfigurationDefaultsInput,
  type ModelConfigurationSnapshot,
  type PiDesktopApi,
  type PiDesktopBrowserElementListener,
  type PiDesktopBrowserStateListener,
  type SaveModelConfigurationInput,
  type VoiceTranscriptionInput,
  type VoiceTranscriptionResult,
} from "../src/ipc";
import type { InstallCapabilityPackageInput, SetCapabilityConnectorInput } from "../src/capability-types";
import type {
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionTreeSnapshot,
} from "@pi-frame/session-driver/types";
import type {
  HostUiResponse,
} from "@pi-frame/session-driver";
import type { RuntimeSettingsSnapshot } from "@pi-frame/session-driver/runtime-types";
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
} from "../src/desktop-state";
import type { BrowserCommand, BrowserSessionState, BrowserSessionTarget, BrowserSurfaceBounds } from "../src/browser-types";
import { isAppLanguage } from "../src/i18n/resources";

const devReloadMarkersEnabled = process.env.PI_APP_DEV_RELOAD_MARKERS === "1";
const initialAppLanguageArgument = process.argv
  .find((argument) => argument.startsWith("--pi-app-language="))
  ?.slice("--pi-app-language=".length);
const initialAppLanguage: AppLanguage = isAppLanguage(initialAppLanguageArgument) ? initialAppLanguageArgument : "en";
const initialThemeArgument = process.argv
  .find((argument) => argument.startsWith("--pi-app-theme="))
  ?.slice("--pi-app-theme=".length);
const initialResolvedTheme = initialThemeArgument === "dark" ? "dark" : "light";

function resolveDevReloadMarkers() {
  if (!devReloadMarkersEnabled) {
    return undefined;
  }

  return {
    preload: PRELOAD_DEV_RELOAD_MARKER,
  };
}

const devReloadMarkers = resolveDevReloadMarkers();

// Narrow, test-only signal for content-safe renderer profiling. Not exposed in production.
if (process.env.PI_APP_TEST_MODE) {
  contextBridge.exposeInMainWorld("__piAppTestMode", true);
}

if (devReloadMarkers) {
  contextBridge.exposeInMainWorld("__piDevReloadHost", devReloadMarkers);
}

function subscribeIpc<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld("piApp", {
  platform: process.platform,
  versions: process.versions,
  initialAppLanguage,
  initialResolvedTheme,
  ping: () => ipcRenderer.invoke(desktopIpc.ping) as Promise<string>,
  getState: () => ipcRenderer.invoke(desktopIpc.stateRequest) as Promise<DesktopAppState>,
  onStateChanged: (listener: (state: DesktopAppState) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, state: DesktopAppState) => {
      listener(state);
    };
    ipcRenderer.on(desktopIpc.stateChanged, handle);
    return () => {
      ipcRenderer.removeListener(desktopIpc.stateChanged, handle);
    };
  },
  getSelectedTranscript: () =>
    ipcRenderer.invoke(desktopIpc.selectedTranscriptRequest) as Promise<SelectedTranscriptRecord | null>,
  onSelectedTranscriptChanged: (listener: (payload: SelectedTranscriptRecord | null) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, payload: SelectedTranscriptRecord | null) => {
      listener(payload);
    };
    ipcRenderer.on(desktopIpc.selectedTranscriptChanged, handle);
    return () => {
      ipcRenderer.removeListener(desktopIpc.selectedTranscriptChanged, handle);
    };
  },
  onAssistantStreamPatch: (listener: (patch: AssistantStreamPatch) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, patch: AssistantStreamPatch) => {
      listener(patch);
    };
    ipcRenderer.on(desktopIpc.assistantStreamPatch, handle);
    return () => {
      ipcRenderer.removeListener(desktopIpc.assistantStreamPatch, handle);
    };
  },
  onSessionMetadataPatch: (listener: (patch: SessionMetadataPatch) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, patch: SessionMetadataPatch) => {
      listener(patch);
    };
    ipcRenderer.on(desktopIpc.sessionMetadataPatch, handle);
    return () => {
      ipcRenderer.removeListener(desktopIpc.sessionMetadataPatch, handle);
    };
  },
  onCommand: (listener: (command: PiDesktopCommand) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, command: PiDesktopCommand) => {
      listener(command);
    };
    ipcRenderer.on(desktopIpc.appCommand, handle);
    return () => {
      ipcRenderer.removeListener(desktopIpc.appCommand, handle);
    };
  },
  onWorkspacePicked: (listener: (workspaceId: string) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, workspaceId: string) => {
      listener(workspaceId);
    };
    ipcRenderer.on(desktopIpc.workspacePicked, handle);
    return () => {
      ipcRenderer.removeListener(desktopIpc.workspacePicked, handle);
    };
  },
  onClipboardImagePasted: (listener: (attachment: ComposerImageAttachment) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, attachment: ComposerImageAttachment) => {
      listener(attachment);
    };
    ipcRenderer.on(desktopIpc.clipboardImagePasted, handle);
    return () => {
      ipcRenderer.removeListener(desktopIpc.clipboardImagePasted, handle);
    };
  },
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  addWorkspacePath: (workspacePath: string) =>
    ipcRenderer.invoke(desktopIpc.addWorkspacePath, workspacePath) as Promise<DesktopAppState>,
  pickWorkspace: () => ipcRenderer.invoke(desktopIpc.pickWorkspace) as Promise<DesktopAppState>,
  selectWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.selectWorkspace, workspaceId) as Promise<DesktopAppState>,
  renameWorkspace: (workspaceId: string, displayName: string) =>
    ipcRenderer.invoke(desktopIpc.renameWorkspace, workspaceId, displayName) as Promise<DesktopAppState>,
  removeWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.removeWorkspace, workspaceId) as Promise<DesktopAppState>,
  reorderWorkspaces: (workspaceOrder: readonly string[]) =>
    ipcRenderer.invoke(desktopIpc.reorderWorkspaces, workspaceOrder) as Promise<DesktopAppState>,
  reorderPinnedSessions: (pinnedSessionOrder: readonly string[]) =>
    ipcRenderer.invoke(desktopIpc.reorderPinnedSessions, pinnedSessionOrder) as Promise<DesktopAppState>,
  openWorkspaceInFinder: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.openWorkspaceInFinder, workspaceId) as Promise<void>,
  createWorktree: (input: CreateWorktreeInput) =>
    ipcRenderer.invoke(desktopIpc.createWorktree, input) as Promise<DesktopAppState>,
  removeWorktree: (input: RemoveWorktreeInput) =>
    ipcRenderer.invoke(desktopIpc.removeWorktree, input) as Promise<DesktopAppState>,
  openSkillInFinder: (workspaceId: string, filePath: string) =>
    ipcRenderer.invoke(desktopIpc.openSkillInFinder, workspaceId, filePath) as Promise<void>,
  openExtensionInFinder: (workspaceId: string, filePath: string) =>
    ipcRenderer.invoke(desktopIpc.openExtensionInFinder, workspaceId, filePath) as Promise<void>,
  syncCurrentWorkspace: () =>
    ipcRenderer.invoke(desktopIpc.syncCurrentWorkspace) as Promise<DesktopAppState>,
  selectSession: (target: WorkspaceSessionTarget) =>
    ipcRenderer.invoke(desktopIpc.selectSession, target) as Promise<DesktopAppState>,
  renameSession: (target: WorkspaceSessionTarget, title: string) =>
    ipcRenderer.invoke(desktopIpc.renameSession, target, title) as Promise<DesktopAppState>,
  archiveSession: (target: WorkspaceSessionTarget) =>
    ipcRenderer.invoke(desktopIpc.archiveSession, target) as Promise<DesktopAppState>,
  unarchiveSession: (target: WorkspaceSessionTarget) =>
    ipcRenderer.invoke(desktopIpc.unarchiveSession, target) as Promise<DesktopAppState>,
  deleteSession: (target: WorkspaceSessionTarget) =>
    ipcRenderer.invoke(desktopIpc.deleteSession, target) as Promise<DesktopAppState>,
  markSessionRead: (target: WorkspaceSessionTarget) =>
    ipcRenderer.invoke(desktopIpc.markSessionRead, target) as Promise<DesktopAppState>,
  setSessionPinned: (target: WorkspaceSessionTarget, pinned: boolean) =>
    ipcRenderer.invoke(desktopIpc.setSessionPinned, target, pinned) as Promise<DesktopAppState>,
  createSession: (input: CreateSessionInput) =>
    ipcRenderer.invoke(desktopIpc.createSession, input) as Promise<DesktopAppState>,
  startThread: (input: StartThreadInput) =>
    ipcRenderer.invoke(desktopIpc.startThread, input) as Promise<DesktopAppState>,
  forkThread: (input: ForkThreadInput) =>
    ipcRenderer.invoke(desktopIpc.forkThread, input) as Promise<DesktopAppState>,
  sendChildThreadFollowUp: (input: SendChildThreadFollowUpInput) =>
    ipcRenderer.invoke(desktopIpc.sendChildThreadFollowUp, input) as Promise<DesktopAppState>,
  setChildSupervisionLoop: (input: SetChildSupervisionLoopInput) =>
    ipcRenderer.invoke(desktopIpc.setChildSupervisionLoop, input) as Promise<DesktopAppState>,
  cancelCurrentRun: () => ipcRenderer.invoke(desktopIpc.cancelCurrentRun) as Promise<DesktopAppState>,
  setActiveView: (view: AppView) =>
    ipcRenderer.invoke(desktopIpc.setActiveView, view) as Promise<DesktopAppState>,
  setSidebarCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke(desktopIpc.setSidebarCollapsed, collapsed) as Promise<DesktopAppState>,
  setWorkspaceCollapsed: (workspaceId: string, collapsed: boolean) =>
    ipcRenderer.invoke(desktopIpc.setWorkspaceCollapsed, workspaceId, collapsed) as Promise<DesktopAppState>,
  refreshRuntime: (workspaceId?: string) =>
    ipcRenderer.invoke(desktopIpc.refreshRuntime, workspaceId) as Promise<DesktopAppState>,
  getCapabilityCenter: (refresh?: boolean) =>
    ipcRenderer.invoke(desktopIpc.getCapabilityCenter, refresh) as ReturnType<PiDesktopApi["getCapabilityCenter"]>,
  listCapabilityPackages: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.listCapabilityPackages, workspaceId) as ReturnType<PiDesktopApi["listCapabilityPackages"]>,
  installCapabilityPackage: (input: InstallCapabilityPackageInput) =>
    ipcRenderer.invoke(desktopIpc.installCapabilityPackage, input) as Promise<DesktopAppState>,
  removeCapabilityPackage: (input: InstallCapabilityPackageInput) =>
    ipcRenderer.invoke(desktopIpc.removeCapabilityPackage, input) as Promise<DesktopAppState>,
  setCapabilityConnector: (workspaceId: string, input: SetCapabilityConnectorInput) =>
    ipcRenderer.invoke(desktopIpc.setCapabilityConnector, workspaceId, input) as Promise<DesktopAppState>,
  reconnectCapabilityConnector: (workspaceId: string, connectorId: string) =>
    ipcRenderer.invoke(desktopIpc.reconnectCapabilityConnector, workspaceId, connectorId) as Promise<DesktopAppState>,
  checkForUpdates: (workspaceId?: string) =>
    ipcRenderer.invoke(desktopIpc.checkForUpdates, workspaceId) as ReturnType<PiDesktopApi["checkForUpdates"]>,
  installAppUpdate: () =>
    ipcRenderer.invoke(desktopIpc.installAppUpdate) as Promise<void>,
  updateExtensions: (workspaceId: string, sources?: readonly string[]) =>
    ipcRenderer.invoke(desktopIpc.updateExtensions, workspaceId, sources) as Promise<DesktopAppState>,
  getModelConfiguration: () =>
    ipcRenderer.invoke(desktopIpc.getModelConfiguration) as Promise<ModelConfigurationSnapshot>,
  saveModelConfiguration: (input: SaveModelConfigurationInput) =>
    ipcRenderer.invoke(desktopIpc.saveModelConfiguration, input) as Promise<DesktopAppState>,
  deleteModelConfiguration: (input: DeleteModelConfigurationInput) =>
    ipcRenderer.invoke(desktopIpc.deleteModelConfiguration, input) as Promise<DesktopAppState>,
  setModelConfigurationDefaults: (input: ModelConfigurationDefaultsInput) =>
    ipcRenderer.invoke(desktopIpc.setModelConfigurationDefaults, input) as Promise<DesktopAppState>,
  setDefaultModel: (workspaceId: string, provider: string, modelId: string) =>
    ipcRenderer.invoke(desktopIpc.setDefaultModel, workspaceId, provider, modelId) as Promise<DesktopAppState>,
  setDefaultThinkingLevel: (workspaceId: string, thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"]) =>
    ipcRenderer.invoke(desktopIpc.setDefaultThinkingLevel, workspaceId, thinkingLevel) as Promise<DesktopAppState>,
  setSessionModel: (workspaceId: string, sessionId: string, provider: string, modelId: string) =>
    ipcRenderer.invoke(desktopIpc.setSessionModel, workspaceId, sessionId, provider, modelId) as Promise<DesktopAppState>,
  setSessionThinkingLevel: (workspaceId: string, sessionId: string, thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"]) =>
    ipcRenderer.invoke(desktopIpc.setSessionThinkingLevel, workspaceId, sessionId, thinkingLevel) as Promise<DesktopAppState>,
  loginProvider: (workspaceId: string, providerId: string) =>
    ipcRenderer.invoke(desktopIpc.loginProvider, workspaceId, providerId) as Promise<DesktopAppState>,
  logoutProvider: (workspaceId: string, providerId: string) =>
    ipcRenderer.invoke(desktopIpc.logoutProvider, workspaceId, providerId) as Promise<DesktopAppState>,
  setProviderApiKey: (workspaceId: string, providerId: string, apiKey: string) =>
    ipcRenderer.invoke(desktopIpc.setProviderApiKey, workspaceId, providerId, apiKey) as Promise<DesktopAppState>,
  setCustomProvider: (workspaceId: string, config: CustomProviderConfig) =>
    ipcRenderer.invoke(desktopIpc.setCustomProvider, workspaceId, config) as Promise<DesktopAppState>,
  deleteCustomProvider: (workspaceId: string, providerId: string) =>
    ipcRenderer.invoke(desktopIpc.deleteCustomProvider, workspaceId, providerId) as Promise<DesktopAppState>,
  probeCustomProviderModels: (input: CustomProviderProbeInput) =>
    ipcRenderer.invoke(desktopIpc.probeCustomProviderModels, input) as Promise<CustomProviderProbeResult>,
  setEnableSkillCommands: (workspaceId: string, enabled: boolean) =>
    ipcRenderer.invoke(desktopIpc.setEnableSkillCommands, workspaceId, enabled) as Promise<DesktopAppState>,
  setScopedModelPatterns: (workspaceId: string, patterns: readonly string[]) =>
    ipcRenderer.invoke(desktopIpc.setScopedModelPatterns, workspaceId, patterns) as Promise<DesktopAppState>,
  setSkillEnabled: (workspaceId: string, filePath: string, enabled: boolean) =>
    ipcRenderer.invoke(desktopIpc.setSkillEnabled, workspaceId, filePath, enabled) as Promise<DesktopAppState>,
  setExtensionEnabled: (workspaceId: string, filePath: string, enabled: boolean) =>
    ipcRenderer.invoke(desktopIpc.setExtensionEnabled, workspaceId, filePath, enabled) as Promise<DesktopAppState>,
  respondToHostUiRequest: (workspaceId: string, sessionId: string, response: HostUiResponse) =>
    ipcRenderer.invoke(desktopIpc.respondToHostUiRequest, workspaceId, sessionId, response) as Promise<DesktopAppState>,
  setNotificationPreferences: (preferences: Partial<NotificationPreferences>) =>
    ipcRenderer.invoke(desktopIpc.setNotificationPreferences, preferences) as Promise<DesktopAppState>,
  setAppLanguage: (language: AppLanguage) =>
    ipcRenderer.invoke(desktopIpc.setAppLanguage, language) as Promise<DesktopAppState>,
  setIntegratedTerminalShell: (shellPath: string) =>
    ipcRenderer.invoke(desktopIpc.setIntegratedTerminalShell, shellPath) as Promise<DesktopAppState>,
  setShortcutBindings: (bindings: DesktopAppState["shortcutBindings"]) =>
    ipcRenderer.invoke(desktopIpc.setShortcutBindings, bindings) as Promise<DesktopAppState>,
  setComputerUseEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(desktopIpc.setComputerUseEnabled, enabled) as Promise<DesktopAppState>,
  ensureTerminalPanel: (workspaceId: string, terminalScopeId: string, size?: Partial<TerminalSize>) =>
    ipcRenderer.invoke(desktopIpc.terminalEnsurePanel, workspaceId, terminalScopeId, size) as Promise<TerminalPanelSnapshot>,
  createTerminalSession: (workspaceId: string, terminalScopeId: string, size?: Partial<TerminalSize>) =>
    ipcRenderer.invoke(desktopIpc.terminalCreateSession, workspaceId, terminalScopeId, size) as Promise<TerminalPanelSnapshot>,
  setActiveTerminalSession: (workspaceId: string, terminalScopeId: string, terminalId: string) =>
    ipcRenderer.invoke(desktopIpc.terminalSetActiveSession, workspaceId, terminalScopeId, terminalId) as Promise<TerminalPanelSnapshot>,
  writeTerminal: (terminalId: string, data: string) =>
    ipcRenderer.invoke(desktopIpc.terminalWrite, terminalId, data) as Promise<void>,
  resizeTerminal: (terminalId: string, size: TerminalSize) =>
    ipcRenderer.invoke(desktopIpc.terminalResize, terminalId, size) as Promise<void>,
  restartTerminalSession: (terminalId: string, size?: Partial<TerminalSize>) =>
    ipcRenderer.invoke(desktopIpc.terminalRestartSession, terminalId, size) as Promise<TerminalPanelSnapshot>,
  closeTerminalSession: (terminalId: string) =>
    ipcRenderer.invoke(desktopIpc.terminalCloseSession, terminalId) as Promise<TerminalPanelSnapshot | null>,
  setTerminalTitle: (terminalId: string, title: string) =>
    ipcRenderer.invoke(desktopIpc.terminalSetTitle, terminalId, title) as Promise<void>,
  setTerminalFocused: (focused: boolean, terminalId?: string) => {
    ipcRenderer.send(desktopIpc.terminalSetFocused, focused, terminalId);
    return Promise.resolve();
  },
  onTerminalData: (listener: (event: TerminalDataEvent) => void) =>
    subscribeIpc(desktopIpc.terminalData, listener),
  onTerminalExit: (listener: (event: TerminalExitEvent) => void) =>
    subscribeIpc(desktopIpc.terminalExit, listener),
  onTerminalError: (listener: (event: TerminalErrorEvent) => void) =>
    subscribeIpc(desktopIpc.terminalError, listener),
  getNotificationPermissionStatus: () =>
    ipcRenderer.invoke(desktopIpc.getNotificationPermissionStatus) as Promise<DesktopNotificationPermissionStatus>,
  requestNotificationPermission: () =>
    ipcRenderer.invoke(desktopIpc.requestNotificationPermission) as Promise<DesktopNotificationPermissionStatus>,
  openSystemNotificationSettings: () =>
    ipcRenderer.invoke(desktopIpc.openSystemNotificationSettings) as Promise<void>,
  onNotificationPermissionStatusChanged: (callback: (status: DesktopNotificationPermissionStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: DesktopNotificationPermissionStatus) => callback(status);
    ipcRenderer.on(desktopIpc.notificationPermissionStatusChanged, handler);
    return () => {
      ipcRenderer.removeListener(desktopIpc.notificationPermissionStatusChanged, handler);
    };
  },
  getBrowserState: (target: BrowserSessionTarget) =>
    ipcRenderer.invoke(desktopIpc.browserGetState, target) as Promise<BrowserSessionState>,
  sendBrowserCommand: (target: BrowserSessionTarget, command: BrowserCommand) =>
    ipcRenderer.invoke(desktopIpc.browserCommand, target, command) as Promise<BrowserSessionState>,
  setBrowserSurface: (input: BrowserSurfaceBounds) =>
    ipcRenderer.invoke(desktopIpc.browserSetSurface, input) as Promise<BrowserSessionState>,
  onBrowserStateChanged: (listener: PiDesktopBrowserStateListener) =>
    subscribeIpc(desktopIpc.browserStateChanged, listener),
  onBrowserElementSelected: (listener: PiDesktopBrowserElementListener) =>
    subscribeIpc(desktopIpc.browserElementSelected, listener),
  requestMicrophonePermission: () =>
    ipcRenderer.invoke(desktopIpc.requestMicrophonePermission) as Promise<MicrophonePermissionStatus>,
  transcribeVoice: (input: VoiceTranscriptionInput) =>
    ipcRenderer.invoke(desktopIpc.transcribeVoice, input) as Promise<VoiceTranscriptionResult>,
  cancelVoiceTranscription: (requestId: string) =>
    ipcRenderer.invoke(desktopIpc.cancelVoiceTranscription, requestId) as Promise<void>,
  pickComposerAttachments: () => ipcRenderer.invoke(desktopIpc.pickComposerAttachments) as Promise<DesktopAppState>,
  readClipboardImage: () => ipcRenderer.sendSync(desktopIpc.readClipboardImage) as ComposerImageAttachment | null,
  readClipboardText: () => ipcRenderer.sendSync(desktopIpc.readClipboardText) as string,
  addComposerAttachments: (attachments: readonly ComposerAttachment[]) =>
    ipcRenderer.invoke(desktopIpc.addComposerAttachments, attachments) as Promise<DesktopAppState>,
  removeComposerAttachment: (attachmentId: string) =>
    ipcRenderer.invoke(desktopIpc.removeComposerAttachment, attachmentId) as Promise<DesktopAppState>,
  editQueuedComposerMessage: (messageId: string, currentDraft?: string) =>
    ipcRenderer.invoke(desktopIpc.editQueuedComposerMessage, messageId, currentDraft) as Promise<DesktopAppState>,
  cancelQueuedComposerEdit: () =>
    ipcRenderer.invoke(desktopIpc.cancelQueuedComposerEdit) as Promise<DesktopAppState>,
  removeQueuedComposerMessage: (messageId: string) =>
    ipcRenderer.invoke(desktopIpc.removeQueuedComposerMessage, messageId) as Promise<DesktopAppState>,
  steerQueuedComposerMessage: (messageId: string) =>
    ipcRenderer.invoke(desktopIpc.steerQueuedComposerMessage, messageId) as Promise<DesktopAppState>,
  updateComposerDraft: (composerDraft: string) =>
    ipcRenderer.invoke(desktopIpc.updateComposerDraft, composerDraft) as Promise<DesktopAppState>,
  submitComposer: (text: string, options?: {
    readonly deliverAs?: "steer" | "followUp";
    readonly preserveComposer?: boolean;
  }) =>
    ipcRenderer.invoke(desktopIpc.submitComposer, text, options) as Promise<DesktopAppState>,
  getSessionTree: (target: WorkspaceSessionTarget) =>
    ipcRenderer.invoke(desktopIpc.getSessionTree, target) as Promise<SessionTreeSnapshot>,
  navigateSessionTree: (target: WorkspaceSessionTarget, targetId: string, options?: NavigateSessionTreeOptions) =>
    ipcRenderer.invoke(desktopIpc.navigateSessionTree, target, targetId, options) as Promise<{
      readonly state: DesktopAppState;
      readonly result: NavigateSessionTreeResult;
    }>,
  listWorkspaceFiles: (workspaceId: string, options?: { readonly force?: boolean }) =>
    ipcRenderer.invoke(desktopIpc.listWorkspaceFiles, workspaceId, options) as Promise<string[]>,
  readWorkspaceFile: (workspaceId: string, filePath: string) =>
    ipcRenderer.invoke(desktopIpc.readWorkspaceFile, workspaceId, filePath) as Promise<WorkspaceFilePreview>,
  getChangedFiles: (workspaceId: string) =>
    ipcRenderer.invoke(desktopIpc.getChangedFiles, workspaceId) as Promise<{ path: string; status: "added" | "modified" | "deleted" | "untracked"; staged: boolean }[]>,
  getFileDiff: (workspaceId: string, filePath: string) =>
    ipcRenderer.invoke(desktopIpc.getFileDiff, workspaceId, filePath) as Promise<string>,
  stageFile: (workspaceId: string, filePath: string) =>
    ipcRenderer.invoke(desktopIpc.stageFile, workspaceId, filePath) as Promise<void>,
  showApplicationMenu: (input: ShowApplicationMenuInput) =>
    ipcRenderer.invoke(desktopIpc.showApplicationMenu, input) as Promise<boolean>,
  toggleWindowMaximize: () => ipcRenderer.invoke(desktopIpc.toggleWindowMaximize) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke(desktopIpc.openExternal, url) as Promise<void>,
  getThemeMode: () => ipcRenderer.invoke(desktopIpc.getThemeMode) as Promise<ThemeMode>,
  getResolvedTheme: () => ipcRenderer.invoke(desktopIpc.getResolvedTheme) as Promise<"light" | "dark">,
  setThemeMode: (mode: ThemeMode) =>
    ipcRenderer.invoke(desktopIpc.setThemeMode, mode) as Promise<DesktopAppState>,
  setThemeId: (themeId: string) =>
    ipcRenderer.invoke(desktopIpc.setThemeId, themeId) as Promise<DesktopAppState>,
  importVSCodeTheme: () =>
    ipcRenderer.invoke(desktopIpc.importVSCodeTheme) as Promise<DesktopAppState | null>,
  deleteCustomTheme: (themeId: string) =>
    ipcRenderer.invoke(desktopIpc.deleteCustomTheme, themeId) as Promise<DesktopAppState>,
  onThemeChanged: (callback: (theme: "light" | "dark") => void) => {
    const handler = (_event: Electron.IpcRendererEvent, theme: "light" | "dark") => callback(theme);
    ipcRenderer.on(desktopIpc.themeChanged, handler);
    return () => {
      ipcRenderer.removeListener(desktopIpc.themeChanged, handler);
    };
  },
});
