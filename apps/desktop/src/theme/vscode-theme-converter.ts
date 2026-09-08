import type { CustomTheme, ThemeCssVariables, ThemeKind, VSCodeThemeRaw } from "./types";

function pickColor(colors: Record<string, string>, keys: readonly string[], fallback: string): string {
  for (const key of keys) {
    const value = colors[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

export function parseVSCodeTheme(rawJson: string, customId?: string): CustomTheme {
  // Strip trailing commas / comments if JSON has comments (common in VS Code themes)
  const cleanedJson = rawJson
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "")
    .replace(/,\s*([}\]])/g, "$1");

  let parsed: VSCodeThemeRaw;
  try {
    parsed = JSON.parse(cleanedJson) as VSCodeThemeRaw;
  } catch (error) {
    throw new Error(`Invalid VS Code theme JSON format: ${error instanceof Error ? error.message : String(error)}`);
  }

  const name = parsed.name?.trim() || "Imported VS Code Theme";
  const kind: ThemeKind = parsed.type === "light" || parsed.type === "hcLight" ? "light" : "dark";
  const colors = parsed.colors ?? {};

  const isLight = kind === "light";

  const windowBg = pickColor(
    colors,
    ["editor.background", "sideBar.background", "activityBar.background"],
    isLight ? "#f4f5f8" : "#1a1b1e",
  );
  const sidebarBg = pickColor(
    colors,
    ["sideBar.background", "activityBar.background", "editor.background"],
    isLight ? "#eceef3" : "#202124",
  );
  const mainBg = pickColor(
    colors,
    ["editor.background", "panel.background"],
    isLight ? "#f8f8fb" : "#1e1f22",
  );
  const surfaceBg = pickColor(
    colors,
    ["editorWidget.background", "sideBarSectionHeader.background", "peekViewEditor.background"],
    isLight ? "#ffffff" : "#2b2d31",
  );
  const surfaceMutedBg = pickColor(
    colors,
    ["input.background", "dropdown.background", "list.hoverBackground"],
    isLight ? "#f1f3f7" : "#232428",
  );

  const lineBorder = pickColor(
    colors,
    ["sideBar.border", "panel.border", "editorGroup.border", "widget.border", "activityBar.border"],
    isLight ? "#dde1ea" : "#3a3c42",
  );
  const lineStrongBorder = pickColor(
    colors,
    ["focusBorder", "sideBarSectionHeader.border", "tab.activeBorder"],
    isLight ? "#c7ad7f" : "#4a4d55",
  );

  const textStrong = pickColor(
    colors,
    ["editor.foreground", "foreground", "sideBar.foreground"],
    isLight ? "#1f2638" : "#f4f4f5",
  );
  const textNormal = pickColor(
    colors,
    ["sideBar.foreground", "editor.foreground", "foreground"],
    isLight ? "#39435b" : "#d4d4d8",
  );
  const mutedText = pickColor(
    colors,
    ["descriptionForeground", "tab.inactiveForeground", "sideBarTitle.foreground"],
    isLight ? "#747d93" : "#8b8d94",
  );

  const accentColor = pickColor(
    colors,
    ["activityBarBadge.background", "focusBorder", "button.background", "statusBar.background"],
    isLight ? "#6a55f2" : "#7c6bf5",
  );
  const errorColor = pickColor(
    colors,
    ["errorForeground", "inputValidation.errorBackground"],
    isLight ? "#c45666" : "#e05467",
  );

  const buttonBg = pickColor(
    colors,
    ["button.background", "activityBarBadge.background", "focusBorder"],
    accentColor,
  );
  const buttonInk = pickColor(
    colors,
    ["button.foreground", "activityBarBadge.foreground"],
    "#ffffff",
  );

  const codeInlineBg = pickColor(
    colors,
    ["editor.lineHighlightBackground", "textBlockQuote.background"],
    isLight ? "#f2f4f8" : "rgba(255, 255, 255, 0.08)",
  );
  const codeBlockBg = pickColor(
    colors,
    ["editor.background", "terminal.background"],
    isLight ? "#eef2f8" : "rgba(0, 0, 0, 0.25)",
  );
  const codeInk = pickColor(
    colors,
    ["editor.foreground", "terminal.foreground"],
    textStrong,
  );
  const codeBorder = pickColor(
    colors,
    ["editorGroup.border", "sideBar.border"],
    lineBorder,
  );

  const cssVariables: ThemeCssVariables = {
    window: windowBg,
    sidebar: sidebarBg,
    main: mainBg,
    surface: surfaceBg,
    surfaceMuted: surfaceMutedBg,
    line: lineBorder,
    lineStrong: lineStrongBorder,
    text: textNormal,
    textStrong,
    muted: mutedText,
    accent: accentColor,
    error: errorColor,
    buttonPrimaryBg: buttonBg,
    buttonPrimaryInk: buttonInk,
    codeInlineBg,
    codeBlockBg,
    codeInk,
    codeBorder,
  };

  const generatedId = customId || `vscode-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;

  return {
    id: generatedId,
    name,
    kind,
    isBuiltin: false,
    colors,
    cssVariables,
    rawJson,
  };
}
