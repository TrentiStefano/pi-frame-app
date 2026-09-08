import { expect, test, type Page } from "@playwright/test";
import type { SessionDriverEvent, SessionRef } from "@pi-frame/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

async function selectedSessionRef(window: Page): Promise<SessionRef> {
  const state = await getDesktopState(window);
  if (!state.selectedWorkspaceId || !state.selectedSessionId) {
    throw new Error("Expected a selected session");
  }
  return { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
}

async function emitAssistantDeltaBurst(
  harness: Awaited<ReturnType<typeof launchDesktop>>,
  sessionRef: SessionRef,
  chunks: readonly string[],
): Promise<void> {
  const runId = `burst-${Date.now()}`;
  const events: SessionDriverEvent[] = chunks.map((text, index) => ({
    type: "assistantDelta",
    sessionRef,
    timestamp: new Date(Date.now() + index).toISOString(),
    runId,
    text,
  }));
  await harness.electronApp.evaluate(async (_, payload) => {
    const hooks = (globalThis as {
      __PI_APP_TEST_HOOKS?: {
        emitSessionEvent?: (event: SessionDriverEvent) => Promise<void>;
      };
    }).__PI_APP_TEST_HOOKS;
    if (!hooks?.emitSessionEvent) {
      throw new Error("Test session-event hook is unavailable");
    }
    await Promise.all(payload.map((event) => hooks.emitSessionEvent?.(event)));
  }, events);
}

test("coalesces a burst of assistant deltas into bounded transcript updates", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("stream-coalescing-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Streaming performance");
    const sessionRef = await selectedSessionRef(window);
    await window.evaluate(() => {
      const transcript = document.querySelector('[data-testid="transcript"]');
      if (!transcript) {
        throw new Error("Transcript is unavailable");
      }
      (globalThis as typeof globalThis & { __transcriptMutationCount?: number }).__transcriptMutationCount = 0;
      new MutationObserver((records) => {
        const target = globalThis as typeof globalThis & { __transcriptMutationCount?: number };
        target.__transcriptMutationCount = (target.__transcriptMutationCount ?? 0) + records.length;
      }).observe(transcript, { characterData: true, childList: true, subtree: true });
    });

    const chunks = Array.from({ length: 120 }, (_, index) => `burst-${index} `);
    await emitAssistantDeltaBurst(harness, sessionRef, chunks);
    const fullText = chunks.join("");
    await expect(window.getByTestId("transcript")).toContainText(fullText);
    await window.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    const mutationCount = await window.evaluate(
      () => (globalThis as typeof globalThis & { __transcriptMutationCount?: number }).__transcriptMutationCount ?? 0,
    );
    expect(mutationCount).toBeGreaterThan(0);
    expect(mutationCount).toBeLessThan(30);
  } finally {
    await harness.close();
  }
});

test("groups consecutive tool calls into a collapsed expandable activity row", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("tool-group-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Grouped tools");
    const sessionRef = await selectedSessionRef(window);

    for (let index = 0; index < 3; index += 1) {
      const callId = `grouped-tool-${index}`;
      const timestamp = new Date(Date.now() + index * 1_000).toISOString();
      const started: Extract<SessionDriverEvent, { type: "toolStarted" }> = {
        type: "toolStarted",
        sessionRef,
        timestamp,
        toolName: "bash",
        callId,
        input: { command: `printf tool-${index}` },
      };
      await emitTestSessionEvent(harness, started);
      const finished: Extract<SessionDriverEvent, { type: "toolFinished" }> = {
        type: "toolFinished",
        sessionRef,
        timestamp,
        callId,
        success: true,
        output: `tool-${index}`,
      };
      await emitTestSessionEvent(harness, finished);
    }

    const group = window.locator(".timeline-tool-group");
    await expect(group).toHaveCount(1);
    const groupHeader = group.locator(".timeline-tool-group__header");
    await expect(groupHeader).toHaveAttribute("aria-expanded", "false");
    await expect(groupHeader).toContainText("3 tool calls");
    await expect(group.locator(".timeline-tool")).toHaveCount(0);

    await groupHeader.click();
    await expect(groupHeader).toHaveAttribute("aria-expanded", "true");
    await expect(group.locator(".timeline-tool")).toHaveCount(3);
    await expect(group.locator(".timeline-tool__body")).toHaveCount(0);

    const firstToolHeader = group.locator(".timeline-tool__header").first();
    await firstToolHeader.click();
    await expect(firstToolHeader).toHaveAttribute("aria-expanded", "true");
    await expect(group.locator(".timeline-tool__body")).toHaveCount(1);
    await expect(group.locator(".timeline-tool__pre")).toContainText("printf tool-0");
  } finally {
    await harness.close();
  }
});
