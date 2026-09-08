import type { ReactNode } from "react";
import type { RuntimeSettingsSnapshot } from "@pi-frame/session-driver/runtime-types";
import { i18n } from "./i18n/renderer";

export type SettingsSection = "appearance" | "general" | "models" | "notifications";

export const THINKING_LEVELS: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function settingsPill(active: boolean): string {
  return `settings-pill${active ? " settings-pill--active" : ""}`;
}

export function labelForThinking(level: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>): string {
  if (level === "xhigh") {
    return "Extra High";
  }
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function sectionTitle(section: SettingsSection): string {
  const t = i18n.t.bind(i18n);
  switch (section) {
    case "appearance":
      return t("common.appearance");
    case "models":
      return t("common.models");
    case "notifications":
      return t("common.notifications");
    default:
      return t("common.general");
  }
}

export function sectionDescription(section: SettingsSection): string {
  const t = i18n.t.bind(i18n);
  switch (section) {
    case "appearance":
      return t("settings.descriptions.appearance");
    case "models":
      return t("settings.descriptions.models");
    case "notifications":
      return t("settings.descriptions.notifications");
    default:
      return t("settings.descriptions.general");
  }
}

/* ── Layout components ────────────────────────────────── */

export function SettingsGroup({
  title,
  description,
  children,
}: {
  readonly title?: string;
  readonly description?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="settings-section">
      {title ? <h3 className="settings-section__title">{title}</h3> : null}
      {description ? <p className="settings-section__description">{description}</p> : null}
      <div className="settings-group">{children}</div>
    </div>
  );
}

export function SettingsRow({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        <div className="settings-row__title">{title}</div>
        {description ? <div className="settings-row__description">{description}</div> : null}
      </div>
      {children ? <div className="settings-row__control">{children}</div> : null}
    </div>
  );
}

export function SettingsInfoRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        <div className="settings-row__title">{label}</div>
      </div>
      <div className="settings-row__control">
        <span className="settings-row__value">{value}</span>
      </div>
    </div>
  );
}
