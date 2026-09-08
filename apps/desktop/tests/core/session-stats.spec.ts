import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";
import {
  appendMessagesToSessionFile,
  sessionFilePathFromCatalog,
} from "../helpers/session-file";

test("displays session statistics in chat header with cost, tokens, and context window", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("stats-workspace");

  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await firstRun.firstWindow();
    await createNamedThread(window, "Stats test thread");

    // Initially, stats bar exists
    const statsBar = window.getByTestId("chat-header-stats");
    await expect(statsBar).toBeVisible();

    const state = await getDesktopState(window);
    const selectedWorkspace = state.workspaces.find((w) => w.id === state.selectedWorkspaceId);
    const selectedSession = selectedWorkspace?.sessions.find((s) => s.id === state.selectedSessionId);
    expect(selectedWorkspace).toBeDefined();
    expect(selectedSession).toBeDefined();

    const sessionFilePath = await sessionFilePathFromCatalog(userDataDir, {
      workspaceId: selectedWorkspace!.id,
      sessionId: selectedSession!.id,
    });

    // Seed messages with token usage and cost, including a thinking block
    await appendMessagesToSessionFile(sessionFilePath, [
      {
        role: "user",
        text: "Calculate something complex",
      },
      {
        role: "assistant",
        text: "<think>\nThinking through the mathematical proof step by step.\n</think>\nHere is the calculation result.",
        usage: {
          input: 12000,
          output: 2500,
          cacheRead: 4000,
          cacheWrite: 0,
          totalTokens: 18500,
          cost: {
            input: 0.036,
            output: 0.0375,
            cacheRead: 0.004,
            total: 0.0775,
          },
        },
      },
    ]);
  } finally {
    await firstRun.close();
  }

  // Relaunch to inspect loaded transcript stats
  const secondRun = await launchDesktop(userDataDir, {
    testMode: "background",
  });

  try {
    const window = await secondRun.firstWindow();
    const statsBar = window.getByTestId("chat-header-stats");
    await expect(statsBar).toBeVisible();

    const costPill = window.getByTestId("stats-cost");
    await expect(costPill).toBeVisible();
    await expect(costPill).toContainText("$0.08"); // $0.0775 rounded to $0.08

    const tokensPill = window.getByTestId("stats-tokens");
    await expect(tokensPill).toBeVisible();
    await expect(tokensPill).toContainText("18.5k");

    const contextPill = window.getByTestId("stats-context");
    await expect(contextPill).toBeVisible();
    // Context tokens = 12000 (input) + 4000 (cacheRead) = 16000
    // 16000 / 128000 = ~13%
    await expect(contextPill).toContainText("%");

    const turnsPill = window.getByTestId("stats-turns");
    await expect(turnsPill).toBeVisible();
    await expect(turnsPill).toContainText("1 turn");

    // Hide/minimize thinking blocks toggle on the same row as price
    const thinkingToggle = window.getByTestId("toggle-hide-thinking");
    await expect(thinkingToggle).toBeVisible();

    // Thinking block in the timeline
    const thinkingBlock = window.getByTestId("thinking-block");
    await expect(thinkingBlock).toBeVisible();
    await expect(thinkingBlock).toContainText("Thought process");

    // Toggling the header toggle minimizes thinking blocks
    await thinkingToggle.click();
    await expect(thinkingBlock).toHaveAttribute("data-minimized", "true");

    // Clicking the minimized block header enlarges it
    const thinkingHeader = thinkingBlock.getByRole("button", { name: /thought process/i });
    await thinkingHeader.click();
    await expect(thinkingBlock).toHaveAttribute("data-minimized", "false");
    const thinkingContent = window.getByTestId("thinking-block-content");
    await expect(thinkingContent).toBeVisible();
    await expect(thinkingContent).toContainText("Thinking through the mathematical proof");

    // Answer text remains visible outside thinking block
    await expect(window.locator(".timeline-item--assistant")).toContainText("Here is the calculation result.");
  } finally {
    await secondRun.close();
  }
});
