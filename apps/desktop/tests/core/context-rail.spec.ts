import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import { appendMessagesToSessionFile, sessionFilePathFromCatalog } from "../helpers/session-file";

const TURN_COUNT = 6;

test("keeps the conversation full-width without a prompt rail and uses a compact composer", async () => {
  test.setTimeout(120_000);
  const proofDir = process.env.PI_APP_CONVERSATION_LAYOUT_PROOF_DIR;
  if (proofDir) {
    await mkdir(proofDir, { recursive: true });
  }
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("conversation-layout-workspace");

  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  let workspaceId = "";
  let sessionId = "";
  try {
    const window = await firstRun.firstWindow();
    await createNamedThread(window, "Conversation layout session");
    const state = await getDesktopState(window);
    workspaceId = state.selectedWorkspaceId;
    sessionId = state.selectedSessionId;
  } finally {
    await firstRun.close();
  }

  const sessionFilePath = await sessionFilePathFromCatalog(userDataDir, { workspaceId, sessionId });
  const base = Date.now();
  const messages = [];
  for (let turn = 0; turn < TURN_COUNT; turn += 1) {
    const turnStart = base + turn * 60_000;
    messages.push({ role: "user" as const, text: `PROMPT ${turn} unique-marker-${turn}`, timestampMs: turnStart });
    messages.push({
      role: "assistant" as const,
      text: `Answer for turn ${turn}. ${"padding ".repeat(120)}`,
      timestampMs: turnStart + 8_000,
    });
  }
  await appendMessagesToSessionFile(sessionFilePath, messages);

  const run = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await run.firstWindow();
    await run.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1500, 950);
    });
    await waitForWorkspaceByPath(window, workspacePath);
    await expect(window.getByTestId("transcript")).toBeVisible({ timeout: 15_000 });

    await expect(window.getByTestId("timeline-context-rail")).toHaveCount(0);
    await expect(window.getByRole("button", { name: /prompt navigation/i })).toHaveCount(0);
    await expect(window.getByTestId("timeline-turn-marker").first()).toContainText("Worked for 8s", {
      timeout: 10_000,
    });

    const conversationBox = await window.locator(".conversation--thread").boundingBox();
    const paneBox = await window.getByTestId("timeline-pane").boundingBox();
    expect(conversationBox).not.toBeNull();
    expect(paneBox).not.toBeNull();
    expect(paneBox?.x).toBeCloseTo(conversationBox?.x ?? 0, 0);
    expect(paneBox?.width).toBeCloseTo(conversationBox?.width ?? 0, 0);

    const composer = window.locator(".composer");
    const surface = window.getByTestId("composer-surface");
    const textarea = window.getByTestId("composer");
    const compactLayout = await window.evaluate(() => {
      const composer = document.querySelector<HTMLElement>(".composer");
      const surface = document.querySelector<HTMLElement>("[data-testid='composer-surface']");
      const textarea = document.querySelector<HTMLElement>("[data-testid='composer']");
      const notice = document.querySelector<HTMLElement>(".model-onboarding-notice");
      return {
        composerHeight: composer?.getBoundingClientRect().height ?? 0,
        surfaceHeight: surface?.getBoundingClientRect().height ?? 0,
        textareaHeight: textarea?.getBoundingClientRect().height ?? 0,
        noticeHeight: notice?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(
      compactLayout.composerHeight - compactLayout.noticeHeight,
      `compact composer metrics: ${JSON.stringify(compactLayout)}`,
    ).toBeLessThanOrEqual(120);
    expect(
      compactLayout.surfaceHeight - compactLayout.noticeHeight,
      `compact composer metrics: ${JSON.stringify(compactLayout)}`,
    ).toBeLessThanOrEqual(95);

    if (proofDir) {
      await window.screenshot({ path: join(proofDir, "conversation-compact-composer.png"), fullPage: false });
    }

    await textarea.fill("line one\nline two\nline three\nline four\nline five\nline six");
    await expect.poll(async () => (await textarea.boundingBox())?.height ?? 0).toBeGreaterThan(compactLayout.textareaHeight + 60);
    await expect.poll(async () => (await surface.boundingBox())?.height ?? 0).toBeGreaterThan(compactLayout.surfaceHeight + 60);
    await expect(composer).toBeVisible();

    if (proofDir) {
      await window.screenshot({ path: join(proofDir, "conversation-multiline-composer.png"), fullPage: false });
    }
  } finally {
    await run.close();
  }
});
