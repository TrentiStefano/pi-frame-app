import type { CustomTheme } from "./types";

export function applyThemeToDocument(theme: CustomTheme): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;

  // Toggle class for light vs dark mode
  root.classList.toggle("dark", theme.kind === "dark");
  root.style.colorScheme = theme.kind;

  const vars = theme.cssVariables;

  if (vars.window) root.style.setProperty("--window", vars.window);
  if (vars.sidebar) root.style.setProperty("--sidebar", vars.sidebar);
  if (vars.main) root.style.setProperty("--main", vars.main);
  if (vars.surface) root.style.setProperty("--surface", vars.surface);
  if (vars.surfaceMuted) root.style.setProperty("--surface-muted", vars.surfaceMuted);
  if (vars.line) root.style.setProperty("--line", vars.line);
  if (vars.lineStrong) root.style.setProperty("--line-strong", vars.lineStrong);
  if (vars.text) root.style.setProperty("--text", vars.text);
  if (vars.textStrong) root.style.setProperty("--text-strong", vars.textStrong);
  if (vars.muted) root.style.setProperty("--muted", vars.muted);
  if (vars.accent) root.style.setProperty("--accent", vars.accent);
  if (vars.error) root.style.setProperty("--error", vars.error);
  if (vars.buttonPrimaryBg) root.style.setProperty("--button-primary-bg", vars.buttonPrimaryBg);
  if (vars.buttonPrimaryInk) root.style.setProperty("--button-primary-ink", vars.buttonPrimaryInk);
  if (vars.codeInlineBg) root.style.setProperty("--code-inline-bg", vars.codeInlineBg);
  if (vars.codeBlockBg) root.style.setProperty("--code-block-bg", vars.codeBlockBg);
  if (vars.codeInk) root.style.setProperty("--code-ink", vars.codeInk);
  if (vars.codeBorder) root.style.setProperty("--code-border", vars.codeBorder);
}

/** Alias used by App.tsx */
export const injectTheme = applyThemeToDocument;
