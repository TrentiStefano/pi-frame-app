import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import {
  createSessionViaIpc,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
  type DesktopHarness,
} from "../helpers/electron-app";

async function startFixture(): Promise<{ readonly server: Server; readonly url: string }> {
  const server = createServer((request, response) => {
    if (request.url === "/download") {
      response.writeHead(200, {
        "content-disposition": "attachment; filename=fixture.txt",
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("browser download fixture");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "pi_browser_session=restored; Path=/; SameSite=Lax" });
    response.end(`<!doctype html><html><head><title>Browser fixture</title></head><body>
      <main><h1>Browser fixture</h1><label for="name">Name</label><input id="name" placeholder="Your name" />
      <button data-testid="save">Save draft</button><label for="upload">Upload</label><input id="upload" type="file" />
      <a href="/download" download="fixture.txt">Download fixture</a>
      <p data-testid="status">Ready</p></main>
      <script>setTimeout(() => { document.querySelector('[data-testid=status]').textContent = 'Async complete'; }, 350);</script>
    </body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function pressBrowserF12(harness: DesktopHarness, targetUrl: string): Promise<void> {
  await harness.electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((candidate) => candidate.getURL().startsWith(url));
    page?.sendInputEvent({ type: "keyDown", keyCode: "F12" });
    page?.sendInputEvent({ type: "keyUp", keyCode: "F12" });
  }, targetUrl);
}

test("opens the embedded browser, navigates tabs, and sends a selected element to the composer", async () => {
  test.setTimeout(90_000);
  const fixture = await startFixture();
  const userDataDir = await makeUserDataDir();
  const workspace = await makeWorkspace("browser-core-workspace");
  const harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspace], testMode: "background" });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspace);
    await createSessionViaIpc(window, workspace, "Browser thread");
    await window.getByRole("button", { name: "Workspace tools" }).click();
    await window.getByRole("menuitem", { name: "Browser" }).click();
    await expect(window.getByTestId("browser-panel")).toBeVisible();

    await window.getByLabel("Address").fill(fixture.url);
    await window.getByLabel("Address").press("Enter");
    const fixturePage = await expect.poll(async () => {
      const pages = harness.electronApp.windows();
      return pages.find((page) => page.url().startsWith(fixture.url));
    }, { timeout: 20_000 }).toBeTruthy();
    const browserPage = (await harness.electronApp.windows()).find((page) => page.url().startsWith(fixture.url));
    if (!browserPage) throw new Error("Embedded browser page did not open");
    await expect(browserPage.getByRole("heading", { name: "Browser fixture" })).toBeVisible();

    await browserPage.getByLabel("Upload").click();
    await expect(window.getByText(/wants to choose a file/)).toBeVisible();
    await window.getByRole("button", { name: "Cancel" }).click();

    await browserPage.getByRole("link", { name: "Download fixture" }).click();
    await expect(window.getByText(/wants to download a file/)).toBeVisible();
    await window.getByRole("button", { name: "Allow once" }).click();
    await browserPage.getByRole("link", { name: "Download fixture" }).click();
    await expect(window.locator(".composer-attachment--file")).toContainText("fixture.txt (from 127.0.0.1)");

    await expect(window.getByRole("tab", { name: /Browser fixture/ })).toBeVisible();
    const target = await window.evaluate(async () => {
      const state = await window.piApp?.getState();
      if (!state?.selectedWorkspaceId || !state.selectedSessionId) throw new Error("Expected selected browser thread");
      return { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
    });
    await window.evaluate(async (sessionRef) => {
      await window.piApp?.sendBrowserCommand(sessionRef, { kind: "agent-control", action: "pause" });
    }, target);
    await expect(window.getByText("Browser automation paused")).toBeVisible();
    const pausedResult = await harness.electronApp.evaluate(async (_application, { sessionRef }) => {
      const hooks = (globalThis as typeof globalThis & { __PI_APP_TEST_HOOKS?: { runBrowserRuntimeTool?: (input: unknown) => Promise<unknown> } }).__PI_APP_TEST_HOOKS;
      if (!hooks?.runBrowserRuntimeTool) throw new Error("Browser runtime test hook is unavailable");
      try {
        await hooks.runBrowserRuntimeTool({ toolName: "browser_observe", sessionRef, params: {} });
        return "unexpected-success";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }, { sessionRef: target });
    expect(pausedResult).toContain("browser_paused");
    await window.getByRole("button", { name: "Resume" }).click();
    const observation = await harness.electronApp.evaluate(async (_application, { sessionRef }) => {
      const hooks = (globalThis as typeof globalThis & {
        __PI_APP_TEST_HOOKS?: {
          runBrowserRuntimeTool?: (input: { toolName: string; sessionRef: typeof sessionRef; params: unknown }) => Promise<unknown>;
        };
      }).__PI_APP_TEST_HOOKS;
      if (!hooks?.runBrowserRuntimeTool) throw new Error("Browser runtime test hook is unavailable");
      return hooks.runBrowserRuntimeTool({ toolName: "browser_observe", sessionRef, params: {} });
    }, { sessionRef: target }) as { details?: { result?: { tab?: { revision?: number }; nodes?: { ref?: string; name?: string }[] } } };
    const saveNode = observation.details?.result?.nodes?.find((node) => node.name === "Save draft");
    const nameNode = observation.details?.result?.nodes?.find((node) => node.name === "Name" || node.name === "Your name");
    expect(saveNode?.ref).toBeTruthy();
    expect(nameNode?.ref).toBeTruthy();
    const cancellableWait = harness.electronApp.evaluate(async (_application, { sessionRef }) => {
      const hooks = (globalThis as typeof globalThis & { __PI_APP_TEST_HOOKS?: { runBrowserRuntimeTool?: (input: unknown) => Promise<unknown> } }).__PI_APP_TEST_HOOKS;
      if (!hooks?.runBrowserRuntimeTool) throw new Error("Browser runtime test hook is unavailable");
      try {
        await hooks.runBrowserRuntimeTool({ toolName: "browser_wait", sessionRef, params: { state: "text-visible", text: "Never appears", timeout_ms: 5_000 } });
        return "unexpected-success";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }, { sessionRef: target });
    await expect(window.getByText(/pi is browsing: browser_wait/)).toBeVisible();
    await window.getByRole("button", { name: "Pause" }).click();
    expect(await cancellableWait).toContain("aborted");
    await window.getByRole("button", { name: "Resume" }).click();
    const blockedPage = browserPage.evaluate(() => {
      const deadline = performance.now() + 1_500;
      while (performance.now() < deadline) {
        // Keep the page event loop busy so the preload cannot answer IPC.
      }
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const timedOutWait = await harness.electronApp.evaluate(async (_application, { sessionRef }) => {
      const hooks = (globalThis as typeof globalThis & { __PI_APP_TEST_HOOKS?: { runBrowserRuntimeTool?: (input: unknown) => Promise<unknown> } }).__PI_APP_TEST_HOOKS;
      if (!hooks?.runBrowserRuntimeTool) throw new Error("Browser runtime test hook is unavailable");
      const startedAt = Date.now();
      try {
        await hooks.runBrowserRuntimeTool({ toolName: "browser_wait", sessionRef, params: { state: "text-visible", text: "Never appears", timeout_ms: 100 } });
        return { result: "unexpected-success", elapsedMs: Date.now() - startedAt };
      } catch (error) {
        return { result: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - startedAt };
      }
    }, { sessionRef: target });
    expect(timedOutWait.result).toContain("browser wait timed out after 100ms");
    expect(timedOutWait.elapsedMs).toBeLessThan(1_000);
    await blockedPage;
    const waitResult = await harness.electronApp.evaluate(async (_application, { sessionRef }) => {
      const hooks = (globalThis as typeof globalThis & { __PI_APP_TEST_HOOKS?: { runBrowserRuntimeTool?: (input: unknown) => Promise<unknown> } }).__PI_APP_TEST_HOOKS;
      if (!hooks?.runBrowserRuntimeTool) throw new Error("Browser runtime test hook is unavailable");
      return hooks.runBrowserRuntimeTool({ toolName: "browser_wait", sessionRef, params: { state: "text-visible", text: "Async complete", timeout_ms: 5_000 } });
    }, { sessionRef: target }) as { details?: { action?: string } };
    expect(waitResult.details?.action).toBe("wait");
    const screenshotResult = await harness.electronApp.evaluate(async (_application, { sessionRef }) => {
      const hooks = (globalThis as typeof globalThis & { __PI_APP_TEST_HOOKS?: { runBrowserRuntimeTool?: (input: unknown) => Promise<unknown> } }).__PI_APP_TEST_HOOKS;
      if (!hooks?.runBrowserRuntimeTool) throw new Error("Browser runtime test hook is unavailable");
      return hooks.runBrowserRuntimeTool({ toolName: "browser_screenshot", sessionRef, params: {} });
    }, { sessionRef: target }) as { content?: { type?: string; data?: string; mimeType?: string }[] };
    const screenshot = screenshotResult.content?.find((item) => item.type === "image");
    expect(screenshot?.mimeType).toBe("image/jpeg");
    expect(screenshot?.data?.length).toBeGreaterThan(100);
    await harness.electronApp.evaluate(async (_application, { sessionRef, ref, revision }) => {
      const hooks = (globalThis as typeof globalThis & { __PI_APP_TEST_HOOKS?: { runBrowserRuntimeTool?: (input: unknown) => Promise<unknown> } }).__PI_APP_TEST_HOOKS;
      if (!hooks?.runBrowserRuntimeTool) throw new Error("Browser runtime test hook is unavailable");
      return hooks.runBrowserRuntimeTool({ toolName: "browser_hover", sessionRef, params: { ref, revision } });
    }, { sessionRef: target, ref: saveNode?.ref, revision: observation.details?.result?.tab?.revision });
    await harness.electronApp.evaluate(async (_application, { sessionRef, ref, revision }) => {
      const hooks = (globalThis as typeof globalThis & { __PI_APP_TEST_HOOKS?: { runBrowserRuntimeTool?: (input: unknown) => Promise<unknown> } }).__PI_APP_TEST_HOOKS;
      if (!hooks?.runBrowserRuntimeTool) throw new Error("Browser runtime test hook is unavailable");
      return hooks.runBrowserRuntimeTool({
        toolName: "browser_type",
        sessionRef,
        params: { ref, revision, text: "Pi browser input" },
      });
    }, { sessionRef: target, ref: nameNode?.ref, revision: observation.details?.result?.tab?.revision });
    await expect(browserPage.getByLabel("Name")).toHaveValue("Pi browser input");

    await window.getByLabel("Address").fill(`${fixture.url}?revision=next`);
    await window.getByLabel("Address").press("Enter");
    await expect(browserPage).toHaveURL(/revision=next/);
    const staleResult = await harness.electronApp.evaluate(async (_application, { sessionRef, ref, revision }) => {
      const hooks = (globalThis as typeof globalThis & { __PI_APP_TEST_HOOKS?: { runBrowserRuntimeTool?: (input: unknown) => Promise<unknown> } }).__PI_APP_TEST_HOOKS;
      if (!hooks?.runBrowserRuntimeTool) throw new Error("Browser runtime test hook is unavailable");
      try {
        await hooks.runBrowserRuntimeTool({ toolName: "browser_click", sessionRef, params: { ref, revision } });
        return "unexpected-success";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }, { sessionRef: target, ref: saveNode?.ref, revision: observation.details?.result?.tab?.revision });
    expect(staleResult).toContain("stale_page");
    await window.getByRole("button", { name: "Select page element" }).click();
    await expect(window.getByRole("button", { name: "Select page element" })).toHaveAttribute("aria-pressed", "true");
    await expect(browserPage.locator("[data-pi-browser-selector]")).toHaveCount(1);
    await browserPage.keyboard.press("Escape");
    await expect(window.getByRole("button", { name: "Select page element" })).toHaveAttribute("aria-pressed", "false");
    await window.getByRole("button", { name: "Select page element" }).click();
    await browserPage.getByRole("button", { name: "Save draft" }).hover();
    await browserPage.getByRole("button", { name: "Save draft" }).click();
    await expect(window.getByRole("button", { name: "Select page element" })).toHaveAttribute("aria-pressed", "false");
    await expect(window.locator(".composer-attachment--browser-element")).toHaveCount(1);
    await expect(window.locator(".composer-attachment--browser-element")).toContainText("button: Save draft");

    await window.getByLabel("Remove button: Save draft").click();
    await expect(window.locator(".composer-attachment--browser-element")).toHaveCount(0);

    await window.getByRole("button", { name: "Attach current page" }).click();
    await expect(window.locator(".composer-attachment--browser-element")).toContainText("Page: Browser fixture");
    await window.getByRole("button", { name: "Attach page screenshot" }).click();
    await expect(window.locator(".composer-attachment--image")).toHaveCount(1);

    await window.getByRole("button", { name: "Equal split" }).click();
    await expect(window.locator("main")).toHaveClass(/main--browser-split/);
    await expect(window.getByRole("separator", { name: "Resize browser panel" })).toBeVisible();
    await window.getByRole("button", { name: "Browser first" }).click();
    await expect(window.locator("main")).toHaveClass(/main--browser-browser/);
    await window.setViewportSize({ width: 900, height: 700 });
    await expect(window.getByRole("separator", { name: "Resize browser panel" })).toBeHidden();
    await expect(window.locator(".canvas--thread")).toHaveCSS("display", "none");
    const mainBounds = await window.locator("main").boundingBox();
    const browserBounds = await window.getByTestId("browser-panel").boundingBox();
    expect(browserBounds?.width).toBeGreaterThan((mainBounds?.width ?? 0) - 2);
    await window.setViewportSize({ width: 1600, height: 1000 });

    await window.getByRole("button", { name: "More" }).click();
    const devToolsButton = window.getByRole("menuitemcheckbox", { name: "Developer tools (F12)" });
    await devToolsButton.click();
    await expect.poll(async () => {
      return (await harness.electronApp.windows()).filter((page) => page.url().startsWith("devtools://")).length;
    }).toBe(1);
    await window.getByRole("button", { name: "More" }).click();
    const closeDevToolsButton = window.getByRole("menuitemcheckbox", { name: "Developer tools (F12)" });
    await closeDevToolsButton.click();
    await expect.poll(async () => {
      return (await harness.electronApp.windows()).filter((page) => page.url().startsWith("devtools://")).length;
    }).toBe(0);

    await browserPage.getByRole("heading", { name: "Browser fixture" }).click();
    await pressBrowserF12(harness, fixture.url);
    await expect.poll(async () => {
      return (await harness.electronApp.windows()).filter((page) => page.url().startsWith("devtools://")).length;
    }).toBe(1);
    await pressBrowserF12(harness, fixture.url);
    await expect.poll(async () => {
      return (await harness.electronApp.windows()).filter((page) => page.url().startsWith("devtools://")).length;
    }).toBe(0);
    await window.getByRole("button", { name: "More" }).click();
    await window.getByRole("menuitemcheckbox", { name: "Developer tools (F12)" }).click();
    await window.getByRole("button", { name: "New tab" }).click();
    await expect(window.getByRole("tab", { name: /New tab/ })).toBeVisible();
    await window.getByRole("tab", { name: /Browser fixture/ }).click();
    await window.getByRole("button", { name: "Close Browser fixture" }).click();
    await expect.poll(async () => {
      return (await harness.electronApp.windows()).filter((page) => page.url().startsWith("devtools://")).length;
    }).toBe(0);
  } finally {
    await harness.close();
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
  }
});

test("restores task tabs and browser storage after the desktop relaunches", async () => {
  test.setTimeout(90_000);
  const fixture = await startFixture();
  const userDataDir = await makeUserDataDir();
  const workspace = await makeWorkspace("browser-reopen-workspace");
  let harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspace], testMode: "background" });

  try {
    let window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspace);
    await createSessionViaIpc(window, workspace, "Persistent browser thread");
    await window.getByTestId("workspace-tools").click();
    await window.getByRole("menuitem", { name: "Browser" }).click();
    await window.getByLabel("Address").fill(fixture.url);
    await window.getByLabel("Address").press("Enter");
    await expect.poll(async () => (await harness.electronApp.windows()).find((page) => page.url().startsWith(fixture.url))).toBeTruthy();
    const browserPage = (await harness.electronApp.windows()).find((page) => page.url().startsWith(fixture.url));
    expect(await browserPage?.evaluate(() => document.cookie)).toContain("pi_browser_session=restored");

    await harness.close();
    harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspace], testMode: "background" });
    window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspace);
    await window.getByTestId("workspace-tools").click();
    await window.getByRole("menuitem", { name: "Browser" }).click();
    await expect(window.getByRole("tab", { name: /Browser fixture/ })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await harness.electronApp.windows()).find((page) => page.url().startsWith(fixture.url))).toBeTruthy();
    const restoredBrowserPage = (await harness.electronApp.windows()).find((page) => page.url().startsWith(fixture.url));
    expect(await restoredBrowserPage?.evaluate(() => document.cookie)).toContain("pi_browser_session=restored");
  } finally {
    await harness.close();
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
  }
});
