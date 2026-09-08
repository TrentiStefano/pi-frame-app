import { Moon, Sun, Download, Trash2, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ThemeMode } from "./desktop-state";
import type { CustomTheme } from "./theme/types";
import { BUILTIN_THEMES } from "./theme/builtin-themes";
import { SettingsGroup, SettingsRow } from "./settings-utils";

interface SettingsAppearanceSectionProps {
  readonly themeMode: ThemeMode;
  readonly themeId: string;
  readonly customThemes: readonly CustomTheme[];
  readonly onSetThemeMode: (mode: ThemeMode) => void;
  readonly onSetThemeId: (themeId: string) => void;
  readonly onImportVSCodeTheme: () => void;
  readonly onDeleteCustomTheme: (themeId: string) => void;
}

export function SettingsAppearanceSection({
  themeMode,
  themeId,
  customThemes,
  onSetThemeMode,
  onSetThemeId,
  onImportVSCodeTheme,
  onDeleteCustomTheme,
}: SettingsAppearanceSectionProps) {
  const { t } = useTranslation();

  const allThemes = [...BUILTIN_THEMES, ...customThemes];
  const activeThemeId = themeId || themeMode;

  return (
    <SettingsGroup>
      <SettingsRow title={t("settings.colorMode", "Color Mode")} description={t("settings.colorModeDescription", "Choose your preferred appearance mode")}>
        <div aria-label={t("settings.colorMode", "Color mode")} className="theme-mode-control" role="group">
          <button
            aria-pressed={themeMode === "light"}
            className={`theme-mode-option${themeMode === "light" ? " theme-mode-option--active" : ""}`}
            type="button"
            onClick={() => {
              onSetThemeMode("light");
              onSetThemeId("light");
            }}
          >
            <Sun aria-hidden size={15} strokeWidth={1.8} />
            <span>{t("common.light", "Light")}</span>
          </button>
          <button
            aria-pressed={themeMode === "dark"}
            className={`theme-mode-option${themeMode === "dark" ? " theme-mode-option--active" : ""}`}
            type="button"
            onClick={() => {
              onSetThemeMode("dark");
              onSetThemeId("dark");
            }}
          >
            <Moon aria-hidden size={15} strokeWidth={1.8} />
            <span>{t("common.dark", "Dark")}</span>
          </button>
        </div>
      </SettingsRow>

      <SettingsRow
        title="Theme Preset & Custom Themes"
        description="Select a built-in theme preset or import any VS Code JSON theme file"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {allThemes.map((theme) => {
              const isActive = activeThemeId === theme.id;
              const isCustom = !theme.isBuiltin;
              return (
                <div
                  key={theme.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border: isActive ? "2px solid var(--accent)" : "1px solid var(--line)",
                    background: isActive ? "var(--accent-tint-bg)" : "var(--surface)",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: isActive ? 600 : 400,
                  }}
                  onClick={() => onSetThemeId(theme.id)}
                >
                  <Palette size={14} style={{ color: theme.cssVariables.accent || "var(--accent)" }} />
                  <span>{theme.name}</span>
                  {isCustom && (
                    <button
                      type="button"
                      title="Remove custom theme"
                      style={{
                        background: "none",
                        border: "none",
                        padding: "2px",
                        marginLeft: "4px",
                        cursor: "pointer",
                        color: "var(--muted)",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteCustomTheme(theme.id);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ paddingTop: "4px" }}>
            <button
              type="button"
              className="button button--ghost"
              style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
              onClick={onImportVSCodeTheme}
            >
              <Download size={15} />
              <span>Import VS Code Theme (.json)</span>
            </button>
          </div>
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}
