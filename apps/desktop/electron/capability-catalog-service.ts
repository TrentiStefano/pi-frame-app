import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CapabilityCatalog,
  CapabilityCatalogEntry,
  CapabilityCenterSnapshot,
} from "../src/capability-types";
import type { McpConnectorService } from "./mcp-connector-service";

/**
 * The app ships with a small safe catalog. A maintained remote catalog can be
 * opted into with PI_CAPABILITY_CATALOG_URL; do not make startup depend on an
 * external repository that may disappear.
 */
export const DEFAULT_CAPABILITY_CATALOG_URL = "bundled://capability-catalog";

const FALLBACK_CATALOG: CapabilityCatalog = {
  schemaVersion: 1,
  updatedAt: "2026-07-28T00:00:00.000Z",
  entries: [
    {
      id: "pi-starter-skills",
      kind: "skill",
      name: "Pi starter skills",
      description: "A maintained starter pack for repository review, release notes, and focused implementation planning.",
      category: "Developer tools",
      author: "pi-gui",
      version: "1.0.0",
      trust: "official",
      featured: true,
      tags: ["review", "release", "planning"],
      permissions: ["May read repository files", "May suggest terminal commands"],
      package: { source: "git:github.com/mshen6666/pi-capability-catalog" },
      homepage: "https://github.com/mshen6666/pi-capability-catalog",
    },
    {
      id: "context7",
      kind: "connector",
      name: "Context7 documentation",
      description: "Current library documentation and code examples exposed through MCP.",
      category: "Developer tools",
      author: "Upstash",
      version: "remote",
      trust: "verified",
      featured: true,
      tags: ["documentation", "libraries", "MCP"],
      permissions: ["Sends tool queries to mcp.context7.com", "Returns public documentation"],
      connector: { transport: "streamable-http", url: "https://mcp.context7.com/mcp" },
      homepage: "https://context7.com",
    },
    {
      id: "deepwiki",
      kind: "connector",
      name: "DeepWiki",
      description: "Ask questions about public GitHub repositories through a hosted MCP server.",
      category: "Research",
      author: "Cognition",
      version: "remote",
      trust: "verified",
      tags: ["GitHub", "documentation", "MCP"],
      permissions: ["Sends repository questions to mcp.deepwiki.com", "Reads public repository knowledge"],
      connector: { transport: "streamable-http", url: "https://mcp.deepwiki.com/mcp" },
      homepage: "https://deepwiki.com",
    },
  ],
};

export class CapabilityCatalogService {
  private readonly cachePath: string;
  private readonly catalogUrl: string;
  private readonly connectors: McpConnectorService;
  private catalog: CapabilityCatalog = FALLBACK_CATALOG;
  private refreshedAt = new Date(0).toISOString();
  private usedCachedCatalog = false;

  constructor(options: { readonly userDataDir: string; readonly connectors: McpConnectorService; readonly catalogUrl?: string }) {
    this.cachePath = join(options.userDataDir, "capability-catalog.json");
    this.connectors = options.connectors;
    this.catalogUrl = options.catalogUrl?.trim() || process.env.PI_CAPABILITY_CATALOG_URL?.trim() || DEFAULT_CAPABILITY_CATALOG_URL;
  }

  async initialize(): Promise<void> {
    await this.loadCache();
    await this.connectors.initialize();
    void this.refresh().catch((error) => {
      console.warn("[capabilities] catalog refresh failed:", error);
    });
  }

  async snapshot(refresh = false): Promise<CapabilityCenterSnapshot> {
    if (refresh && this.catalogUrl !== DEFAULT_CAPABILITY_CATALOG_URL) {
      try {
        await this.refresh();
      } catch (error) {
        // Refresh is best-effort. Keep the last valid cache/fallback catalog
        // available so package discovery and connectors remain usable offline.
        console.warn("[capabilities] catalog refresh failed:", error);
      }
    }
    return {
      catalog: this.catalog,
      catalogUrl: this.catalogUrl,
      refreshedAt: this.refreshedAt,
      usedCachedCatalog: this.usedCachedCatalog,
      connectors: this.connectors.snapshot(),
    };
  }

  async refresh(): Promise<void> {
    if (this.catalogUrl === DEFAULT_CAPABILITY_CATALOG_URL) return;
    const response = await fetch(this.catalogUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Capability catalog returned HTTP ${response.status}`);
    const catalog = parseCatalog(await response.json());
    this.catalog = catalog;
    this.refreshedAt = new Date().toISOString();
    this.usedCachedCatalog = false;
    await writeFile(this.cachePath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  }

  private async loadCache(): Promise<void> {
    try {
      this.catalog = parseCatalog(JSON.parse(await readFile(this.cachePath, "utf8")));
      this.usedCachedCatalog = true;
      this.refreshedAt = new Date().toISOString();
    } catch {
      this.catalog = FALLBACK_CATALOG;
      this.usedCachedCatalog = true;
      this.refreshedAt = new Date().toISOString();
    }
  }
}

function parseCatalog(value: unknown): CapabilityCatalog {
  if (!value || typeof value !== "object") throw new Error("Capability catalog must be an object");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.updatedAt !== "string" || !Array.isArray(record.entries)) {
    throw new Error("Unsupported capability catalog schema");
  }
  const entries = record.entries.map(parseEntry);
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate capability id: ${entry.id}`);
    ids.add(entry.id);
  }
  return { schemaVersion: 1, updatedAt: record.updatedAt, entries };
}

function parseEntry(value: unknown): CapabilityCatalogEntry {
  if (!value || typeof value !== "object") throw new Error("Capability entry must be an object");
  const entry = value as unknown as CapabilityCatalogEntry;
  if (!entry.id || !entry.name || !entry.description || !entry.category || !entry.author || !entry.version) {
    throw new Error("Capability entry is missing required metadata");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(entry.id)) throw new Error(`Invalid capability id: ${entry.id}`);
  if (!(["skill", "extension", "connector"] as const).includes(entry.kind)) throw new Error(`Invalid capability kind: ${entry.id}`);
  if (!(["official", "verified", "community", "local"] as const).includes(entry.trust)) throw new Error(`Invalid capability trust: ${entry.id}`);
  if (entry.kind === "connector" && !entry.connector) throw new Error(`Connector definition missing: ${entry.id}`);
  if (entry.kind !== "connector" && !entry.package) throw new Error(`Package definition missing: ${entry.id}`);
  return structuredClone(entry);
}
