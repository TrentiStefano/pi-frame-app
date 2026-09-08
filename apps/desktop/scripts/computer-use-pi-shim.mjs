import os from "node:os";
import path from "node:path";

export function defineTool(tool) {
  return tool;
}

export function getAgentDir() {
  const override = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!override) {
    return path.join(os.homedir(), ".pi", "agent");
  }
  if (override === "~") {
    return os.homedir();
  }
  if (override.startsWith("~/") || override.startsWith("~\\")) {
    return path.join(os.homedir(), override.slice(2));
  }
  return override;
}
