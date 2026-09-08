import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
import {
  type AppView,
  type CollaborationMode,
  type ComposerAttachment,
  type DesktopAppState,
  type NewThreadEnvironment,
  type StartThreadInput,
  type WorkspaceRecord,
} from "../desktop-state";
import { updateSnapshot } from "../app/desktop-app-state";
import {
  extractFilesFromDataTransfer,
  extractImageFilesFromClipboardData,
  handleClipboardImageShortcut,
  readComposerAttachmentsFromFiles,
} from "../composer-attachments";
import { buildModelOptions, parseTreeComposerCommand } from "../composer-commands";
import type { PiDesktopApi } from "../ipc";
import {
  defaultShortcutBindings,
  insertTextAtSelection,
  shortcutMatches,
  type ShortcutBindings,
} from "../keyboard-shortcuts";
import { deriveModelOnboardingState } from "../model-onboarding";
import { getEffectiveModelRuntime } from "../model-settings";
import type { SettingsSection } from "../settings-view";
import { useMentionMenu } from "./use-mention-menu";
import { useSlashMenu } from "./use-slash-menu";
import { resolveRepoWorkspaceId } from "../workspace-roots";

interface UseNewThreadControllerParams {
  readonly api: PiDesktopApi | undefined;
  readonly snapshot: DesktopAppState | null;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly rootWorkspaceOptions: readonly WorkspaceRecord[];
  readonly visibleWorkspaces: readonly WorkspaceRecord[];
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly expandWorkspace: (workspaceId: string) => void;
  readonly openSettings: (workspaceId?: string, section?: SettingsSection) => void;
  readonly shortcutBindings?: ShortcutBindings;
}

export function useNewThreadController(params: UseNewThreadControllerParams) {
  const {
    api,
    snapshot,
    setSnapshot,
    rootWorkspace,
    rootWorkspaceOptions,
    visibleWorkspaces,
    selectedWorkspace,
    expandWorkspace,
    openSettings,
    shortcutBindings = defaultShortcutBindings,
  } = params;

  const [pendingWorkspaceId, setPendingWorkspaceId] = useState("");
  const [rootWorkspaceId, setRootWorkspaceId] = useState("");
  const [environment, setEnvironment] = useState<NewThreadEnvironment>("local");
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<readonly ComposerAttachment[]>([]);
  const [provider, setProvider] = useState<string | undefined>();
  const [modelId, setModelId] = useState<string | undefined>();
  const [thinkingLevel, setThinkingLevel] = useState<string | undefined>();
  const [collaborationMode, setCollaborationMode] = useState<CollaborationMode>("default");
  const [composerError, setComposerError] = useState<string | undefined>();
  const [isStarting, setIsStarting] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const previousActiveViewRef = useRef<AppView | null>(null);
  const startInFlightRef = useRef(false);

  const workspace = rootWorkspaceOptions.find((entry) => entry.id === rootWorkspaceId) ?? rootWorkspaceOptions[0];
  const runtime = snapshot ? getEffectiveModelRuntime(snapshot, workspace) : undefined;
  const defaultEnabled = buildModelOptions(runtime).some(
    (m) => m.providerId === runtime?.settings.defaultProvider && m.modelId === runtime?.settings.defaultModelId,
  );
  const resolvedProvider = provider ?? (defaultEnabled ? runtime?.settings.defaultProvider : undefined);
  const resolvedModelId = modelId ?? (defaultEnabled ? runtime?.settings.defaultModelId : undefined);
  const resolvedThinkingLevel = thinkingLevel ?? runtime?.settings.defaultThinkingLevel;
  const modelOnboarding = deriveModelOnboardingState(runtime, {
    provider: resolvedProvider,
    modelId: resolvedModelId,
  });

  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }, []);

  const updatePrompt = useCallback((value: SetStateAction<string>) => {
    setComposerError(undefined);
    setPrompt(value);
  }, []);

  const addAttachments = useCallback((files: File[]) => {
    void readComposerAttachmentsFromFiles(files).then((added) => {
      if (added.length === 0) {
        return;
      }
      setAttachments((current) => [...current, ...added]);
    });
  }, []);

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, []);

  const appendAttachment = useCallback((attachment: ComposerAttachment) => {
    setAttachments((current) => [...current, attachment]);
  }, []);

  const resetSurface = useCallback(
    (workspaceId?: string) => {
      const nextWorkspaceId =
        (workspaceId &&
          (rootWorkspaceOptions.find((w) => w.id === workspaceId)?.id ||
            (snapshot ? resolveRepoWorkspaceId(snapshot.workspaces, workspaceId) : undefined))) ||
        rootWorkspace?.id ||
        visibleWorkspaces[0]?.id ||
        "";
      if (nextWorkspaceId) {
        setRootWorkspaceId(nextWorkspaceId);
      }
      setEnvironment("local");
      setPrompt("");
      setAttachments([]);
      setProvider(undefined);
      setModelId(undefined);
      setThinkingLevel(undefined);
      setCollaborationMode("default");
      setComposerError(undefined);
    },
    [rootWorkspace?.id, rootWorkspaceOptions, snapshot, visibleWorkspaces],
  );

  const openSurface = useCallback(
    (workspaceId?: string) => {
      setPendingWorkspaceId("");
      resetSurface(workspaceId);
      if (api) {
        void updateSnapshot(api, setSnapshot, () => api.setActiveView("new-thread"));
      }
    },
    [api, resetSurface, setSnapshot],
  );

  const selectWorkspace = useCallback((workspaceId: string) => {
    setPendingWorkspaceId("");
    setRootWorkspaceId(workspaceId);
    setAttachments([]);
    setProvider(undefined);
    setModelId(undefined);
    setThinkingLevel(undefined);
    setComposerError(undefined);
  }, []);

  const slashMenu = useSlashMenu({
    composerDraft: prompt,
    setComposerDraft: updatePrompt,
    selectedRuntime: runtime,
    selectedModelRuntime: runtime,
    sessionCommands: [],
    commandCompatibility: [],
    selectedSessionKey: `new-thread:${workspace?.id ?? ""}`,
    selectedSession: undefined,
    selectedWorkspace: workspace,
    isRunning: false,
    api,
    setSnapshot,
    focusComposer,
    openSettings,
    updateSnapshot,
    allowTreeCommand: false,
    immediateCommandMode: "prefill",
    onSelectModelOption: (nextProvider, nextModelId) => {
      setProvider(nextProvider);
      setModelId(nextModelId);
    },
    onSelectThinkingOption: setThinkingLevel,
    onTogglePlanMode: () => setCollaborationMode((current) => current === "plan" ? "default" : "plan"),
    onSelectLoginProvider: (providerId) => {
      if (!api || !workspace) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.loginProvider(workspace.id, providerId));
    },
    onSelectLogoutProvider: (providerId) => {
      if (!api || !workspace) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.logoutProvider(workspace.id, providerId));
    },
  });

  const enableMentionExtension = useCallback(
    (filePath: string) => {
      if (!api || !workspace) {
        return Promise.resolve();
      }
      return updateSnapshot(api, setSnapshot, () => api.setExtensionEnabled(workspace.id, filePath, true)).then(
        () => undefined,
      );
    },
    [api, setSnapshot, workspace],
  );

  const mentionMenu = useMentionMenu({
    composerDraft: prompt,
    setComposerDraft: setPrompt,
    composerRef,
    workspaceId: workspace?.id,
    runtime,
    api,
    onEnableExtension: enableMentionExtension,
  });

  const startThread = useCallback(() => {
    if (!api || startInFlightRef.current) {
      return;
    }
    if (!rootWorkspaceId || (!prompt.trim() && attachments.length === 0)) {
      return;
    }
    if (modelOnboarding.requiresModelSelection) {
      return;
    }
    const treeCommand = parseTreeComposerCommand(prompt);
    if (treeCommand?.type === "error") {
      setComposerError(treeCommand.message);
      return;
    }
    if (treeCommand?.type === "tree") {
      setComposerError("/tree is only available inside an existing session.");
      return;
    }
    const input: StartThreadInput = {
      rootWorkspaceId,
      environment,
      prompt,
      attachments,
      provider: resolvedProvider,
      modelId: resolvedModelId,
      thinkingLevel: resolvedThinkingLevel,
      collaborationMode,
    };
    startInFlightRef.current = true;
    setIsStarting(true);
    expandWorkspace(rootWorkspaceId);
    void updateSnapshot(api, setSnapshot, () => api.startThread(input))
      .then(() => {
        setPrompt("");
        setAttachments([]);
        setProvider(undefined);
        setModelId(undefined);
        setThinkingLevel(undefined);
        setCollaborationMode("default");
        setEnvironment("local");
      })
      .catch((error: unknown) => {
        setComposerError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        startInFlightRef.current = false;
        setIsStarting(false);
      });
  }, [
    api,
    attachments,
    collaborationMode,
    environment,
    expandWorkspace,
    modelOnboarding.requiresModelSelection,
    prompt,
    resolvedModelId,
    resolvedProvider,
    resolvedThinkingLevel,
    rootWorkspaceId,
    setSnapshot,
  ]);

  const handleComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const files = extractImageFilesFromClipboardData(event.clipboardData);
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      addAttachments(files);
    },
    [addAttachments],
  );

  const handleComposerDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const files = extractFilesFromDataTransfer(event.dataTransfer);
      if (files.length === 0) {
        return;
      }
      addAttachments(files);
    },
    [addAttachments],
  );

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleClipboardImageShortcut(event, api?.readClipboardImage, appendAttachment)) {
        return;
      }

      if (mentionMenu.handleMentionKeyDown(event)) {
        return;
      }

      if (slashMenu.handleSlashKeyDown(event)) {
        return;
      }

      if (event.nativeEvent.isComposing) {
        return;
      }

      if (shortcutMatches(event, shortcutBindings.newLine, api?.platform ?? "win32")) {
        if (event.key !== "Enter") {
          event.preventDefault();
          const insertion = insertTextAtSelection(event.currentTarget, prompt, "\n");
          setPrompt(insertion.value);
          window.requestAnimationFrame(() => event.currentTarget.setSelectionRange(insertion.cursor, insertion.cursor));
        }
        return;
      }

      if (!shortcutMatches(event, shortcutBindings.sendMessage, api?.platform ?? "win32")) {
        return;
      }

      event.preventDefault();
      if (!prompt.trim() && attachments.length === 0) {
        return;
      }
      if (modelOnboarding.requiresModelSelection) {
        return;
      }

      startThread();
    },
    [api, appendAttachment, attachments.length, mentionMenu, modelOnboarding.requiresModelSelection, prompt, shortcutBindings, slashMenu, startThread],
  );

  useEffect(() => {
    if (rootWorkspaceOptions.length === 0) {
      setPendingWorkspaceId("");
      setRootWorkspaceId("");
      setEnvironment("local");
      setAttachments([]);
      return;
    }
    setRootWorkspaceId((current) =>
      rootWorkspaceOptions.some((w) => w.id === current) ? current : current || rootWorkspaceOptions[0]?.id || "",
    );
  }, [rootWorkspaceOptions]);

  useEffect(() => {
    if (!snapshot || !pendingWorkspaceId) {
      return;
    }
    const nextRootWorkspaceId = resolveRepoWorkspaceId(snapshot.workspaces, pendingWorkspaceId);
    if (!nextRootWorkspaceId || !rootWorkspaceOptions.some((w) => w.id === nextRootWorkspaceId)) {
      return;
    }
    setRootWorkspaceId(nextRootWorkspaceId);
    setPendingWorkspaceId("");
  }, [pendingWorkspaceId, rootWorkspaceOptions, snapshot]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    if (snapshot.activeView === "new-thread" && previousActiveViewRef.current !== "new-thread") {
      const nextRootWorkspaceId = resolveRepoWorkspaceId(snapshot.workspaces, selectedWorkspace?.id);
      if (nextRootWorkspaceId) {
        setRootWorkspaceId(nextRootWorkspaceId);
      }
    }
    previousActiveViewRef.current = snapshot.activeView;
  }, [selectedWorkspace?.id, snapshot]);

  return useMemo(
    () => ({
      composerRef,
      workspace,
      runtime,
      rootWorkspaceId,
      environment,
      prompt,
      attachments,
      collaborationMode,
      composerError,
      isStarting,
      resolvedProvider,
      resolvedModelId,
      resolvedThinkingLevel,
      modelOnboarding,
      slashMenu,
      mentionMenu,
      setPrompt,
      setEnvironment,
      setProvider,
      setModelId,
      setThinkingLevel,
      setPendingWorkspaceId,
      selectWorkspace,
      addAttachments,
      removeAttachment,
      appendAttachment,
      handleComposerPaste,
      handleComposerDrop,
      handleComposerKeyDown,
      startThread,
      openSurface,
      resetSurface,
    }),
    [
      workspace,
      runtime,
      rootWorkspaceId,
      environment,
      prompt,
      attachments,
      collaborationMode,
      composerError,
      isStarting,
      resolvedProvider,
      resolvedModelId,
      resolvedThinkingLevel,
      modelOnboarding,
      slashMenu,
      mentionMenu,
      selectWorkspace,
      addAttachments,
      removeAttachment,
      appendAttachment,
      handleComposerPaste,
      handleComposerDrop,
      handleComposerKeyDown,
      startThread,
      openSurface,
      resetSurface,
    ],
  );
}
