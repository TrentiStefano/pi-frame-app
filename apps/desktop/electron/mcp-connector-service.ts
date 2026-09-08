import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ExtensionAPI, ExtensionFactory, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
  CapabilityConnectorDefinition,
  CapabilityConnectorRecord,
  SetCapabilityConnectorInput,
} from "../src/capability-types";

interface StoredConnector {
  readonly id: string;
  readonly name: string;
  readonly definition: CapabilityConnectorDefinition;
  readonly custom: boolean;
}

interface ConnectedConnector extends StoredConnector {
  client?: Client;
  status: CapabilityConnectorRecord["status"];
  tools: McpTool[];
  error?: string;
}

interface McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
}

export class McpConnectorService {
  private readonly storagePath: string;
  private readonly connectors = new Map<string, ConnectedConnector>();

  constructor(userDataDir: string) {
    this.storagePath = join(userDataDir, "mcp-connectors.json");
  }

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.storagePath, "utf8"));
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const stored = parseStoredConnector(entry);
          this.connectors.set(stored.id, { ...stored, status: "disconnected", tools: [] });
        }
      }
    } catch {
      // First run and corrupt optional connector state both start disconnected.
    }
    await Promise.allSettled([...this.connectors.keys()].map((id) => this.connect(id)));
  }

  snapshot(): CapabilityConnectorRecord[] {
    return [...this.connectors.values()]
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        definition: entry.definition,
        status: entry.status,
        toolCount: entry.tools.length,
        ...(entry.error ? { error: entry.error } : {}),
        custom: entry.custom,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async setConnector(input: SetCapabilityConnectorInput): Promise<void> {
    if (input.enabled) {
      validateConnector(input.id, input.definition);
      const existing = this.connectors.get(input.id);
      if (existing?.client) await existing.client.close().catch(() => undefined);
      this.connectors.set(input.id, {
        id: input.id,
        name: input.name,
        definition: structuredClone(input.definition),
        custom: Boolean(input.custom),
        status: "disconnected",
        tools: [],
      });
      await this.persist();
      await this.connect(input.id);
      return;
    }

    const existing = this.connectors.get(input.id);
    if (existing?.client) await existing.client.close().catch(() => undefined);
    this.connectors.delete(input.id);
    await this.persist();
  }

  async reconnect(id: string): Promise<void> {
    await this.connect(id);
  }

  runtimeExtension(): ExtensionFactory {
    return (pi: ExtensionAPI) => {
      for (const connector of this.connectors.values()) {
        if (connector.status !== "connected") continue;
        for (const remoteTool of connector.tools) {
          pi.registerTool(this.toRuntimeTool(connector, remoteTool));
        }
      }
    };
  }

  private toRuntimeTool(
    connector: ConnectedConnector,
    remoteTool: McpTool,
  ): ToolDefinition<any, { readonly connectorId: string; readonly remoteTool: string; readonly result?: unknown }> {
    const exposedName = mcpToolName(connector.id, remoteTool.name);
    return {
      name: exposedName,
      label: `${connector.name}: ${remoteTool.name}`,
      description: remoteTool.description || `Run ${remoteTool.name} through the ${connector.name} MCP connector.`,
      parameters: remoteTool.inputSchema as any,
      execute: async (_toolCallId, params, signal) => {
        if (!connector.client || connector.status !== "connected") {
          throw new Error(`${connector.name} is not connected`);
        }
        const result = await connector.client.callTool(
          { name: remoteTool.name, arguments: params as Record<string, unknown> },
          undefined,
          { signal },
        );
        const remoteContent = Array.isArray(result.content) ? result.content as Record<string, unknown>[] : [];
        const content: Array<
          { readonly type: "text"; readonly text: string }
          | { readonly type: "image"; readonly data: string; readonly mimeType: string }
        > = [];
        for (const item of remoteContent) {
          if (item.type === "text" && typeof item.text === "string") {
            content.push({ type: "text", text: item.text });
            continue;
          }
          if (item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
            content.push({ type: "image", data: item.data, mimeType: item.mimeType });
            continue;
          }
          content.push({ type: "text", text: JSON.stringify(item) });
        }
        return {
          content: content.length > 0 ? content : [{ type: "text", text: JSON.stringify(result.structuredContent ?? {}) }],
          details: { connectorId: connector.id, remoteTool: remoteTool.name, result: result.structuredContent },
          ...(result.isError ? { isError: true } : {}),
        } as any;
      },
    };
  }

  private async connect(id: string): Promise<void> {
    const connector = this.connectors.get(id);
    if (!connector) throw new Error(`Unknown connector: ${id}`);
    connector.status = "connecting";
    connector.error = undefined;
    connector.tools = [];
    if (connector.client) await connector.client.close().catch(() => undefined);

    const client = new Client({ name: "pi-frame", version: "1.0.0" }, { capabilities: {} });
    connector.client = client;
    try {
      const transport = connector.definition.transport === "streamable-http"
        ? new StreamableHTTPClientTransport(new URL(connector.definition.url), {
            requestInit: connector.definition.headers
              ? { headers: { ...connector.definition.headers } }
              : undefined,
          })
        : new StdioClientTransport({
            command: connector.definition.command,
            args: [...(connector.definition.args ?? [])],
            env: connector.definition.env ? { ...connector.definition.env } : undefined,
            stderr: "pipe",
          });
      await withTimeout(client.connect(transport), 15_000, `${connector.name} connection timed out`);
      const listed = await withTimeout(client.listTools(), 15_000, `${connector.name} tool discovery timed out`);
      connector.tools = listed.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }));
      connector.status = "connected";
    } catch (error) {
      connector.status = "error";
      connector.error = error instanceof Error ? error.message : String(error);
      await client.close().catch(() => undefined);
      connector.client = undefined;
      throw error;
    }
  }

  private async persist(): Promise<void> {
    const stored: StoredConnector[] = [...this.connectors.values()].map(({ id, name, definition, custom }) => ({
      id,
      name,
      definition,
      custom,
    }));
    await writeFile(this.storagePath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  }
}

export function createMcpRuntimeExtension(service: McpConnectorService): ExtensionFactory {
  return service.runtimeExtension();
}

function parseStoredConnector(value: unknown): StoredConnector {
  if (!value || typeof value !== "object") throw new Error("Invalid stored connector");
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") throw new Error("Invalid stored connector metadata");
  const definition = record.definition as CapabilityConnectorDefinition;
  validateConnector(record.id, definition);
  return { id: record.id, name: record.name, definition, custom: record.custom === true };
}

function validateConnector(id: string, definition: CapabilityConnectorDefinition): void {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) throw new Error("Connector id must use lowercase letters, numbers, and hyphens");
  if (!definition || typeof definition !== "object") throw new Error("Connector definition is required");
  if (definition.transport === "streamable-http") {
    const url = new URL(definition.url);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      throw new Error("Remote MCP connectors must use HTTPS");
    }
  } else if (definition.transport === "stdio") {
    if (!definition.command.trim()) throw new Error("stdio connector command is required");
  } else {
    throw new Error("Unsupported MCP transport");
  }
  if ((definition.transport === "streamable-http" && definition.headers && Object.keys(definition.headers).length > 0)
    || (definition.transport === "stdio" && definition.env && Object.keys(definition.env).length > 0)) {
    throw new Error("Credential-bearing custom connector fields are not stored until secure credential storage is configured");
  }
}

function mcpToolName(connectorId: string, toolName: string): string {
  const normalized = `${connectorId}_${toolName}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return `mcp_${normalized}`.slice(0, 64);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
