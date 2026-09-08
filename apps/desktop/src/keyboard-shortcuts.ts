export const editableShortcutActions = [
  "newThread",
  "openSettings",
  "toggleTerminal",
  "toggleBrowser",
  "newTerminalTab",
  "sendMessage",
  "newLine",
] as const;

export type EditableShortcutAction = (typeof editableShortcutActions)[number];
export type ShortcutAction = EditableShortcutAction | "toggleSidebar";
export type ShortcutBindings = Readonly<Record<ShortcutAction, string>>;

export const defaultShortcutBindings: ShortcutBindings = {
  newThread: "Mod+Shift+O",
  openSettings: "Mod+Comma",
  toggleTerminal: "Mod+J",
  toggleBrowser: "Mod+Shift+B",
  newTerminalTab: "Mod+T",
  sendMessage: "Enter",
  newLine: "Shift+Enter",
  toggleSidebar: "Mod+B",
};

interface ShortcutEvent {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export function normalizeShortcutBindings(value: unknown): ShortcutBindings {
  if (!value || typeof value !== "object") {
    return defaultShortcutBindings;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(defaultShortcutBindings).map(([action, fallback]) => {
      const binding = record[action];
      return [action, typeof binding === "string" && parseShortcut(binding) ? binding : fallback];
    }),
  ) as unknown as ShortcutBindings;
}

export function shortcutFromKeyboardEvent(event: ShortcutEvent, platform: NodeJS.Platform): string | undefined {
  const key = normalizedEventKey(event);
  if (!key || ["Control", "Meta", "Alt", "Shift"].includes(key)) {
    return undefined;
  }
  const parts: string[] = [];
  const primaryDown = platform === "darwin" ? event.metaKey : event.ctrlKey;
  if (primaryDown) parts.push("Mod");
  if (event.ctrlKey && platform === "darwin") parts.push("Ctrl");
  if (event.metaKey && platform !== "darwin") parts.push("Meta");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

export function shortcutMatches(
  event: ShortcutEvent,
  binding: string,
  platform: NodeJS.Platform,
): boolean {
  const parsed = parseShortcut(binding);
  if (!parsed) return false;
  const primaryDown = platform === "darwin" ? event.metaKey : event.ctrlKey;
  const secondaryCtrl = platform === "darwin" && event.ctrlKey;
  const secondaryMeta = platform !== "darwin" && event.metaKey;
  return parsed.mod === primaryDown
    && parsed.ctrl === secondaryCtrl
    && parsed.meta === secondaryMeta
    && parsed.alt === event.altKey
    && parsed.shift === event.shiftKey
    && parsed.key === normalizedEventKey(event);
}

export function formatShortcut(binding: string, platform: NodeJS.Platform): string {
  const parsed = parseShortcut(binding);
  if (!parsed) return binding;
  const parts: string[] = [];
  if (parsed.mod) parts.push(platform === "darwin" ? "Cmd" : "Ctrl");
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.meta) parts.push(platform === "darwin" ? "Cmd" : "Win");
  if (parsed.alt) parts.push(platform === "darwin" ? "Option" : "Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(parsed.key === "Comma" ? "," : parsed.key === "Space" ? "Space" : parsed.key);
  return parts.join("+");
}

export function insertTextAtSelection(element: HTMLTextAreaElement, value: string, text: string) {
  const start = element.selectionStart;
  const end = element.selectionEnd;
  return {
    value: `${value.slice(0, start)}${text}${value.slice(end)}`,
    cursor: start + text.length,
  };
}

function parseShortcut(binding: string) {
  const parts = binding.split("+").filter(Boolean);
  const key = parts.at(-1);
  if (!key) return undefined;
  const modifiers = new Set(parts.slice(0, -1));
  if ([...modifiers].some((part) => !["Mod", "Ctrl", "Meta", "Alt", "Shift"].includes(part))) {
    return undefined;
  }
  return {
    mod: modifiers.has("Mod"),
    ctrl: modifiers.has("Ctrl"),
    meta: modifiers.has("Meta"),
    alt: modifiers.has("Alt"),
    shift: modifiers.has("Shift"),
    key,
  };
}

function normalizedEventKey(event: Pick<ShortcutEvent, "key" | "code">): string | undefined {
  if (event.code === "Comma" || event.key === ",") return "Comma";
  if (event.code === "Space" || event.key === " ") return "Space";
  if (event.key === "Escape") return "Escape";
  if (event.key === "Enter") return "Enter";
  if (event.key === "Backspace") return "Backspace";
  if (event.key === "Delete") return "Delete";
  if (event.key === "Tab") return "Tab";
  if (event.key.startsWith("Arrow")) return event.key;
  if (/^F\d{1,2}$/.test(event.key)) return event.key;
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key || undefined;
}
