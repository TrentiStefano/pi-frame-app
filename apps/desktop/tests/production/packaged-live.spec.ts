import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  getRealAuthConfig,
  launchPackagedDesktop,
  makeUserDataDir,
  resolvePackagedAppExecutable,
} from "../helpers/electron-app";

async function callTestHook<T>(harness: Awaited<ReturnType<typeof launchPackagedDesktop>>, name: string): Promise<T> {
  return harness.electronApp.evaluate(async (_, hookName) => {
    const hooks = (globalThis as { __PI_APP_TEST_HOOKS?: Record<string, unknown> }).__PI_APP_TEST_HOOKS;
    const hook = hooks?.[hookName];
    if (typeof hook !== "function") throw new Error(`test hook unavailable: ${hookName}`);
    return (await (hook as () => unknown)()) as T;
  }, name);
}

async function resetRendererDiagnostics(window: Awaited<ReturnType<Awaited<ReturnType<typeof launchPackagedDesktop>>["firstWindow"]>>): Promise<void> {
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

test("runs a real Pi conversation in a real workspace from the packaged app", async () => {
  const longStream = process.env.PI_APP_STREAMING_LONG === "1";
  test.setTimeout(longStream ? 360_000 : 240_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir("pi-frame-packaged-live-");
  const workspacePath = resolve(process.env.PI_APP_REAL_WORKSPACE ?? resolve(__dirname, "..", "..", "..", ".."));
  const expectedExecutablePath = await resolvePackagedAppExecutable();
  const harness = await launchPackagedDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
    excludeRealAuthPackages: true,
    scrubProviderEnv: true,
  });

  try {
    const window = await harness.firstWindow();
    await expect
      .poll(() => harness.electronApp.evaluate(() => process.execPath))
      .toBe(expectedExecutablePath);

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces.find((workspace) => workspace.path === workspacePath)?.path ?? "";
      })
      .toBe(workspacePath);

    await window.getByRole("complementary").getByRole("button", { name: "New thread" }).click();
    await callTestHook(harness, "resetStreamDiagnostics");
    await resetRendererDiagnostics(window);
    const prompt = longStream
      ? "Generate a long Markdown performance response. Include at least 1500 words, headings, nested lists, one table, and three fenced code blocks. End with the exact token PHASE0_PACKAGED_LONG_STREAM_END. Do not discuss this instruction."
      : "Reply with only the uppercase token PI_WINDOWS_READY.";
    await window.getByLabel("New thread prompt").fill(prompt);
    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.getByTestId("transcript")).toContainText(
      longStream ? "PHASE0_PACKAGED_LONG_STREAM_END" : "PI_WINDOWS_READY",
      { timeout: 300_000 },
    );
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const workspace = state.workspaces.find((entry) => entry.path === workspacePath);
        return workspace?.sessions.find((session) => session.id === state.selectedSessionId)?.status ?? "";
      }, { timeout: 180_000 })
      .toBe("idle");

    await callTestHook(harness, "waitForSessionEventIdle");
    await window.evaluate(() => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    }));
    const hostDiagnostics = await callTestHook<Record<string, unknown>>(harness, "getStreamDiagnostics");
    const rendererDiagnostics = await window.evaluate(() => window.__piAppTestRenderDiagnostics);
    if (!rendererDiagnostics) throw new Error("renderer diagnostics unavailable after packaged run");
    expect((hostDiagnostics.eventCounts as Record<string, number>).assistantDelta).toBeGreaterThan(0);
    expect(Number(hostDiagnostics.stateIpcPayloadBytes)).toBeGreaterThan(0);
    expect(Number(hostDiagnostics.assistantStreamPatchCount)).toBeGreaterThan(0);
    if (longStream) {
      expect(rendererDiagnostics.streamPatchAppliedCount).toBeGreaterThan(0);
      expect(rendererDiagnostics.streamPatchGapCount).toBe(0);
    }
    expect(rendererDiagnostics.reactCommitCount).toBeGreaterThan(0);
    expect(rendererDiagnostics.markdownRenderCount).toBeGreaterThan(0);
    if (longStream) {
      expect(rendererDiagnostics.markdownRenderCount).toBeLessThan(
        Number((hostDiagnostics.eventCounts as Record<string, number>).assistantDelta),
      );
    }
    console.log(JSON.stringify({ scenario: "phase0-packaged-real-provider-stream", hostDiagnostics, rendererDiagnostics }));
  } finally {
    await harness.close();
  }
});
