import type { RuntimeSnapshot } from "@pi-frame/session-driver/runtime-types";
import type { NotificationPreferences, ThemeMode, WorkspaceRecord } from "./desktop-state";
import type {
  DeleteModelConfigurationInput,
  DesktopNotificationPermissionStatus,
  ModelConfigurationDefaultsInput,
  SaveModelConfigurationInput,
  SoftwareUpdateSnapshot,
} from "./ipc";
import { SettingsAppearanceSection } from "./settings-appearance-section";
import { SettingsGeneralSection } from "./settings-general-section";
import { SettingsModelsSection } from "./settings-models-section";
import { SettingsNotificationsSection } from "./settings-notifications-section";
import { type SettingsSection, sectionTitle, sectionDescription } from "./settings-utils";
import { useTranslation } from "react-i18next";
import type { ShortcutBindings } from "./keyboard-shortcuts";

export type { SettingsSection } from "./settings-utils";

interface SettingsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly section: SettingsSection;
  readonly notificationPreferences: NotificationPreferences;
  readonly notificationPermissionStatus: DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly integratedTerminalShell: string;
  readonly appLanguage: import("./desktop-state").AppLanguage;
  readonly computerUseEnabled: boolean;
  readonly platform: NodeJS.Platform;
  readonly shortcutBindings: ShortcutBindings;
  readonly themeMode: ThemeMode;
  readonly themeId: string;
  readonly customThemes: readonly import("./theme/types").CustomTheme[];
  readonly onSaveModel: (input: SaveModelConfigurationInput) => Promise<string | undefined>;
  readonly onDeleteModel: (input: DeleteModelConfigurationInput) => Promise<string | undefined>;
  readonly onSetModelDefaults: (input: ModelConfigurationDefaultsInput) => Promise<string | undefined>;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
  readonly onSetComputerUseEnabled: (enabled: boolean) => void;
  readonly onSetShortcutBindings: (bindings: ShortcutBindings) => void;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onSetAppLanguage: (language: import("./desktop-state").AppLanguage) => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
  readonly onSetThemeMode: (mode: ThemeMode) => void;
  readonly onSetThemeId: (themeId: string) => void;
  readonly onImportVSCodeTheme: () => void;
  readonly onDeleteCustomTheme: (themeId: string) => void;
  readonly onCheckForUpdates: () => Promise<SoftwareUpdateSnapshot>;
  readonly onInstallAppUpdate: () => Promise<void>;
  readonly onUpdateExtensions: (sources: readonly string[]) => Promise<void>;
}

export function SettingsView({
  workspace,
  runtime,
  section,
  notificationPreferences,
  notificationPermissionStatus,
  notificationPermissionPending,
  integratedTerminalShell,
  appLanguage,
  computerUseEnabled,
  platform,
  shortcutBindings,
  themeMode,
  themeId,
  customThemes,
  onSaveModel,
  onDeleteModel,
  onSetModelDefaults,
  onToggleSkillCommands,
  onSetComputerUseEnabled,
  onSetShortcutBindings,
  onSetNotificationPreferences,
  onSetIntegratedTerminalShell,
  onSetAppLanguage,
  onRequestNotificationPermission,
  onOpenSystemNotificationSettings,
  onSetThemeMode,
  onSetThemeId,
  onImportVSCodeTheme,
  onDeleteCustomTheme,
  onCheckForUpdates,
  onInstallAppUpdate,
  onUpdateExtensions,
}: SettingsViewProps) {
  const { t } = useTranslation();
  if (
    !workspace &&
    section !== "general" &&
    section !== "notifications" &&
    section !== "appearance" &&
    section !== "models"
  ) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">{t("common.settings")}</div>
          <h1>{t("settings.selectWorkspace")}</h1>
          <p>{t("settings.workspaceRequired")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="canvas">
      <div className="conversation settings-view">
        <header className="view-header">
          <div>
            <h1 className="view-header__title">{sectionTitle(section)}</h1>
            <p className="view-header__body">
              {sectionDescription(section)}
            </p>
          </div>
        </header>

        <div className="settings-grid">
          {section === "appearance" ? (
            <SettingsAppearanceSection
              themeMode={themeMode}
              themeId={themeId}
              customThemes={customThemes}
              onSetThemeMode={onSetThemeMode}
              onSetThemeId={onSetThemeId}
              onImportVSCodeTheme={onImportVSCodeTheme}
              onDeleteCustomTheme={onDeleteCustomTheme}
            />
          ) : null}

          {section === "general" ? (
            <SettingsGeneralSection
              runtime={runtime}
              integratedTerminalShell={integratedTerminalShell}
              appLanguage={appLanguage}
              computerUseEnabled={computerUseEnabled}
              platform={platform}
              shortcutBindings={shortcutBindings}
              onSetShortcutBindings={onSetShortcutBindings}
              onSetIntegratedTerminalShell={onSetIntegratedTerminalShell}
              onSetAppLanguage={onSetAppLanguage}
              onToggleSkillCommands={onToggleSkillCommands}
              onSetComputerUseEnabled={onSetComputerUseEnabled}
              onCheckForUpdates={onCheckForUpdates}
              onInstallAppUpdate={onInstallAppUpdate}
              onUpdateExtensions={onUpdateExtensions}
            />
          ) : null}

          {section === "models" ? (
            <SettingsModelsSection onSaveModel={onSaveModel} onDeleteModel={onDeleteModel} onSetDefaults={onSetModelDefaults} />
          ) : null}

          {section === "notifications" ? (
            <SettingsNotificationsSection
              notificationPreferences={notificationPreferences}
              notificationPermissionStatus={notificationPermissionStatus}
              notificationPermissionPending={notificationPermissionPending}
              onSetNotificationPreferences={onSetNotificationPreferences}
              onRequestNotificationPermission={onRequestNotificationPermission}
              onOpenSystemNotificationSettings={onOpenSystemNotificationSettings}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
