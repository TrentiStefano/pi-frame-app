import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createNamedThread, launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir } from "../helpers/electron-app";

interface ModelRequest {
  readonly messages?: readonly { readonly role?: string; readonly content?: unknown }[];
  readonly tools?: readonly { readonly function?: { readonly name?: string } }[];
}

async function startBrowserAgentServer(): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
  readonly fixtureUrl: string;
  readonly requests: readonly ModelRequest[];
}> {
  const requests: ModelRequest[] = [];
  let fixtureUrl = "";
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Agent browser fixture</title><label for=name>Name</label><input id=name>");
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ModelRequest;
    requests.push(body);
    const index = requests.length;
    const toolCall = index === 1
      ? { id: "browser-open", name: "browser_open", arguments: JSON.stringify({ url: fixtureUrl }) }
      : index === 2
        ? { id: "browser-observe", name: "browser_observe", arguments: "{}" }
        : index === 3
          ? browserTypeCall(body)
          : undefined;
    const delta = toolCall
      ? { role: "assistant", tool_calls: [{ index: 0, id: toolCall.id, type: "function", function: { name: toolCall.name, arguments: toolCall.arguments } }] }
      : { role: "assistant", content: "BROWSER_AGENT_OK" };
    const event = {
      id: `browser-agent-${index}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1_000),
      model: "browser-agent-smoke",
      choices: [{ index: 0, delta, finish_reason: null }],
    };
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.write(`data: ${JSON.stringify({ ...event, choices: [{ index: 0, delta: {}, finish_reason: toolCall ? "tool_calls" : "stop" }] })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/fixture`;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1`, fixtureUrl, requests };
}

function browserTypeCall(request: ModelRequest): { readonly id: string; readonly name: string; readonly arguments: string } {
  for (const message of [...(request.messages ?? [])].reverse()) {
    if (message.role !== "tool") continue;
    const text = typeof message.content === "string" ? message.content : "";
    try {
      const result = JSON.parse(text) as { tab?: { revision?: number }; nodes?: { ref?: string; name?: string }[] };
      const input = result.nodes?.find((node) => node.name === "Name");
      if (input?.ref && typeof result.tab?.revision === "number") {
        return {
          id: "browser-type",
          name: "browser_type",
          arguments: JSON.stringify({ ref: input.ref, revision: result.tab.revision, text: "Pi agent typed this" }),
        };
      }
    } catch {
      // Continue to the earlier tool result.
    }
  }
  throw new Error("The fake model did not receive a usable browser observation");
}

test("offers embedded browser tools to the real agent loop and lets the agent operate the page", async () => {
  test.setTimeout(120_000);
  const model = await startBrowserAgentServer();
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspace = await makeWorkspace("browser-agent-live-workspace");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false, enabledModels: ["browser-agent-test/browser-agent-smoke"] });
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "settings.json"), `${JSON.stringify({
    defaultProvider: "browser-agent-test",
    defaultModel: "browser-agent-smoke",
    enabledModels: ["browser-agent-test/browser-agent-smoke"],
  }, null, 2)}\n`);
  await writeFile(join(agentDir, "models.json"), `${JSON.stringify({
    providers: { "browser-agent-test": { baseUrl: model.baseUrl, api: "openai-completions", apiKey: "unused", models: [{ id: "browser-agent-smoke" }] } },
  }, null, 2)}\n`);
  const harness = await launchDesktop(userDataDir, { agentDir, initialWorkspaces: [workspace], scrubProviderEnv: true, testMode: "background" });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Browser agent live session");
    await window.getByRole("button", { name: "Workspace tools" }).click();
    await window.getByRole("menuitem", { name: "Browser" }).click();
    await window.getByTestId("composer").fill("Open the embedded browser and fill the name field.");
    await window.getByTestId("composer").press("Enter");
    await expect(window.getByTestId("transcript")).toContainText("BROWSER_AGENT_OK", { timeout: 90_000 });
    const page = (await harness.electronApp.windows()).find((candidate) => candidate.url().startsWith(model.fixtureUrl));
    expect(page).toBeTruthy();
    await expect(page!.getByLabel("Name")).toHaveValue("Pi agent typed this");
    const offeredTools = model.requests[0]?.tools?.map((tool) => tool.function?.name);
    expect(offeredTools).toEqual(expect.arrayContaining(["browser_open", "browser_observe", "browser_screenshot", "browser_wait", "browser_type"]));
  } finally {
    await harness.close();
    await new Promise<void>((resolve) => model.server.close(() => resolve()));
  }
});
