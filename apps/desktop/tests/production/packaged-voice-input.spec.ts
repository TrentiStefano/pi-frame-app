import { expect, test } from "@playwright/test";
import { join, resolve } from "node:path";
import {
  createNamedThread,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";

test("transcribes voice input in the packaged Windows app", async () => {
  test.skip(process.platform !== "win32", "This regression covers Windows native-library packaging.");
  test.setTimeout(90_000);
  const desktopDir = resolve(__dirname, "..", "..");
  const modelDir = join(desktopDir, ".cache", "voice-model", "sherpa-onnx-paraformer-zh-2023-09-14");
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("packaged-voice-input-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchPackagedDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "foreground",
    envOverrides: {
      PI_APP_TEST_VOICE_AUDIO_PATH: join(modelDir, "test_wavs", "0.wav"),
    },
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Packaged voice input session");
    const composer = window.getByTestId("composer");
    const voice = window.getByTestId("voice-input");

    await voice.click();
    await expect(voice).toHaveAttribute("aria-pressed", "true");
    await window.waitForTimeout(6_500);
    await voice.click();
    await expect(composer).toHaveValue(/对我做了介绍/);
  } finally {
    await harness.close();
  }
});
