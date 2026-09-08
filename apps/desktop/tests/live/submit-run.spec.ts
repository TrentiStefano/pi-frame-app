import { expect, test } from "@playwright/test";
import { getDesktopState, getRealAuthConfig, launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

async function callTestHook<T>(harness: Awaited<ReturnType<typeof launchDesktop>>, name: string): Promise<T> {
  return harness.electronApp.evaluate(async (_, hookName) => {
    const hooks = (globalThis as { __PI_APP_TEST_HOOKS?: Record<string, unknown> }).__PI_APP_TEST_HOOKS;
    const hook = hooks?.[hookName];
    if (typeof hook !== "function") throw new Error(`test hook unavailable: ${hookName}`);
    return (await (hook as () => unknown)()) as T;
  }, name);
}

async function resetRendererDiagnostics(window: Awaited<ReturnType<Awaited<ReturnType<typeof launchDesktop>>["firstWindow"]>>): Promise<void> {
  await window.evaluate(() => {
    if (window.__piAppTestResetRenderDiagnostics) {
      window.__piAppTestResetRenderDiagnostics();
      return;
    }
    const diagnostics = window.__piAppTestRenderDiagnostics;
    if (!diagnostics) throw new Error("renderer diagnostics unavailable");
    for (const [key, value] of Object.entries(diagnostics)) {
      if (typeof value === "number") {
        (diagnostics as unknown as Record<string, number>)[key] = 0;
      }
    }
  });
}

test("submits a real prompt and shows the response in the transcript", async () => {
  const longStream = process.env.PI_APP_STREAMING_LONG === "1";
  test.setTimeout(longStream ? 300_000 : 180_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("live-run-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
  });

  try {
    const window = await harness.firstWindow();

    await window.getByRole("complementary").getByRole("button", { name: "New thread" }).click();
    await callTestHook(harness, "resetStreamDiagnostics");
    await resetRendererDiagnostics(window);
    const prompt = longStream
      ? "Generate a long Markdown performance response. Include at least 1500 words, headings, nested lists, one table, and three fenced code blocks. End with the exact token PHASE0_LONG_STREAM_END. Do not discuss this instruction."
      : "Reply with only the uppercase word READY.";
    await window.getByLabel("New thread prompt").fill(prompt);
    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.getByTestId("transcript")).toContainText(
      longStream ? "PHASE0_LONG_STREAM_END" : /READY/,
      { timeout: 240_000 },
    );

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions[0]?.status ?? "";
      }, { timeout: 150_000 })
      .toBe("idle");

    await callTestHook(harness, "waitForSessionEventIdle");
    await window.evaluate(() => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    }));
    const hostDiagnostics = await callTestHook<Record<string, unknown>>(harness, "getStreamDiagnostics");
    const rendererDiagnostics = await window.evaluate(() => window.__piAppTestRenderDiagnostics);
    if (!rendererDiagnostics) throw new Error("renderer diagnostics unavailable after live run");
    expect((hostDiagnostics.eventCounts as Record<string, number>).assistantDelta).toBeGreaterThan(0);
    expect(Number(hostDiagnostics.assistantDeltaBytesTotal)).toBeGreaterThan(longStream ? 500 : 0);
    const assistantToTerminalElapsedMsBySession = hostDiagnostics.assistantToTerminalElapsedMsBySession as Record<string, number>;
    expect(Object.values(assistantToTerminalElapsedMsBySession)).toHaveLength(1);
    expect(Object.values(assistantToTerminalElapsedMsBySession)[0]).toBeGreaterThanOrEqual(0);
    expect(Number(hostDiagnostics.stateIpcPayloadBytes)).toBeGreaterThan(0);
    expect(Number(hostDiagnostics.selectedTranscriptIpcPayloadBytes)).toBeGreaterThan(0);
    expect(Number(hostDiagnostics.assistantStreamPatchCount)).toBeGreaterThan(0);
    if (longStream) {
      expect(rendererDiagnostics.streamPatchAppliedCount).toBeGreaterThan(0);
      expect(rendererDiagnostics.streamPatchGapCount).toBe(0);
    }
    expect(rendererDiagnostics.markdownRenderCount).toBeGreaterThan(0);
    expect(rendererDiagnostics.reactCommitCount).toBeGreaterThan(0);
    expect(rendererDiagnostics.composerInputCount).toBeGreaterThan(0);
    expect(rendererDiagnostics.sendControlInputCount).toBeGreaterThan(0);
    console.log(JSON.stringify({ scenario: "phase0-real-provider-stream", hostDiagnostics, rendererDiagnostics }));
  } finally {
    await harness.close();
  }
});
