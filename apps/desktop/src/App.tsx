import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { injectTheme } from "./theme/theme-injector";
import { resolveThemeById } from "./theme/builtin-themes";
import type { RuntimeSnapshot } from "@pi-frame/session-driver/runtime-types";
import {
  getSelectedSession,
  getSelectedWorkspace,
  type AppView,
} from "./desktop-state";
import { applySnapshotIfNewer, updateSnapshot, useDesktopAppState } from "./app/desktop-app-state";
import { buildFileWorkbenchContexts } from "./app/file-workbench-contexts";
import { canTogglePrimarySidebar, isEventInsideTerminal } from "./app/app-shell-utils";
import { useRunningLabel } from "./hooks/use-running-label";
import { useTimelineScroll, type SidePanelMode } from "./hooks/use-timeline-scroll";
import { formatRelativeTime } from "./string-utils";
import { ComposerPanel } from "./composer-panel";
import { DiffPanel } from "./diff-panel";
import type { DiffPanelFileRequest } from "./diff-panel-types";
import { PlanPanel } from "./plan-panel";
import { latestPlanFromTranscript, planPreviewKey } from "./plan-preview";
import { buildModelOptions } from "./composer-commands";
import {
  desktopCommands,
  getDesktopCommandFromShortcut,
  getDesktopShortcutLabel,
  type PiDesktopCommand,
} from "./ipc";
import { deriveModelOnboardingState } from "./model-onboarding";
import type { SettingsSection } from "./settings-view";
import { SecondarySurfaces } from "./app/secondary-surfaces";
import { BrowserPanel, type BrowserLayoutMode } from "./browser-panel";
import { BrowserPanelResizer } from "./browser-panel-resizer";
import type { BrowserElementAttachment } from "./browser-types";
import { NewThreadView } from "./new-thread-view";
import { buildThreadGroups } from "./thread-groups";
import { Sidebar } from "./sidebar";
import { CapabilitiesView } from "./capabilities-view";
import { SidebarResizer } from "./sidebar-resizer";
import { SidePanelResizer } from "./side-panel-resizer";
import { SidebarToggleButton } from "./sidebar-toggle-button";
import { Topbar } from "./topbar";
import { WindowsTitlebarMenu } from "./windows-titlebar-menu";
import { TerminalPanel } from "./terminal-panel";
import { ConversationTimeline } from "./conversation-timeline";
import { APP_DISPLAY_NAME } from "./branding";
import { useSlashMenu } from "./hooks/use-slash-menu";
import { useMentionMenu } from "./hooks/use-mention-menu";
import { useThreadSearch } from "./hooks/use-thread-search";
import { useWorkspaceMenu } from "./hooks/use-workspace-menu";
import { useNewThreadController } from "./hooks/use-new-thread-controller";
import { ExtensionDialog } from "./extension-session-ui";
import { TreeModal } from "./tree-modal";
import { ForkModal } from "./fork-modal";
import { getEffectiveModelRuntime } from "./model-settings";
import { setRendererLanguage } from "./i18n/renderer";
import { deriveWorkspaceContext } from "./workspace-context";
import { useTreeForkModals } from "./hooks/use-tree-fork-modals";
import { useComposerDraftSync } from "./hooks/use-composer-draft-sync";
import { useSessionComposer } from "./hooks/use-session-composer";
import { SessionStatsBar } from "./session-stats-bar";
import { useTranslation } from "react-i18next";

const HIDE_THINKING_STORAGE_KEY = "pi-frame:hide-thinking-blocks";

export default function App() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot, selectedTranscript] = useDesktopAppState();
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState("");
  const [extensionsWorkspaceId, setExtensionsWorkspaceId] = useState("");
  const [hideThinking, setHideThinking] = useState<boolean>(() => {
    try {
      return globalThis.localStorage?.getItem(HIDE_THINKING_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const handleToggleHideThinking = useCallback(() => {
    setHideThinking((current) => {
      const next = !current;
      try {
        globalThis.localStorage?.setItem(HIDE_THINKING_STORAGE_KEY, String(next));
      } catch {
        // ignore storage failure
      }
      return next;
    });
  }, []);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const timelinePaneRef = useRef<HTMLDivElement | null>(null);
  const previousActiveViewRef = useRef<AppView | null>(null);
  const hasEnteredPrimaryShellRef = useRef(false);
  const [dismissedSchemaSkewSessionKeys, setDismissedSchemaSkewSessionKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [sidePanelMode, setSidePanelMode] = useState<SidePanelMode | null>(null);
  const seenPlanBySessionRef = useRef(new Map<string, string>());
  const [browserPanelWidth, setBrowserPanelWidth] = useState(640);
  const [sidePanelWidth, setSidePanelWidth] = useState(520);
  const [browserLayoutMode, setBrowserLayoutMode] = useState<BrowserLayoutMode>("split");
  const browserPreferencesKeyRef = useRef("");
  const [sidebarWidth, setSidebarWidth] = useState(292);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [openTerminalSessionKey, setOpenTerminalSessionKey] = useState("");
  const [takeoverTerminalSessionKey, setTakeoverTerminalSessionKey] = useState("");
  const [terminalHeight, setTerminalHeight] = useState(340);
  const [diffFileRequest, setDiffFileRequest] = useState<DiffPanelFileRequest | null>(null);
  const threadSearch = useThreadSearch(timelinePaneRef);
  const api = window.piApp;
  const sidebarToggleStateRef = useRef<{
    readonly api: typeof window.piApp;
    readonly activeView: AppView | undefined;
    readonly sidebarCollapsed: boolean;
  }>({
    api,
    activeView: undefined,
    sidebarCollapsed: false,
  });
  sidebarToggleStateRef.current = {
    api,
    activeView: snapshot?.activeView,
    sidebarCollapsed: snapshot?.sidebarCollapsed ?? false,
  };

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi) return;

    void piApi.getResolvedTheme().then((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });

    const unsub = piApi.onThemeChanged((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });

    return unsub;
  }, []);

  // Apply custom theme CSS variables whenever the themeId or custom theme list changes
  useEffect(() => {
    if (!snapshot) return;
    const theme = resolveThemeById(snapshot.themeId, snapshot.customThemes);
    injectTheme(theme);
  }, [snapshot?.themeId, snapshot?.customThemes]);

  useEffect(() => {
    if (snapshot) {
      setRendererLanguage(snapshot.appLanguage);
    }
  }, [snapshot?.appLanguage]);

  const {
    activeWorktrees,
    linkedWorktreeByWorkspaceId,
    rootWorkspace,
    rootWorkspaceOptions,
    selectedWorkspace,
    visibleWorkspaces,
  } = useMemo(() => deriveWorkspaceContext(snapshot), [snapshot]);
  const selectedSession = snapshot ? (getSelectedSession(snapshot) ?? selectedWorkspace?.sessions[0]) : undefined;
  const selectedRuntime = selectedWorkspace ? snapshot?.runtimeByWorkspace[selectedWorkspace.id] : undefined;
  const selectedModelRuntime = snapshot ? getEffectiveModelRuntime(snapshot, selectedWorkspace) : undefined;
  const selectedWorktree = selectedWorkspace ? linkedWorktreeByWorkspaceId.get(selectedWorkspace.id) : undefined;
  const selectedDefaultEnabled = buildModelOptions(selectedModelRuntime).some(
    (m) => m.providerId === selectedModelRuntime?.settings.defaultProvider && m.modelId === selectedModelRuntime?.settings.defaultModelId,
  );
  const resolvedSessionProvider =
    selectedSession?.config?.provider ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultProvider : undefined);
  const resolvedSessionModelId =
    selectedSession?.config?.modelId ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultModelId : undefined);
  const resolvedSessionThinkingLevel =
    selectedSession?.config?.thinkingLevel ?? selectedModelRuntime?.settings.defaultThinkingLevel;
  const selectedSessionModelOnboarding = deriveModelOnboardingState(selectedModelRuntime, {
    provider: resolvedSessionProvider,
    modelId: resolvedSessionModelId,
  });
  const queuedComposerMessages = snapshot?.queuedComposerMessages ?? [];
  const editingQueuedMessageId = snapshot?.editingQueuedMessageId;
  const runningLabel = useRunningLabel(selectedSession?.status === "running" ? selectedSession.runningSince : undefined);
  const selectedSessionKey = selectedWorkspace && selectedSession ? `${selectedWorkspace.id}:${selectedSession.id}` : "";
  const selectedCollaborationMode = snapshot?.collaborationModeBySession[selectedSessionKey] ?? "default";
  const { composerDraft, setComposerDraft, composerDraftRef, flushComposerDraft } = useComposerDraftSync({
    api,
    snapshot,
    selectedSessionKey,
  });
  const isTerminalVisibleForSelectedThread = Boolean(selectedSessionKey) && openTerminalSessionKey === selectedSessionKey;
  const isTerminalTakeoverForSelectedThread = Boolean(selectedSessionKey) && takeoverTerminalSessionKey === selectedSessionKey;
  const selectedTranscriptForSession =
    selectedTranscript &&
    selectedWorkspace &&
    selectedSession &&
    selectedTranscript.workspaceId === selectedWorkspace.id &&
    selectedTranscript.sessionId === selectedSession.id
      ? selectedTranscript
      : null;
  const activeTranscript = selectedTranscriptForSession?.transcript ?? [];
  const latestPlan = useMemo(() => latestPlanFromTranscript(activeTranscript), [activeTranscript]);
  const isTranscriptLoading = Boolean(selectedSession) && !selectedTranscriptForSession;
  useEffect(() => {
    if (!selectedSessionKey || !latestPlan) return;
    const key = planPreviewKey(latestPlan);
    if (seenPlanBySessionRef.current.get(selectedSessionKey) === key) return;
    seenPlanBySessionRef.current.set(selectedSessionKey, key);
    setSidePanelMode((current) => current ?? "plan");
  }, [latestPlan, selectedSessionKey]);
  const {
    setTimelinePaneElement,
    disableTimelineVirtualization,
    finalizeTimelineVirtualizationDisable,
    handleTimelineScroll,
    handleTimelineScrollIntent,
    handleTimelineContentHeightChange,
    handleComposerHeightChange,
    showJumpToLatest,
    jumpToLatest,
    saveCurrentTimelineScrollState,
    beginPreserveTimelineBottom,
    schedulePinnedBottomRealignment,
  } = useTimelineScroll({
    selectedSessionKey,
    activeTranscript,
    selectedSession,
    selectedTranscriptForSession,
    activeView: snapshot?.activeView,
    sidePanelMode,
    timelinePaneRef,
  });
  const showSchemaSkewNotice =
    selectedTranscriptForSession?.schemaInfo?.writtenByNewerRuntime === true &&
    Boolean(selectedSessionKey) &&
    !dismissedSchemaSkewSessionKeys.has(selectedSessionKey);
  const selectedSessionCommands = selectedSession ? snapshot?.sessionCommandsBySession[selectedSessionKey] ?? [] : [];
  const selectedExtensionUi = selectedSession ? snapshot?.sessionExtensionUiBySession[selectedSessionKey] : undefined;
  const selectedWorkspaceCommandCompatibility = selectedWorkspace
    ? snapshot?.extensionCommandCompatibilityByWorkspace[selectedWorkspace.id] ?? []
    : [];
  const fileWorkbenchContexts = useMemo(
    () =>
      buildFileWorkbenchContexts({
        workspaces: snapshot?.workspaces ?? [],
        selectedWorkspace,
        selectedSessionTitle: selectedExtensionUi?.title || selectedSession?.title,
        rootWorkspace,
        activeWorktrees,
      }),
    [
      activeWorktrees,
      rootWorkspace,
      selectedExtensionUi?.title,
      selectedSession?.title,
      selectedWorkspace,
      snapshot?.workspaces,
    ],
  );
  useEffect(() => {
    if (snapshot && snapshot.workspaces.length === 0) {
      setOpenTerminalSessionKey("");
      setTakeoverTerminalSessionKey("");
    }
  }, [snapshot]);
  useEffect(() => {
    setOpenTerminalSessionKey("");
    setTakeoverTerminalSessionKey("");
  }, [selectedSessionKey]);
  const displayedSessionTitle = selectedExtensionUi?.title ?? selectedSession?.title ?? "";
  const activeExtensionDialog = selectedExtensionUi?.pendingDialogs[0];
  const threadGroups = useMemo(
    () => (snapshot ? buildThreadGroups(snapshot) : []),
    [snapshot?.workspaces, snapshot?.worktreesByWorkspace, snapshot?.workspaceOrder],
  );
  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }, []);
  const toggleTerminal = useCallback(() => {
    if (!selectedSessionKey) {
      return;
    }
    if (openTerminalSessionKey === selectedSessionKey) {
      setOpenTerminalSessionKey("");
      setTakeoverTerminalSessionKey("");
      return;
    }
    setOpenTerminalSessionKey(selectedSessionKey);
  }, [openTerminalSessionKey, selectedSessionKey]);
  const handleViewFileInDiff = useCallback((path: string) => {
    setSidePanelMode("changes");
    setDiffFileRequest({ path, nonce: Date.now() });
  }, []);

  const dismissSchemaSkewNotice = useCallback((sessionKey: string) => {
    setDismissedSchemaSkewSessionKeys((current) => {
      if (current.has(sessionKey)) {
        return current;
      }
      const next = new Set(current);
      next.add(sessionKey);
      return next;
    });
  }, []);

  const toggleSidePanelMode = useCallback((mode: SidePanelMode) => {
    const shouldPreserveBottom = beginPreserveTimelineBottom();

    setSidePanelMode((current) => (current === mode ? null : mode));

    if (!shouldPreserveBottom) {
      return;
    }

    schedulePinnedBottomRealignment(3);
  }, [beginPreserveTimelineBottom, schedulePinnedBottomRealignment]);

  const toggleChangesPanel = useCallback(() => {
    toggleSidePanelMode("changes");
  }, [toggleSidePanelMode]);

  const toggleFilesPanel = useCallback(() => {
    toggleSidePanelMode("files");
  }, [toggleSidePanelMode]);

  const togglePlanPanel = useCallback(() => {
    toggleSidePanelMode("plan");
  }, [toggleSidePanelMode]);

  const togglePlanMode = useCallback(async () => {
    if (!api || !selectedWorkspace || !selectedSession || selectedSession.status === "running") return;
    await updateSnapshot(api, setSnapshot, () => api.updateComposerDraft(composerDraftRef.current));
    await updateSnapshot(api, setSnapshot, () => api.submitComposer("/plan", { preserveComposer: true }));
    focusComposer();
  }, [api, focusComposer, selectedSession, selectedWorkspace]);

  const toggleBrowserPanel = useCallback(() => {
    toggleSidePanelMode("browser");
  }, [toggleSidePanelMode]);

  const openBrowserAttachment = useCallback(async (attachment: BrowserElementAttachment) => {
    if (!api || !selectedWorkspace || !selectedSession) return;
    const target = { workspaceId: selectedWorkspace.id, sessionId: selectedSession.id };
    setSidePanelMode("browser");
    try {
      await api.sendBrowserCommand(target, { kind: "activate-tab", tabId: attachment.tabId });
    } catch {
      await api.sendBrowserCommand(target, { kind: "open-tab", url: attachment.page.url });
    }
  }, [api, selectedSession, selectedWorkspace]);

  const openSettings = (workspaceId?: string, section?: SettingsSection) => {
    if (!api) {
      return;
    }
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : settingsWorkspaceId || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setSettingsWorkspaceId(nextWorkspaceId);
    }
    if (section) {
      setSettingsSection(section);
    }
    void updateSnapshot(api, setSnapshot, () => api.setActiveView("settings"));
  };

  const {
    treeModalState,
    forkModalState,
    closeTreeModal,
    openTreeModal,
    navigateTreeSelection,
    closeForkModal,
    openForkModal,
    handleForkSubmit,
    canUseWorktree,
  } = useTreeForkModals({
    api,
    snapshot,
    setSnapshot,
    selectedWorkspace,
    selectedSession,
    selectedSessionKey,
    rootWorkspace,
    activeView: snapshot?.activeView,
    setComposerDraft,
    focusComposer,
  });

  const slashMenu = useSlashMenu({
    composerDraft,
    setComposerDraft,
    selectedRuntime,
    selectedModelRuntime,
    sessionCommands: selectedSessionCommands,
    commandCompatibility: selectedWorkspaceCommandCompatibility,
    selectedSessionKey,
    selectedSession,
    selectedWorkspace,
    isRunning: selectedSession?.status === "running",
    api,
    setSnapshot,
    focusComposer,
    openSettings,
    updateSnapshot,
    allowTreeCommand: true,
    onRunTreeCommand: openTreeModal,
  });

  const enableSelectedMentionExtension = useCallback(
    (filePath: string) => {
      if (!api || !selectedWorkspace) {
        return Promise.resolve();
      }
      return updateSnapshot(api, setSnapshot, () => api.setExtensionEnabled(selectedWorkspace.id, filePath, true)).then(
        () => undefined,
      );
    },
    [api, selectedWorkspace],
  );

  const mentionMenu = useMentionMenu({
    composerDraft,
    setComposerDraft,
    composerRef,
    workspaceId: selectedWorkspace?.id,
    runtime: selectedRuntime,
    api,
    onEnableExtension: enableSelectedMentionExtension,
  });

  const wsMenu = useWorkspaceMenu({
    api,
    snapshot,
    setSnapshot,
    updateSnapshot,
  });

  const newThread = useNewThreadController({
    api,
    snapshot,
    setSnapshot,
    rootWorkspace,
    rootWorkspaceOptions,
    visibleWorkspaces,
    selectedWorkspace,
    expandWorkspace: wsMenu.expandWorkspace,
    openSettings,
    shortcutBindings: snapshot?.shortcutBindings,
  });

  const {
    composerAttachments,
    submitComposerDraft,
    handlePickAttachments,
    handleRemoveAttachment,
    handleEditQueuedMessage,
    handleCancelQueuedEdit,
    handleRemoveQueuedMessage,
    handleSteerQueuedMessage,
    handleComposerPaste,
    handleComposerDrop,
    handlePastedClipboardImage,
    handleComposerKeyDown,
  } = useSessionComposer({
    api,
    snapshot,
    setSnapshot,
    selectedSession,
    composerDraft,
    setComposerDraft,
    composerDraftRef,
    composerRef,
    requiresModelSelection: selectedSessionModelOnboarding.requiresModelSelection,
    openTreeModal,
    handleMentionKeyDown: mentionMenu.handleMentionKeyDown,
    handleSlashKeyDown: slashMenu.handleSlashKeyDown,
    newThreadComposerRef: newThread.composerRef,
    appendNewThreadAttachment: newThread.appendAttachment,
    shortcutBindings: snapshot?.shortcutBindings,
  });



  useEffect(() => {
    if (rootWorkspaceOptions.length === 0) {
      setSettingsWorkspaceId("");
      setExtensionsWorkspaceId("");
      return;
    }
    setSettingsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
    setExtensionsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
  }, [rootWorkspaceOptions]);

  const primarySidebarToggleVisible = canTogglePrimarySidebar(snapshot?.activeView);
  const handleTogglePrimarySidebar = useCallback(() => {
    const sidebarState = sidebarToggleStateRef.current;
    const sidebarApi = sidebarState.api;
    if (!sidebarApi || !canTogglePrimarySidebar(sidebarState.activeView)) {
      return false;
    }
    void updateSnapshot(sidebarApi, setSnapshot, () => sidebarApi.setSidebarCollapsed(!sidebarState.sidebarCollapsed));
    return true;
  }, []);
  const sidebarToggleShortcutLabel = api ? getDesktopShortcutLabel(api.platform, "B") : "";

  useEffect(() => {
    const handleCommand = (command: PiDesktopCommand): boolean => {
      if (command === desktopCommands.openSettings) {
        openSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id);
        return true;
      } else if (command === desktopCommands.openNewThread) {
        newThread.openSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id);
        return true;
      } else if (command === desktopCommands.toggleTerminal) {
        toggleTerminal();
        return true;
      } else if (command === desktopCommands.toggleBrowser) {
        toggleBrowserPanel();
        return true;
      } else if (command === desktopCommands.toggleSidebar) {
        return handleTogglePrimarySidebar();
      }
      return false;
    };

    const removeCommandListener = window.piApp?.onCommand?.(handleCommand);
    const removeWorkspacePickedListener = window.piApp?.onWorkspacePicked?.((workspaceId) => {
      newThread.setPendingWorkspaceId(workspaceId);
      newThread.resetSurface();
    });
    const removeClipboardImageListener = window.piApp?.onClipboardImagePasted?.(handlePastedClipboardImage);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEventInsideTerminal(event)) {
        const command = getDesktopCommandFromShortcut({
          modifier: event.metaKey || event.ctrlKey,
          shift: event.shiftKey,
          key: event.key,
          code: event.code,
          ctrl: event.ctrlKey,
          meta: event.metaKey,
          alt: event.altKey,
          platform: api?.platform,
          bindings: snapshot?.shortcutBindings,
        });
        if (command === desktopCommands.toggleTerminal) {
          event.preventDefault();
          handleCommand(command);
        }
        return;
      }
      // Cmd+F toggles thread search
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && !event.shiftKey) {
        event.preventDefault();
        if (threadSearch.isOpen) {
          threadSearch.close();
        } else {
          threadSearch.open();
        }
        return;
      }
      // Cmd+D toggles diff panel
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && !event.shiftKey) {
        event.preventDefault();
        toggleChangesPanel();
        return;
      }
      const command = getDesktopCommandFromShortcut({
        modifier: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
        key: event.key,
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        platform: api?.platform,
        bindings: snapshot?.shortcutBindings,
      });
      if (command && handleCommand(command)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      removeCommandListener?.();
      removeWorkspacePickedListener?.();
      removeClipboardImageListener?.();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    selectedWorkspace?.id,
    selectedWorkspace?.rootWorkspaceId,
    threadSearch,
    api,
    toggleChangesPanel,
    toggleTerminal,
    toggleBrowserPanel,
    handleTogglePrimarySidebar,
    newThread,
    snapshot?.shortcutBindings,
  ]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    if (
      snapshot.activeView === "threads" &&
      previousActiveViewRef.current !== "threads" &&
      selectedSession
    ) {
      focusComposer();
    }

    previousActiveViewRef.current = snapshot.activeView;
  }, [selectedSession, selectedWorkspace?.id, snapshot]);

  const sidePanelAvailable = snapshot?.activeView === "threads" && Boolean(selectedWorkspace && selectedSession);
  const browserPreferencesKey = selectedWorkspace ? `pi-browser-layout:${selectedWorkspace.id}` : "";
  useEffect(() => {
    browserPreferencesKeyRef.current = browserPreferencesKey;
    if (!browserPreferencesKey) return;
    try {
      const stored = JSON.parse(localStorage.getItem(browserPreferencesKey) ?? "null") as { width?: unknown; mode?: unknown } | null;
      if (typeof stored?.width === "number" && Number.isFinite(stored.width)) setBrowserPanelWidth(Math.min(900, Math.max(420, stored.width)));
      if (stored?.mode === "conversation" || stored?.mode === "split" || stored?.mode === "browser") setBrowserLayoutMode(stored.mode);
    } catch {
      setBrowserPanelWidth(640);
      setBrowserLayoutMode("split");
    }
  }, [browserPreferencesKey]);
  useEffect(() => {
    if (!browserPreferencesKey || browserPreferencesKeyRef.current !== browserPreferencesKey) return;
    localStorage.setItem(browserPreferencesKey, JSON.stringify({ width: browserPanelWidth, mode: browserLayoutMode }));
  }, [browserLayoutMode, browserPanelWidth, browserPreferencesKey]);
  useEffect(() => {
    if (!sidePanelAvailable) {
      setSidePanelMode(null);
    }
  }, [sidePanelAvailable, selectedSessionKey]);

  if (!api || !snapshot) {
    return (
      <div className="shell shell--loading">
        <main className="loading-screen" role="status" aria-live="polite">
          <div className="loading-screen__spinner" aria-hidden="true" />
          <div className="loading-screen__copy">
            <h1>{APP_DISPLAY_NAME}</h1>
            <p>{t("shell.loadingTitle")}</p>
          </div>
        </main>
      </div>
    );
  }

  const showTerminalTakeover = isTerminalVisibleForSelectedThread && isTerminalTakeoverForSelectedThread && Boolean(selectedWorkspace);
  const secondarySurfaceView =
    snapshot.activeView === "settings" || snapshot.activeView === "extensions"
      ? snapshot.activeView
      : null;
  const shouldAnimateShellEntrance = !hasEnteredPrimaryShellRef.current;
  hasEnteredPrimaryShellRef.current = true;
  const shellClassName = `shell${shouldAnimateShellEntrance ? " shell--enter" : ""}${
    snapshot.sidebarCollapsed ? " shell--sidebar-collapsed" : ""
  }${isSidebarResizing ? " shell--sidebar-resizing" : ""}`;
  const mainClassName = [
    "main",
    sidePanelMode ? "main--with-side-panel" : "",
    sidePanelMode ? "main--with-diff" : "",
    sidePanelMode === "browser" ? "main--with-browser" : "",
    sidePanelMode === "browser" ? `main--browser-${browserLayoutMode}` : "",
    isTerminalVisibleForSelectedThread ? "main--with-terminal" : "",
    showTerminalTakeover ? "main--terminal-takeover" : "",
  ].filter(Boolean).join(" ");
  const mainStyle = sidePanelMode === "browser"
    ? ({ "--browser-panel-width": `${browserPanelWidth}px` } as CSSProperties)
    : sidePanelMode && sidePanelMode !== "plan"
      ? ({ "--side-panel-width": `${sidePanelWidth}px` } as CSSProperties)
      : undefined;
  const sidebarToggle = primarySidebarToggleVisible ? (
    <SidebarToggleButton
      collapsed={snapshot.sidebarCollapsed}
      shortcutLabel={sidebarToggleShortcutLabel}
      onToggle={handleTogglePrimarySidebar}
    />
  ) : null;
  const sidebarResizer = !snapshot.sidebarCollapsed ? (
    <SidebarResizer
      value={sidebarWidth}
      min={240}
      max={480}
      onChange={setSidebarWidth}
      onResizeStart={() => setIsSidebarResizing(true)}
      onResizeEnd={() => setIsSidebarResizing(false)}
    />
  ) : null;
  const terminalPanel = isTerminalVisibleForSelectedThread && selectedWorkspace ? (
    <TerminalPanel
      workspace={selectedWorkspace}
      sessionId={selectedSession?.id ?? ""}
      height={terminalHeight}
      isTakeover={isTerminalTakeoverForSelectedThread}
      shortcutBindings={snapshot.shortcutBindings}
      onHeightChange={(nextHeight) => {
        setTerminalHeight(nextHeight);
        setTakeoverTerminalSessionKey((current) => (current === selectedSessionKey ? "" : current));
      }}
      onToggleTakeover={() => {
        setTakeoverTerminalSessionKey((current) => (current === selectedSessionKey ? "" : selectedSessionKey));
      }}
      onHide={() => {
        setOpenTerminalSessionKey((current) => (current === selectedSessionKey ? "" : current));
        setTakeoverTerminalSessionKey((current) => (current === selectedSessionKey ? "" : current));
        focusComposer();
      }}
    />
  ) : null;

  const setActiveView = (view: AppView) => {
    void updateSnapshot(api, setSnapshot, () => api.setActiveView(view));
  };

  const handleSetSessionModel = (provider: string, modelId: string) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () =>
      api.setSessionModel(selectedWorkspace.id, selectedSession.id, provider, modelId),
    );
  };

  const handleSetSessionThinking = (level: string) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () =>
      api.setSessionThinkingLevel(
        selectedWorkspace.id,
        selectedSession.id,
        level as NonNullable<RuntimeSnapshot["settings"]["defaultThinkingLevel"]>,
      ),
    );
  };

  const handleSelectSession = (target: { workspaceId: string; sessionId: string }) => {
    // Flush any debounced draft write before the active session changes, otherwise the pending
    // write for the current session is lost (and would land on the wrong session if deferred).
    flushComposerDraft();
    saveCurrentTimelineScrollState();
    setOpenTerminalSessionKey("");
    setTakeoverTerminalSessionKey("");
    void updateSnapshot(api, setSnapshot, () => api.selectSession(target)).then(() => {
      focusComposer();
    });
  };

  const handleRespondToExtensionDialog = (
    response:
      | { readonly requestId: string; readonly value: string }
      | { readonly requestId: string; readonly confirmed: boolean }
      | { readonly requestId: string; readonly cancelled: true },
  ) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }

    void updateSnapshot(api, setSnapshot, () =>
      api.respondToHostUiRequest(selectedWorkspace.id, selectedSession.id, response),
    ).then(() => {
      focusComposer();
    });
  };

  const handleSetSessionPinned = (target: { workspaceId: string; sessionId: string }, pinned: boolean) => {
    const session = snapshot.workspaces
      .find((workspace) => workspace.id === target.workspaceId)
      ?.sessions.find((entry) => entry.id === target.sessionId);
    void updateSnapshot(api, setSnapshot, async () => {
      if (pinned && session?.archivedAt) {
        await api.unarchiveSession(target);
      }
      return api.setSessionPinned(target, pinned);
    });
  };

  if (secondarySurfaceView) {
    return (
      <SecondarySurfaces
        api={api}
        snapshot={snapshot}
        setSnapshot={setSnapshot}
        activeView={secondarySurfaceView}
        rootWorkspaceOptions={rootWorkspaceOptions}
        settingsSection={settingsSection}
        onSelectSettingsSection={setSettingsSection}
        settingsWorkspaceId={settingsWorkspaceId}
        extensionsWorkspaceId={extensionsWorkspaceId}
        onSelectExtensionsWorkspace={setExtensionsWorkspaceId}
        onBack={() => setActiveView("threads")}
      />
    );
  }

  return (
    <div className={shellClassName} style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <WindowsTitlebarMenu api={api} sidebarToggle={sidebarToggle} />
      <Sidebar
        collapsed={snapshot.sidebarCollapsed}
        activeView={snapshot.activeView}
        selectedWorkspace={selectedWorkspace}
        selectedSession={selectedSession}
        visibleWorkspaces={visibleWorkspaces}
        threadGroups={threadGroups}
        pinnedSessionOrder={snapshot.pinnedSessionOrder}
        linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
        wsMenu={wsMenu}
        api={api}
        setSnapshot={setSnapshot}
        updateSnapshot={updateSnapshot}
        onNewThread={() => newThread.openSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
        onSetActiveView={setActiveView}
        onOpenSettings={openSettings}
        onSelectSession={handleSelectSession}
        onSetSessionPinned={handleSetSessionPinned}
      />
      {sidebarResizer}

      <main className={mainClassName} style={mainStyle}>
        <Topbar
          sidebarToggle={api.platform === "win32" ? null : sidebarToggle}
          activeView={snapshot.activeView}
          rootWorkspace={rootWorkspace}
          selectedWorkspace={selectedWorkspace}
          selectedSession={selectedSession}
          selectedSessionTitle={displayedSessionTitle || selectedSession?.title}
          selectedWorktree={selectedWorktree}
          activeWorktrees={activeWorktrees}
          workspaces={snapshot.workspaces}
          wsMenu={wsMenu}
          api={api}
          shortcutBindings={snapshot.shortcutBindings}
          terminalAvailable={Boolean(selectedSessionKey)}
          terminalVisible={isTerminalVisibleForSelectedThread}
          onToggleTerminal={toggleTerminal}
          panelAvailable={sidePanelAvailable}
          changesVisible={sidePanelMode === "changes"}
          onToggleChanges={toggleChangesPanel}
          filesVisible={sidePanelMode === "files"}
          onToggleFiles={toggleFilesPanel}
          planAvailable={sidePanelAvailable}
          planVisible={sidePanelMode === "plan"}
          onTogglePlan={togglePlanPanel}
          browserVisible={sidePanelMode === "browser"}
          onToggleBrowser={toggleBrowserPanel}
        />

        {showTerminalTakeover ? (
          terminalPanel
        ) : (
          <>
        {snapshot.activeView === "skills" ? (
          <CapabilitiesView
            api={api}
            snapshot={snapshot}
            workspaces={rootWorkspaceOptions}
            initialWorkspaceId={selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id ?? rootWorkspaceOptions[0]?.id ?? ""}
            setSnapshot={setSnapshot}
          />
        ) : snapshot.activeView === "new-thread" ? (
          rootWorkspaceOptions.length > 0 ? (
            <NewThreadView
              workspaces={rootWorkspaceOptions}
              selectedWorkspaceId={newThread.rootWorkspaceId || rootWorkspaceOptions[0]?.id || ""}
              runtime={newThread.runtime}
              environment={newThread.environment}
              collaborationMode={newThread.collaborationMode}
              prompt={newThread.prompt}
              attachments={newThread.attachments}
              isSubmitting={newThread.isStarting}
              lastError={newThread.composerError}
              provider={newThread.resolvedProvider}
              modelId={newThread.resolvedModelId}
              thinkingLevel={newThread.resolvedThinkingLevel}
              modelOnboarding={newThread.modelOnboarding}
              composerRef={newThread.composerRef}
              activeSlashCommand={newThread.slashMenu.activeSlashFlow?.command}
              activeSlashCommandMeta={newThread.slashMenu.activeSlashFlow?.command?.description}
              slashSections={newThread.slashMenu.slashSections}
              slashOptions={newThread.slashMenu.slashOptions}
              selectedSlashCommand={newThread.slashMenu.activeSlashOptionCommand ?? newThread.slashMenu.selectedSlashCommand}
              selectedSlashOption={newThread.slashMenu.selectedSlashOption}
              showSlashMenu={newThread.slashMenu.showSlashMenu}
              showSlashOptionMenu={newThread.slashMenu.showSlashOptionMenu}
              slashOptionEmptyState={newThread.slashMenu.slashOptionEmptyState}
              showMentionMenu={newThread.mentionMenu.showMentionMenu}
              mentionOptions={newThread.mentionMenu.mentionOptions}
              selectedMentionIndex={newThread.mentionMenu.selectedIndex}
              onChangePrompt={newThread.setPrompt}
              onSelectEnvironment={newThread.setEnvironment}
              onSelectWorkspace={newThread.selectWorkspace}
              onSetModel={(provider, modelId) => { newThread.setProvider(provider); newThread.setModelId(modelId); }}
              onSetThinking={newThread.setThinkingLevel}
              onOpenModelSettings={(section) => openSettings(newThread.workspace?.id, section)}
              onComposerKeyDown={newThread.handleComposerKeyDown}
              onComposerPaste={newThread.handleComposerPaste}
              onComposerDrop={newThread.handleComposerDrop}
              onClearSlashCommand={newThread.slashMenu.resetSlashUi}
              onSelectSlashCommand={(command) => {
                newThread.slashMenu.applySlashCommandSelection(command, "click");
              }}
              onSelectSlashOption={(option) => {
                newThread.slashMenu.applySlashOptionSelection(option);
              }}
              onSelectMention={newThread.mentionMenu.insertMention}
              onEnableMentionExtension={newThread.mentionMenu.enableMentionExtension}
              onAddAttachments={newThread.addAttachments}
              onRemoveAttachment={newThread.removeAttachment}
              onSubmit={newThread.startThread}
            />
          ) : (
            <section className="canvas canvas--empty">
              <div className="empty-panel">
                <div className="session-header__eyebrow">{t("common.workspace")}</div>
                <h1>{t("shell.openFolderTitle")}</h1>
                <p>{t("shell.addFolderBeforeThread")}</p>
              </div>
            </section>
          )
        ) : selectedWorkspace && selectedSession ? (
          <>
            <section className="canvas canvas--thread">
              <div className="conversation conversation--thread">
                <div className="chat-header">
                  <div className="chat-header__eyebrow">
                    {selectedWorkspace.kind === "worktree"
                      ? `${rootWorkspace?.name ?? selectedWorkspace.name} · ${selectedWorktree?.name ?? selectedWorkspace.branchName ?? t("common.worktree")}`
                      : `${selectedWorkspace.name} · ${t("common.local")}`}
                  </div>
                  <div className="chat-header__row">
                    <h1 className="chat-header__title">{displayedSessionTitle}</h1>
                    <div className="chat-header__status">
                      {selectedSession.status === "running" ? runningLabel : formatRelativeTime(selectedSession.updatedAt)}
                    </div>
                  </div>
                  <SessionStatsBar
                    transcript={activeTranscript}
                    selectedModelRuntime={selectedModelRuntime}
                    resolvedProvider={resolvedSessionProvider}
                    resolvedModelId={resolvedSessionModelId}
                    hideThinking={hideThinking}
                    onToggleHideThinking={handleToggleHideThinking}
                  />
                </div>

                {showSchemaSkewNotice ? (
                  <div className="schema-skew-notice" role="status" data-testid="schema-skew-notice">
                    <span className="schema-skew-notice__text">
                      {t("shell.schemaSkewNotice", { appName: APP_DISPLAY_NAME })}
                    </span>
                    <button
                      type="button"
                      className="schema-skew-notice__dismiss"
                      aria-label={t("shell.dismissNotice")}
                      onClick={() => dismissSchemaSkewNotice(selectedSessionKey)}
                    >
                      {t("common.dismiss")}
                    </button>
                  </div>
                ) : null}

                <ConversationTimeline
                  transcript={activeTranscript}
                  sessionKey={selectedSessionKey}
                  isTranscriptLoading={isTranscriptLoading}
                  streamingAssistantMessageId={
                    selectedSession.status === "running" ? selectedSession.activeAssistantMessageId : undefined
                  }
                  timelinePaneRef={timelinePaneRef}
                  timelinePaneElementRef={setTimelinePaneElement}
                  disableVirtualization={disableTimelineVirtualization}
                  onDisableVirtualizationReady={finalizeTimelineVirtualizationDisable}
                  onTimelineScroll={handleTimelineScroll}
                  onTimelineScrollIntent={handleTimelineScrollIntent}
                  threadSearch={threadSearch}
                  showJumpToLatest={showJumpToLatest}
                  onJumpToLatest={jumpToLatest}
                  onContentHeightChange={handleTimelineContentHeightChange}
                  onViewFileInDiff={handleViewFileInDiff}
                  onViewPlan={latestPlan ? () => setSidePanelMode("plan") : undefined}
                  onForkFromMessage={selectedSession.status === "running" ? undefined : openForkModal}
                  onOpenBrowserAttachment={openBrowserAttachment}
                  hideThinking={hideThinking}
                />
              </div>
            </section>
            <ComposerPanel
              key={selectedSessionKey}
              collaborationMode={selectedCollaborationMode}
              activeSlashCommand={slashMenu.activeSlashFlow?.command}
              activeSlashCommandMeta={slashMenu.activeSlashFlow?.command?.description}
              attachments={composerAttachments}
              queuedMessages={queuedComposerMessages}
              editingQueuedMessageId={editingQueuedMessageId}
              composerDraft={composerDraft}
              composerRef={composerRef}
              runtime={selectedModelRuntime}
              provider={resolvedSessionProvider}
              modelId={resolvedSessionModelId}
              thinkingLevel={resolvedSessionThinkingLevel}
              onClearSlashCommand={slashMenu.resetSlashUi}
              onComposerKeyDown={handleComposerKeyDown}
              onComposerPaste={handleComposerPaste}
              onComposerDrop={handleComposerDrop}
              onPickAttachments={handlePickAttachments}
              onRemoveAttachment={handleRemoveAttachment}
              onEditQueuedMessage={handleEditQueuedMessage}
              onCancelQueuedEdit={handleCancelQueuedEdit}
              onRemoveQueuedMessage={handleRemoveQueuedMessage}
              onSteerQueuedMessage={handleSteerQueuedMessage}
              onSelectSlashCommand={(command) => {
                slashMenu.applySlashCommandSelection(command, "click");
              }}
              onSelectSlashOption={(option) => {
                slashMenu.applySlashOptionSelection(option);
              }}
              onSetModel={handleSetSessionModel}
              onSetThinking={handleSetSessionThinking}
              modelOnboarding={selectedSessionModelOnboarding}
              onOpenModelSettings={(section) =>
                openSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id, section)
              }
              onSubmit={submitComposerDraft}
              runningLabel={runningLabel}
              selectedSession={selectedSession}
              lastError={snapshot.lastError}
              selectedSlashCommand={slashMenu.activeSlashOptionCommand ?? slashMenu.selectedSlashCommand}
              selectedSlashOption={slashMenu.selectedSlashOption}
              slashOptionEmptyState={slashMenu.slashOptionEmptyState}
              setComposerDraft={setComposerDraft}
              showSlashOptionMenu={slashMenu.showSlashOptionMenu}
              showSlashMenu={slashMenu.showSlashMenu}
              slashOptions={slashMenu.slashOptions}
              slashSections={slashMenu.slashSections}
              showMentionMenu={mentionMenu.showMentionMenu}
              mentionOptions={mentionMenu.mentionOptions}
              selectedMentionIndex={mentionMenu.selectedIndex}
              onSelectMention={mentionMenu.insertMention}
              onEnableMentionExtension={mentionMenu.enableMentionExtension}
              onTextareaHeightChange={handleComposerHeightChange}
            />
            {activeExtensionDialog ? (
              <ExtensionDialog dialog={activeExtensionDialog} onRespond={handleRespondToExtensionDialog} />
            ) : null}
            {treeModalState.open ? (
              <TreeModal
                error={treeModalState.error}
                loading={treeModalState.loading}
                submitting={treeModalState.submitting}
                tree={treeModalState.tree}
                onClose={closeTreeModal}
                onNavigate={navigateTreeSelection}
              />
            ) : null}
            {forkModalState.open ? (
              <ForkModal
                error={forkModalState.error}
                submitting={forkModalState.submitting}
                messagePreview={forkModalState.messagePreview}
                canUseWorktree={canUseWorktree}
                onClose={closeForkModal}
                onSubmit={handleForkSubmit}
              />
            ) : null}
          </>
        ) : selectedWorkspace ? (
          <section className="canvas canvas--empty">
            <div className="empty-panel">
              <div className="session-header__eyebrow">{t("common.workspace")}</div>
              <h1>{selectedWorkspace.name}</h1>
              <p>{t("shell.createThreadForWorkspace")}</p>
              <div className="empty-panel__actions">
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => newThread.openSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
                >
                  {t("common.newThread")}
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="canvas canvas--empty">
            <div className="empty-panel">
              <div className="session-header__eyebrow">{t("common.workspace")}</div>
              <h1>{t("shell.openFolderTitle")}</h1>
              <p>{t("shell.organizeFolders")}</p>
            </div>
          </section>
        )}

        {terminalPanel}
          </>
        )}
        {sidePanelMode === "browser" && browserLayoutMode === "split" ? (
          <BrowserPanelResizer
            value={browserPanelWidth}
            min={420}
            max={Math.max(420, Math.min(900, window.innerWidth - 420))}
            onChange={setBrowserPanelWidth}
          />
        ) : sidePanelMode && sidePanelMode !== "browser" && sidePanelMode !== "plan" ? (
          <SidePanelResizer
            value={sidePanelWidth}
            min={340}
            max={Math.max(340, window.innerWidth - 360)}
            onChange={setSidePanelWidth}
          />
        ) : null}
        {sidePanelMode === "browser" && selectedWorkspace && selectedSession ? (
          <BrowserPanel
            key={`${selectedWorkspace.id}:${selectedSession.id}`}
            api={api}
            target={{ workspaceId: selectedWorkspace.id, sessionId: selectedSession.id }}
            layoutMode={browserLayoutMode}
            onLayoutModeChange={setBrowserLayoutMode}
          />
        ) : sidePanelMode === "plan" && selectedWorkspace && selectedSession ? (
          <PlanPanel
            plan={latestPlan}
            planModeDisabled={selectedSession.status === "running"}
            planModeEnabled={selectedCollaborationMode === "plan"}
            onTogglePlanMode={togglePlanMode}
          />
        ) : sidePanelMode && sidePanelMode !== "browser" && sidePanelMode !== "plan" && selectedWorkspace && selectedSession ? (
          <DiffPanel
            key={sidePanelMode}
            panelMode={sidePanelMode}
            workspaceId={selectedWorkspace.id}
            sessionId={selectedSession.id}
            api={api}
            sessionStatus={selectedSession.status}
            fileRequest={diffFileRequest}
            contexts={fileWorkbenchContexts}
            onEnsureExpanded={() => {
              if (sidePanelWidth < 740) {
                setSidePanelWidth(760);
              }
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
