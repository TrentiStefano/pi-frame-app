export type ThemeKind = "light" | "dark";

export interface VSCodeTokenColor {
  readonly name?: string;
  readonly scope?: string | readonly string[];
  readonly settings: {
    readonly foreground?: string;
    readonly background?: string;
    readonly fontStyle?: string;
  };
}

export interface VSCodeThemeRaw {
  readonly name?: string;
  readonly type?: string;
  readonly colors?: Record<string, string>;
  readonly tokenColors?: readonly VSCodeTokenColor[];
  readonly semanticHighlighting?: boolean;
}

export interface ThemeCssVariables {
  readonly window: string;
  readonly sidebar: string;
  readonly main: string;
  readonly surface: string;
  readonly surfaceMuted: string;
  readonly line: string;
  readonly lineStrong: string;
  readonly text: string;
  readonly textStrong: string;
  readonly muted: string;
  readonly accent: string;
  readonly error: string;
  readonly buttonPrimaryBg: string;
  readonly buttonPrimaryInk: string;
  readonly codeInlineBg: string;
  readonly codeBlockBg: string;
  readonly codeInk: string;
  readonly codeBorder: string;
}

export interface CustomTheme {
  readonly id: string;
  readonly name: string;
  readonly kind: ThemeKind;
  readonly isBuiltin?: boolean;
  readonly colors: Record<string, string>;
  readonly cssVariables: ThemeCssVariables;
  readonly rawJson?: string;
}
