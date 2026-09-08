import { useEffect, useState } from "react";
import type { RuntimeSnapshot } from "@pi-frame/session-driver/runtime-types";
import { SettingsGroup, SettingsRow } from "./settings-utils";
import type { AppLanguage } from "./desktop-state";
import type { SoftwareUpdateSnapshot } from "./ipc";
import { useTranslation } from "react-i18next";
import { Download, RefreshCw, RotateCcw } from "lucide-react";
import {
  defaultShortcutBindings,
  editableShortcutActions,
  formatShortcut,
  shortcutFromKeyboardEvent,
  type EditableShortcutAction,
  type ShortcutBindings,
} from "./keyboard-shortcuts";

interface SettingsGeneralSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly integratedTerminalShell: string;
  readonly appLanguage: AppLanguage;
  readonly computerUseEnabled: boolean;
  readonly platform: NodeJS.Platform;
  readonly shortcutBindings: ShortcutBindings;
  readonly onSetShortcutBindings: (bindings: ShortcutBindings) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onSetAppLanguage: (language: AppLanguage) => void;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
  readonly onSetComputerUseEnabled: (enabled: boolean) => void;
  readonly onCheckForUpdates: () => Promise<SoftwareUpdateSnapshot>;
  readonly onInstallAppUpdate: () => Promise<void>;
  readonly onUpdateExtensions: (sources: readonly string[]) => Promise<void>;
}

export function SettingsGeneralSection({
  runtime,
  integratedTerminalShell,
  appLanguage,
  computerUseEnabled,
  platform,
  shortcutBindings,
  onSetShortcutBindings,
  onSetIntegratedTerminalShell,
  onSetAppLanguage,
  onToggleSkillCommands,
  onSetComputerUseEnabled,
  onCheckForUpdates,
  onInstallAppUpdate,
  onUpdateExtensions,
}: SettingsGeneralSectionProps) {
  const { t } = useTranslation();
  const [terminalShellDraft, setTerminalShellDraft] = useState(integratedTerminalShell);
  const [updates, setUpdates] = useState<SoftwareUpdateSnapshot>();
  const [updateAction, setUpdateAction] = useState<"checking" | "app" | "extensions">();
  const [updateMessage, setUpdateMessage] = useState<string>();

  useEffect(() => {
    setTerminalShellDraft(integratedTerminalShell);
  }, [integratedTerminalShell]);

  const commitTerminalShellDraft = () => {
    if (terminalShellDraft !== integratedTerminalShell) {
      onSetIntegratedTerminalShell(terminalShellDraft);
    }
  };

  const checkForUpdates = async () => {
    setUpdateAction("checking");
    setUpdateMessage(undefined);
    try {
      setUpdates(await onCheckForUpdates());
    } catch (error) {
      setUpdateMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdateAction(undefined);
    }
  };

  const updateInstalledExtensions = async () => {
    if (!updates?.extensions.length) return;
    setUpdateAction("extensions");
    setUpdateMessage(undefined);
    try {
      await onUpdateExtensions(updates.extensions.map((extension) => extension.source));
      setUpdates(await onCheckForUpdates());
      setUpdateMessage(t("settings.extensionsUpdated"));
    } catch (error) {
      setUpdateMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdateAction(undefined);
    }
  };

  return (
    <>
      <SettingsGroup title={t("common.general")}>
        <SettingsRow title={t("settings.language")} description={t("settings.languageDescription")}>
          <select
            aria-label={t("settings.language")}
            className="settings-select"
            value={appLanguage}
            onChange={(event) => onSetAppLanguage(event.target.value as AppLanguage)}
          >
            <option value="en">{t("settings.english")}</option>
            <option value="zh-CN">{t("settings.simplifiedChinese")}</option>
          </select>
        </SettingsRow>
        <SettingsRow title={t("settings.skillCommands")} description={t("settings.skillCommandsDescription")}>
          <input
            aria-label={t("settings.skillCommands")}
            checked={runtime?.settings.enableSkillCommands ?? true}
            type="checkbox"
            onChange={(event) => onToggleSkillCommands(event.target.checked)}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.computerUse")} description={t("settings.computerUseDescription")}>
          <input
            aria-label={t("settings.computerUse")}
            checked={computerUseEnabled}
            data-testid="settings-computer-use-enabled"
            type="checkbox"
            onChange={(event) => onSetComputerUseEnabled(event.target.checked)}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.terminalShell")} description={t("settings.terminalShellDescription")}>
          <input
            aria-label={t("settings.terminalShell")}
            className="settings-text-input"
            placeholder="/bin/zsh"
            spellCheck={false}
            type="text"
            value={terminalShellDraft}
            onBlur={commitTerminalShellDraft}
            onChange={(event) => setTerminalShellDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.updates")}>
        <SettingsRow
          title={t("settings.appAndPi")}
          description={updates
            ? t("settings.appAndPiVersions", {
                appVersion: updates.app.currentVersion,
                piVersion: updates.pi.currentVersion,
                latestPiVersion: updates.pi.latestVersion ?? t("common.unknown"),
              })
            : t("settings.updatesNotChecked")}
        >
          <div className="settings-row__actions">
            {updates?.app.updateAvailable && updates.app.canInstall ? (
              <button
                className="button button--primary"
                disabled={Boolean(updateAction)}
                type="button"
                onClick={() => {
                  setUpdateAction("app");
                  void onInstallAppUpdate().catch((error: unknown) => {
                    setUpdateMessage(error instanceof Error ? error.message : String(error));
                    setUpdateAction(undefined);
                  });
                }}
              >
                <Download aria-hidden="true" size={14} />
                {t("settings.updateAppAndPi")}
              </button>
            ) : null}
            <button
              className="button button--secondary"
              disabled={Boolean(updateAction)}
              type="button"
              onClick={() => void checkForUpdates()}
            >
              <RefreshCw aria-hidden="true" size={14} />
              {updateAction === "checking" ? t("settings.checkingUpdates") : t("settings.checkForUpdates")}
            </button>
          </div>
        </SettingsRow>
        <SettingsRow
          title={t("settings.extensionUpdates")}
          description={updates
            ? updates.extensionError
              ? t("settings.extensionUpdateCheckFailed", { error: updates.extensionError })
              : updates.extensions.length > 0
              ? t("settings.extensionUpdatesAvailable", { count: updates.extensions.length })
              : t("settings.extensionsCurrent")
            : t("settings.extensionUpdatesDescription")}
        >
          {updates?.extensions.length ? (
            <button
              className="button button--secondary"
              disabled={Boolean(updateAction)}
              type="button"
              onClick={() => void updateInstalledExtensions()}
            >
              <Download aria-hidden="true" size={14} />
              {updateAction === "extensions" ? t("settings.updatingExtensions") : t("settings.updateExtensions")}
            </button>
          ) : null}
        </SettingsRow>
        {updates?.pi.updateAvailable && !updates.app.updateAvailable ? (
          <div className="settings-update-note">{t("settings.piUpdateRequiresAppRelease")}</div>
        ) : null}
        {updates?.app.checkError ? (
          <div className="settings-update-note" role="status">
            {t(updates.app.checkError === "release-metadata-unavailable"
              ? "settings.appUpdateMetadataUnavailable"
              : "settings.appUpdateCheckFailed")}
          </div>
        ) : null}
        {updateMessage ? <div className="settings-update-note" role="status">{updateMessage}</div> : null}
      </SettingsGroup>

      <SettingsGroup title={t("settings.shortcuts")}>
        <ShortcutEditor
          bindings={shortcutBindings}
          platform={platform}
          onChange={onSetShortcutBindings}
        />
      </SettingsGroup>
    </>
  );
}

function ShortcutEditor({
  bindings,
  platform,
  onChange,
}: {
  readonly bindings: ShortcutBindings;
  readonly platform: NodeJS.Platform;
  readonly onChange: (bindings: ShortcutBindings) => void;
}) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState<EditableShortcutAction>();
  const [conflict, setConflict] = useState<EditableShortcutAction>();
  const labels: Record<EditableShortcutAction, string> = {
    newThread: t("common.newThread"),
    openSettings: t("settings.openSettings"),
    toggleTerminal: t("settings.toggleTerminal"),
    toggleBrowser: t("settings.toggleBrowser"),
    newTerminalTab: t("settings.newTerminalTab"),
    sendMessage: t("settings.sendMessage"),
    newLine: t("settings.newLine"),
  };

  const updateBinding = (action: EditableShortcutAction, binding: string) => {
    const duplicate = editableShortcutActions.find(
      (candidate) => candidate !== action && bindings[candidate] === binding,
    );
    if (duplicate) {
      setConflict(action);
      return;
    }
    setConflict(undefined);
    setRecording(undefined);
    onChange({ ...bindings, [action]: binding });
  };

  return editableShortcutActions.map((action) => {
    const isRecording = recording === action;
    const isDefault = bindings[action] === defaultShortcutBindings[action];
    return (
      <SettingsRow
        key={action}
        title={labels[action]}
        description={conflict === action ? t("settings.shortcutConflict") : undefined}
      >
        <div className="settings-shortcut-control">
          <button
            aria-label={t("settings.changeShortcut", { action: labels[action] })}
            aria-pressed={isRecording}
            className={`settings-shortcut-key${isRecording ? " settings-shortcut-key--recording" : ""}`}
            data-testid={`shortcut-${action}`}
            type="button"
            onClick={() => {
              setConflict(undefined);
              setRecording(action);
            }}
            onKeyDown={(event) => {
              if (!isRecording) return;
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Escape") {
                setRecording(undefined);
                return;
              }
              const next = shortcutFromKeyboardEvent(event, platform);
              if (next) updateBinding(action, next);
            }}
          >
            {isRecording ? t("settings.recordingShortcut") : formatShortcut(bindings[action], platform)}
          </button>
          <button
            aria-label={t("settings.resetShortcut", { action: labels[action] })}
            className="icon-button settings-shortcut-reset"
            disabled={isDefault}
            title={t("settings.resetShortcut", { action: labels[action] })}
            type="button"
            onClick={() => updateBinding(action, defaultShortcutBindings[action])}
          >
            <RotateCcw aria-hidden="true" size={14} />
          </button>
        </div>
      </SettingsRow>
    );
  });
}
