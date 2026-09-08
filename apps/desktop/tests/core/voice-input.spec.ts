import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  createNamedThread,
  desktopShortcut,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";

test("dictates into the composer at the caret and supports cancellation", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("voice-input-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_APP_TEST_VOICE_TRANSCRIPT: "离线普通话" },
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Voice input session");
    const composer = window.getByTestId("composer");
    const voice = window.getByTestId("voice-input");

    await composer.fill("前后");
    await composer.evaluate((textarea: HTMLTextAreaElement) => textarea.setSelectionRange(1, 1));
    await voice.click();
    await expect(voice).toHaveAttribute("aria-pressed", "true");
    await expect(window.locator(".voice-input__status")).toHaveText("Listening…");
    await window.waitForTimeout(250);
    await voice.click();
    await expect(composer).toHaveValue("前离线普通话后");
    await expect(composer).toBeFocused();

    await voice.click();
    await expect(voice).toHaveAttribute("aria-pressed", "true");
    await window.keyboard.press("Escape");
    await expect(voice).toHaveAttribute("aria-pressed", "false");
    await expect(composer).toHaveValue("前离线普通话后");

    await window.keyboard.press(desktopShortcut("Shift+O"));
    const newThreadComposer = window.getByTestId("new-thread-composer");
    const newThreadVoice = window.getByTestId("voice-input");
    await newThreadComposer.fill("新：");
    await newThreadVoice.click();
    await window.waitForTimeout(250);
    await newThreadVoice.click();
    await expect(newThreadComposer).toHaveValue("新：离线普通话");
  } finally {
    await harness.close();
  }
});
