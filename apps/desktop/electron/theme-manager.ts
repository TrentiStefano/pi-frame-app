import { nativeTheme, type BrowserWindow } from "electron";
import { desktopIpc } from "../src/ipc";
import type { ThemeMode } from "../src/desktop-state";

export function getWindowsTitleBarOverlay(theme: "light" | "dark") {
  return {
    color: "#00000000",
    symbolColor: theme === "dark" ? "#a7a9b0" : "#62697a",
    height: 46,
  } as const;
}

export class ThemeManager {
  private mode: ThemeMode = "light";
  private readonly windows = new Set<BrowserWindow>();

  trackWindow(win: BrowserWindow) {
    if (win.isDestroyed() || this.windows.has(win)) {
      return;
    }
    this.windows.add(win);
    this.syncWindowChrome(win);
    win.once("closed", () => {
      this.windows.delete(win);
    });
  }

  getMode(): ThemeMode {
    return this.mode;
  }

  getResolvedTheme(): "light" | "dark" {
    return this.mode;
  }

  setMode(mode: ThemeMode) {
    this.mode = mode;
    nativeTheme.themeSource = mode;
    this.broadcast();
  }

  private broadcast() {
    for (const window of this.windows) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        this.syncWindowChrome(window);
        window.webContents.send(desktopIpc.themeChanged, this.getResolvedTheme());
      }
    }
  }

  private syncWindowChrome(window: BrowserWindow) {
    if (process.platform !== "win32" || window.isDestroyed()) {
      return;
    }

    window.setTitleBarOverlay(getWindowsTitleBarOverlay(this.getResolvedTheme()));
  }
}
