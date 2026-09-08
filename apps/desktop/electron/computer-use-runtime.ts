import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import computerUseExtension from "./computer-use-bundle.mjs";

/**
 * Keep the Computer Use extension behind the app-level opt-in. The extension
 * owns its helper/browser processes and only runs its session lifecycle hooks
 * when it is actually installed into a Pi session.
 */
export function createComputerUseRuntimeExtension(isEnabled: () => boolean): ExtensionFactory {
  return (pi) => {
    // The upstream helper supports the three Electron desktop platforms.
    // Keep other platforms inert even when a shared ui-state file was copied.
    if (isEnabled() && (process.platform === "win32" || process.platform === "darwin" || process.platform === "linux")) {
      computerUseExtension(pi);
    }
  };
}
