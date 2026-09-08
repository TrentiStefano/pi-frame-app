import { expect, test } from "@playwright/test";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedForkSessionFixture,
  selectSession,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

async function findSessionFile(root: string, sessionId: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      try {
        return await findSessionFile(path, sessionId);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Could not find seeded session")) continue;
        throw error;
      }
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const firstLine = (await readFile(path, "utf8")).split("\n", 1)[0] ?? "";
    if (firstLine.includes(`"id":"${sessionId}"`)) return path;
  }
  throw new Error(`Could not find seeded session ${sessionId}`);
}

test("reopens a catalog record with unknown fields and legacy path mapping", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir("pi-app-catalog-reopen-");
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("catalog-reopen-workspace");
  const seeded = await seedForkSessionFixture(agentDir, workspacePath);
  const sessionFilePath = await findSessionFile(agentDir, seeded.sessionId);

  // Bootstrap only the recognized workspace record, then replace the catalog with the fixture.
  const bootstrap = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath], testMode: "background" });
  const bootstrapWindow = await bootstrap.firstWindow();
  const bootstrapState = await getDesktopState(bootstrapWindow);
  const workspace = bootstrapState.workspaces.find((entry) => entry.path === workspacePath);
  expect(workspace).toBeDefined();
  await bootstrap.close();

  const catalogPath = join(userDataDir, "catalogs.json");
  const catalogFixture = {
    version: 2,
    workspaces: [
      {
        workspaceId: workspace!.id,
        path: workspacePath,
        displayName: "catalog-reopen-workspace",
        lastOpenedAt: "2024-01-02T03:04:05.000Z",
        sortOrder: 0,
      },
    ],
    sessions: [
      {
        sessionRef: { workspaceId: workspace!.id, sessionId: seeded.sessionId },
        workspaceId: workspace!.id,
        title: seeded.title,
        updatedAt: "2024-01-02T03:04:06.000Z",
        previewSnippet: "First fork answer",
        status: "idle",
        xFixtureMarker: "opaque-a",
        xFixtureDetails: { value: 17, enabled: true },
      },
    ],
    worktrees: [],
    sessionFiles: {
      [`${workspace!.id}:${seeded.sessionId}`]: sessionFilePath,
    },
  };
  const catalogBytes = `${JSON.stringify(catalogFixture, null, 2)}\n`;
  await writeFile(catalogPath, catalogBytes, "utf8");
  const sourceBytesBefore = await readFile(sessionFilePath);

  const harness = await launchDesktop(userDataDir, { agentDir, testMode: "background" });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    const row = window.locator(".session-row", { hasText: seeded.title }).first();
    await expect(row).toBeVisible();
    await selectSession(window, seeded.title);
    // Startup sync is the deliberate normal catalog write. It canonicalizes the
    // fixture while opening the source session without rewriting its transcript.
    const startupCatalogBytes = await readFile(catalogPath, "utf8");
    expect(startupCatalogBytes).not.toBe(catalogBytes);
    const startupCatalog = JSON.parse(startupCatalogBytes) as typeof catalogFixture & {
      sessions: Array<Record<string, unknown> & (typeof catalogFixture)["sessions"][number]>;
      sessionFiles?: Record<string, string>;
    };
    const startupSource = startupCatalog.sessions.find(
      (session) => session.sessionRef.sessionId === seeded.sessionId,
    );
    expect(startupSource).toBeDefined();
    expect(startupSource).not.toHaveProperty("xFixtureMarker");
    expect(startupSource).not.toHaveProperty("xFixtureDetails");
    expect(startupSource).toMatchObject({
      sessionRef: { workspaceId: workspace!.id, sessionId: seeded.sessionId },
      workspaceId: workspace!.id,
      title: seeded.title,
      status: "idle",
      previewSnippet: "First fork question",
      sessionFilePath: sessionFilePath,
    });
    expect(startupCatalog.sessionFiles?.[`${workspace!.id}:${seeded.sessionId}`]).toBe(sessionFilePath);
    expect(await readFile(sessionFilePath)).toEqual(sourceBytesBefore);

    const transcript = window.getByTestId("transcript");
    await expect(transcript).toContainText("First fork question");
    await expect(transcript).toContainText("Second fork answer");
    await expect(transcript).toContainText("Third fork answer");
    const selectedTranscript = await getSelectedTranscript(window);
    const renderedText = selectedTranscript?.transcript
      .filter(
        (entry): entry is Extract<NonNullable<typeof selectedTranscript>["transcript"][number], { kind: "message" }> =>
          entry.kind === "message" && (entry.role === "user" || entry.role === "assistant"),
      )
      .map((entry) => entry.text) ?? [];
    expect(renderedText).toEqual([
      "First fork question",
      "First fork answer",
      "Second fork question",
      "Second fork answer",
      "Third fork question",
      "Third fork answer",
    ]);

    const forkSource = transcript.locator(".timeline-item--assistant", { hasText: "Second fork answer" });
    await forkSource.hover();
    await forkSource.getByTestId("fork-from-message").click();
    await expect(window.getByTestId("fork-modal")).toBeVisible();
    await window.getByTestId("fork-modal-confirm").click();
    await expect(window.getByTestId("fork-modal")).toHaveCount(0);
    await expect.poll(async () => (await getDesktopState(window)).selectedSessionId).not.toBe(seeded.sessionId);
    await expect(window.getByTestId("transcript")).toContainText("Second fork answer");
    expect(await readFile(sessionFilePath)).toEqual(sourceBytesBefore);
  } finally {
    await harness.close();
  }
});
