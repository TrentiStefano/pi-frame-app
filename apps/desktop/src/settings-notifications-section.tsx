import type { DesktopNotificationPermissionStatus } from "./ipc";
import type { NotificationPreferences } from "./desktop-state";
import { SettingsGroup, SettingsRow } from "./settings-utils";
import { useTranslation } from "react-i18next";

interface SettingsNotificationsSectionProps {
  readonly notificationPreferences: NotificationPreferences;
  readonly notificationPermissionStatus: DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
}

export function SettingsNotificationsSection({
  notificationPreferences,
  notificationPermissionStatus,
  notificationPermissionPending,
  onSetNotificationPreferences,
  onRequestNotificationPermission,
  onOpenSystemNotificationSettings,
}: SettingsNotificationsSectionProps) {
  const { t } = useTranslation();
  const statusLabel = labelForPermissionStatus(notificationPermissionStatus, t);
  const statusDescription = descriptionForPermissionStatus(notificationPermissionStatus, t);
  const showAskSystem = notificationPermissionStatus === "default";
  const isSystemManaged = notificationPermissionStatus === "system-managed";
  const showOpenSystemSettings = notificationPermissionStatus === "denied" || isSystemManaged;
  const showRecoveryActions = showAskSystem || showOpenSystemSettings;
  const recoveryTitle = isSystemManaged
    ? t("settings.windowsNotificationSettings")
    : t("settings.turnOnNotifications");
  const recoveryDescription = showAskSystem
    ? t("settings.askSystemDescription")
    : isSystemManaged
      ? t("settings.windowsSystemDescription")
      : t("settings.deniedSystemDescription");
  const openSettingsLabel = isSystemManaged
    ? t("settings.openWindowsNotificationSettings")
    : t("settings.openSystemSettings");

  return (
    <>
      <SettingsGroup title={t("settings.notificationSystem")} description={t("settings.notificationSystemDescription")}>
        <SettingsRow title={t("settings.notificationAccess")} description={statusDescription}>
          <span className="settings-row__value">{statusLabel}</span>
        </SettingsRow>
        {showRecoveryActions ? (
          <SettingsRow
            title={recoveryTitle}
            description={recoveryDescription}
          >
            <div className="settings-row__actions">
              {showAskSystem ? (
                <button
                  className="button button--secondary"
                  disabled={notificationPermissionPending}
                  type="button"
                  onClick={onRequestNotificationPermission}
                >
                  {t("settings.askSystem")}
                </button>
              ) : null}
              {showOpenSystemSettings ? (
                <button
                  className="button button--secondary"
                  disabled={notificationPermissionPending}
                  type="button"
                  onClick={onOpenSystemNotificationSettings}
                >
                  {openSettingsLabel}
                </button>
              ) : null}
            </div>
          </SettingsRow>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title={t("settings.inAppAlerts")} description={t("settings.inAppAlertsDescription")}>
        <SettingsRow title={t("settings.backgroundCompletion")} description={t("settings.backgroundCompletionDescription")}>
          <input
            aria-label={t("settings.backgroundCompletion")}
            checked={notificationPreferences.backgroundCompletion}
            type="checkbox"
            onChange={(event) => onSetNotificationPreferences({ backgroundCompletion: event.target.checked })}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.backgroundFailures")} description={t("settings.backgroundFailuresDescription")}>
          <input
            aria-label={t("settings.backgroundFailures")}
            checked={notificationPreferences.backgroundFailure}
            type="checkbox"
            onChange={(event) => onSetNotificationPreferences({ backgroundFailure: event.target.checked })}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.needsInput")} description={t("settings.needsInputDescription")}>
          <input
            aria-label={t("settings.needsInput")}
            checked={notificationPreferences.attentionNeeded}
            type="checkbox"
            onChange={(event) => onSetNotificationPreferences({ attentionNeeded: event.target.checked })}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function labelForPermissionStatus(status: DesktopNotificationPermissionStatus, t: (key: string) => string): string {
  switch (status) {
    case "granted":
      return t("settings.permissionEnabled");
    case "denied":
      return t("settings.permissionTurnedOff");
    case "default":
      return t("settings.permissionNotEnabled");
    case "system-managed":
      return t("settings.permissionManagedByWindows");
    case "unsupported":
      return t("settings.permissionUnavailable");
    default:
      return t("settings.permissionChecking");
  }
}

function descriptionForPermissionStatus(status: DesktopNotificationPermissionStatus, t: (key: string) => string): string {
  switch (status) {
    case "granted":
      return t("settings.permissionGrantedDescription");
    case "denied":
      return t("settings.permissionDeniedDescription");
    case "default":
      return t("settings.permissionDefaultDescription");
    case "system-managed":
      return t("settings.permissionManagedByWindowsDescription");
    case "unsupported":
      return t("settings.permissionUnsupportedDescription");
    default:
      return t("settings.permissionUnknownDescription");
  }
}
