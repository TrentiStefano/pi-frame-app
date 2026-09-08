import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";

interface ModelRequest {
  readonly messages?: readonly { readonly role?: string; readonly content?: unknown }[];
  readonly tools?: readonly { readonly function?: { readonly name?: string } }[];
}

async function startComputerUseModelServer(): Promise<{
  readonly baseUrl: string;
  readonly browserUrl: string;
  readonly requests: readonly ModelRequest[];
  readonly close: () => Promise<void>;
}> {
  const requests: ModelRequest[] = [];
  let browserUrl = "";
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Computer Use fixture</title><h1>Computer Use fixture</h1>");
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ModelRequest;
    requests.push(body);

    const requestIndex = requests.length;
    const id = `computer-use-smoke-${requestIndex}`;
    const delta = requestIndex === 1
      ? {
          role: "assistant",
          tool_calls: [{
            index: 0,
            id: "find-roots-smoke",
            type: "function",
            function: { name: "find_roots", arguments: "{}" },
          }],
        }
      : requestIndex === 2
        ? {
            role: "assistant",
            tool_calls: [{
              index: 0,
              id: "launch-browser-smoke",
              type: "function",
              function: { name: "launch_browser", arguments: JSON.stringify({ url: browserUrl }) },
            }],
          }
        : { role: "assistant", content: "COMPUTER_USE_OK" };
    const finishReason = requestIndex < 3 ? "tool_calls" : "stop";
    const events = [
      {
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1_000),
        model: "computer-use-smoke",
        choices: [{ index: 0, delta, finish_reason: null }],
      },
      {
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1_000),
        model: "computer-use-smoke",
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    ];
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    for (const event of events) {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  browserUrl = `http://127.0.0.1:${address.port}/fixture`;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    browserUrl,
    requests,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

test("enables Computer Use from its slash command and runs tools through the real agent loop", async () => {
  test.setTimeout(120_000);
  test.skip(process.platform !== "win32", "Windows helper smoke requires a Windows desktop host.");

  const server = await startComputerUseModelServer();
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const helperPath = join(userDataDir, "computer-use", "windows-bridge.exe");
  const usePackagedApp = process.env.PI_APP_COMPUTER_USE_PACKAGED === "1";
  const workspacePath = await makeWorkspace("computer-use-live-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["computer-use-test/computer-use-smoke"],
  });
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "settings.json"), `${JSON.stringify({
    defaultProvider: "computer-use-test",
    defaultModel: "computer-use-smoke",
    enabledModels: ["computer-use-test/computer-use-smoke"],
  }, null, 2)}\n`);
  await writeFile(join(agentDir, "models.json"), `${JSON.stringify({
    providers: {
      "computer-use-test": {
        baseUrl: server.baseUrl,
        api: "openai-completions",
        apiKey: "unused",
        models: [{ id: "computer-use-smoke" }],
      },
    },
  }, null, 2)}\n`);

  const launch = usePackagedApp ? launchPackagedDesktop : launchDesktop;
  const harness = await launch(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
    envOverrides: usePackagedApp ? {} : { PI_COMPUTER_USE_WINDOWS_HELPER_PATH: helperPath },
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Computer Use live session");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(window.getByTestId("settings-computer-use-enabled")).not.toBeChecked();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();

    const composer = window.getByTestId("composer");
    await composer.fill("/computer-use");
    await expect(window.getByTestId("slash-menu")).toContainText("Computer Use");
    await composer.fill("/computer-use Exercise Computer Use now.");
    await composer.press("Enter");

    await expect(window.getByTestId("transcript")).toContainText("COMPUTER_USE_OK", { timeout: 90_000 });
    const toolItems = window.locator(".timeline-tool");
    await expect(toolItems).toHaveCount(2);
    await toolItems.nth(0).locator(".timeline-tool__header").click();
    await expect(toolItems.nth(0).locator(".timeline-tool__pre")).toContainText("Found");
    await toolItems.nth(1).locator(".timeline-tool__header").click();
    await expect(toolItems.nth(1).locator(".timeline-tool__pre")).toContainText("launch_browser completed");
    await expect(toolItems.nth(1).locator(".timeline-tool__pre")).toContainText("Computer Use fixture");
    await expect(toolItems.nth(1).locator(".timeline-tool__pre")).not.toContainText('"outline"');

    expect(server.requests).toHaveLength(3);
    const offeredTools = server.requests[0]?.tools?.map((tool) => tool.function?.name);
    expect(offeredTools).toEqual(expect.arrayContaining(["find_roots", "observe_ui", "act_ui", "wait_for", "launch_browser"]));
    const userMessage = [...(server.requests[0]?.messages ?? [])].reverse().find((message) => message.role === "user")?.content;
    const userText = typeof userMessage === "string"
      ? userMessage
      : Array.isArray(userMessage)
        ? userMessage
          .map((part: unknown) => typeof part === "object" && part && "text" in part ? String(part.text) : "")
          .join("\n")
        : "";
    expect(userText).toContain("Use the available Computer Use tools");
    expect(userText).toContain("Exercise Computer Use now.");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(window.getByTestId("settings-computer-use-enabled")).toBeChecked();
  } finally {
    await harness.close();
    await server.close();
  }
});
