import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { AppView, DesktopAppState, WorkspaceRecord } from "../desktop-state";
import { updateSnapshot } from "./desktop-app-state";
import {
  type DeleteModelConfigurationInput,
  type DesktopNotificationPermissionStatus,
  type ModelConfigurationDefaultsInput,
  type SaveModelConfigurationInput,
} from "../ipc";
import { ExtensionsView } from "../extensions-view";
import { SettingsView, type SettingsSection } from "../settings-view";
import { SecondarySurface } from "../secondary-surface";
import { useTranslation } from "react-i18next";
import type { AppLanguage } from "../desktop-state";

interface SecondarySurfacesProps {
  readonly api: NonNullable<typeof window.piApp>;
  readonly snapshot: DesktopAppState;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly activeView: Extract<AppView, "settings" | "extensions">;
  readonly rootWorkspaceOptions: readonly WorkspaceRecord[];
  readonly settingsSection: SettingsSection;
  readonly onSelectSettingsSection: (section: SettingsSection) => void;
  readonly settingsWorkspaceId: string;
  readonly extensionsWorkspaceId: string;
  readonly onSelectExtensionsWorkspace: (workspaceId: string) => void;
  readonly onBack: () => void;
}

export function SecondarySurfaces({
  api,
  snapshot,
  setSnapshot,
  activeView,
  rootWorkspaceOptions,
  settingsSection,
  onSelectSettingsSection,
  settingsWorkspaceId,
  extensionsWorkspaceId,
  onSelectExtensionsWorkspace,
  onBack,
}: SecondarySurfacesProps) {
  const { t } = useTranslation();
  const settingsNav = [
    { id: "appearance", label: t("common.appearance") },
    { id: "general", label: t("common.general") },
    { id: "models", label: t("common.models") },
    { id: "notifications", label: t("common.notifications") },
  ] as const;
  const [notificationPermissionStatus, setNotificationPermissionStatus] =
    useState<DesktopNotificationPermissionStatus>("unknown");
  const [notificationPermissionPending, setNotificationPermissionPending] = useState(false);

  const settingsWorkspace = settingsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === settingsWorkspaceId)
    : undefined;
  const extensionsWorkspace = extensionsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === extensionsWorkspaceId)
    : undefined;
  const settingsRuntime = settingsWorkspace ? snapshot.runtimeByWorkspace[settingsWorkspace.id] : undefined;
  const extensionsRuntime = extensionsWorkspace ? snapshot.runtimeByWorkspace[extensionsWorkspace.id] : undefined;
  const extensionsCommandCompatibility = extensionsWorkspace
    ? snapshot.extensionCommandCompatibilityByWorkspace[extensionsWorkspace.id] ?? []
    : [];

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi?.onNotificationPermissionStatusChanged) {
      return;
    }
    return piApi.onNotificationPermissionStatusChanged((status) => {
      setNotificationPermissionStatus(status);
    });
  }, []);

  const refreshNotificationPermissionStatus = useCallback(() => {
    if (!api.getNotificationPermissionStatus) {
      return Promise.resolve("unknown" as DesktopNotificationPermissionStatus);
    }
    return api.getNotificationPermissionStatus().then((status) => {
      setNotificationPermissionStatus(status);
      return status;
    });
  }, [api]);

  useEffect(() => {
    if (activeView !== "settings" || settingsSection !== "notifications") {
      return;
    }
    void refreshNotificationPermissionStatus();
  }, [activeView, refreshNotificationPermissionStatus, settingsSection]);

  const handleToggleSkillCommands = (enabled: boolean) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setEnableSkillCommands(settingsWorkspace.id, enabled));
  };

  const handleSaveModel = async (input: SaveModelConfigurationInput): Promise<string | undefined> => {
    const state = await updateSnapshot(api, setSnapshot, () => api.saveModelConfiguration(input));
    return state.lastError;
  };

  const handleDeleteModel = async (input: DeleteModelConfigurationInput): Promise<string | undefined> => {
    const state = await updateSnapshot(api, setSnapshot, () => api.deleteModelConfiguration(input));
    return state.lastError;
  };

  const handleSetModelDefaults = async (input: ModelConfigurationDefaultsInput): Promise<string | undefined> => {
    const state = await updateSnapshot(api, setSnapshot, () => api.setModelConfigurationDefaults(input));
    return state.lastError;
  };

  const handleToggleExtension = (filePath: string, enabled: boolean) => {
    if (!extensionsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setExtensionEnabled(extensionsWorkspace.id, filePath, enabled));
  };

  const handleOpenExtensionFolder = (filePath: string) => {
    if (!extensionsWorkspace) {
      return;
    }
    void api.openExtensionInFinder(extensionsWorkspace.id, filePath);
  };

  const handleSetThemeMode = (mode: DesktopAppState["themeMode"]) => {
    void updateSnapshot(api, setSnapshot, () => api.setThemeMode(mode));
  };

  const handleSetThemeId = (themeId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.setThemeId(themeId));
  };

  const handleImportVSCodeTheme = () => {
    void (async () => {
      const nextState = await api.importVSCodeTheme();
      if (nextState) {
        setSnapshot(nextState);
      }
    })();
  };

  const handleDeleteCustomTheme = (themeId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.deleteCustomTheme(themeId));
  };

  const handleSetNotificationPreferences = (preferences: Partial<DesktopAppState["notificationPreferences"]>) => {
    void updateSnapshot(api, setSnapshot, () => api.setNotificationPreferences(preferences));
  };

  const handleSetIntegratedTerminalShell = (shellPath: string) => {
    void updateSnapshot(api, setSnapshot, () => api.setIntegratedTerminalShell(shellPath));
  };

  const handleSetComputerUseEnabled = (enabled: boolean) => {
    void updateSnapshot(api, setSnapshot, () => api.setComputerUseEnabled(enabled));
  };

  const handleRequestNotificationPermission = () => {
    if (!api.requestNotificationPermission) {
      return;
    }
    setNotificationPermissionPending(true);
    void api
      .requestNotificationPermission()
      .then((status) => {
        setNotificationPermissionStatus(status);
      })
      .finally(() => {
        setNotificationPermissionPending(false);
      });
  };

  const handleOpenSystemNotificationSettings = () => {
    if (!api.openSystemNotificationSettings) {
      return;
    }
    setNotificationPermissionPending(true);
    void api.openSystemNotificationSettings().finally(() => {
      setNotificationPermissionPending(false);
    });
  };

  if (activeView === "extensions") {
    return (
      <SecondarySurface onBack={onBack} testId="extensions-surface" title={t("common.extensions")}>
        <div className="surface-toolbar">
          <label className="surface-toolbar__field">
            <span>{t("common.workspace")}</span>
            <select
              value={extensionsWorkspace?.id ?? ""}
              onChange={(event) => onSelectExtensionsWorkspace(event.target.value)}
            >
              {rootWorkspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ExtensionsView
          workspace={extensionsWorkspace}
          runtime={extensionsRuntime}
          commandCompatibility={extensionsCommandCompatibility}
          onOpenExtensionFolder={handleOpenExtensionFolder}
          onRefresh={() => {
            if (!extensionsWorkspace) {
              return;
            }
            void updateSnapshot(api, setSnapshot, () => api.refreshRuntime(extensionsWorkspace.id));
          }}
          onToggleExtension={handleToggleExtension}
        />
      </SecondarySurface>
    );
  }

  return (
    <SecondarySurface
      activeNavId={settingsSection}
      navItems={settingsNav}
      onBack={onBack}
      onSelectNav={(section) => onSelectSettingsSection(section as SettingsSection)}
      testId="settings-surface"
      title={t("common.settings")}
    >
      <SettingsView
        workspace={settingsWorkspace}
        runtime={settingsRuntime}
        section={settingsSection}
        notificationPreferences={snapshot.notificationPreferences}
        notificationPermissionStatus={notificationPermissionStatus}
        notificationPermissionPending={notificationPermissionPending}
        integratedTerminalShell={snapshot.integratedTerminalShell}
        appLanguage={snapshot.appLanguage}
        computerUseEnabled={snapshot.computerUseEnabled}
        platform={api.platform}
        shortcutBindings={snapshot.shortcutBindings}
        themeMode={snapshot.themeMode}
        themeId={snapshot.themeId}
        customThemes={snapshot.customThemes}
        onSaveModel={handleSaveModel}
        onDeleteModel={handleDeleteModel}
        onSetModelDefaults={handleSetModelDefaults}
        onSetNotificationPreferences={handleSetNotificationPreferences}
        onSetIntegratedTerminalShell={handleSetIntegratedTerminalShell}
        onSetShortcutBindings={(bindings) => {
          void updateSnapshot(api, setSnapshot, () => api.setShortcutBindings(bindings));
        }}
        onSetAppLanguage={(language: AppLanguage) => {
          void updateSnapshot(api, setSnapshot, () => api.setAppLanguage(language));
        }}
        onRequestNotificationPermission={handleRequestNotificationPermission}
        onOpenSystemNotificationSettings={handleOpenSystemNotificationSettings}
        onSetThemeMode={handleSetThemeMode}
        onSetThemeId={handleSetThemeId}
        onImportVSCodeTheme={handleImportVSCodeTheme}
        onDeleteCustomTheme={handleDeleteCustomTheme}
        onToggleSkillCommands={handleToggleSkillCommands}
        onSetComputerUseEnabled={handleSetComputerUseEnabled}
        onCheckForUpdates={() => api.checkForUpdates(settingsWorkspace?.id)}
        onInstallAppUpdate={() => api.installAppUpdate()}
        onUpdateExtensions={async (sources) => {
          if (!settingsWorkspace) {
            throw new Error(t("settings.workspaceRequired"));
          }
          await updateSnapshot(api, setSnapshot, () => api.updateExtensions(settingsWorkspace.id, sources));
        }}
      />
    </SecondarySurface>
  );
}
