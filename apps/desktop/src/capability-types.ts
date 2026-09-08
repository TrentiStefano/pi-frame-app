export type CapabilityKind = "skill" | "extension" | "connector";
export type CapabilityTrust = "official" | "verified" | "community" | "local";
export type CapabilityScope = "user" | "project";

export interface CapabilityPackageDefinition {
  readonly source: string;
}

export type CapabilityConnectorDefinition =
  | {
      readonly transport: "streamable-http";
      readonly url: string;
      readonly headers?: Readonly<Record<string, string>>;
    }
  | {
      readonly transport: "stdio";
      readonly command: string;
      readonly args?: readonly string[];
      readonly env?: Readonly<Record<string, string>>;
    };

export interface CapabilityCatalogEntry {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly author: string;
  readonly version: string;
  readonly trust: CapabilityTrust;
  readonly featured?: boolean;
  readonly tags?: readonly string[];
  readonly permissions?: readonly string[];
  readonly package?: CapabilityPackageDefinition;
  readonly connector?: CapabilityConnectorDefinition;
  readonly homepage?: string;
}

export interface CapabilityCatalog {
  readonly schemaVersion: 1;
  readonly updatedAt: string;
  readonly entries: readonly CapabilityCatalogEntry[];
}

export type CapabilityConnectorStatus = "connected" | "disconnected" | "connecting" | "error";

export interface CapabilityConnectorRecord {
  readonly id: string;
  readonly name: string;
  readonly definition: CapabilityConnectorDefinition;
  readonly status: CapabilityConnectorStatus;
  readonly toolCount: number;
  readonly error?: string;
  readonly custom: boolean;
}

export interface CapabilityCenterSnapshot {
  readonly catalog: CapabilityCatalog;
  readonly catalogUrl: string;
  readonly refreshedAt: string;
  readonly usedCachedCatalog: boolean;
  readonly connectors: readonly CapabilityConnectorRecord[];
}

export interface InstallCapabilityPackageInput {
  readonly workspaceId: string;
  readonly source: string;
  readonly scope: CapabilityScope;
}

export interface SetCapabilityConnectorInput {
  readonly id: string;
  readonly name: string;
  readonly definition: CapabilityConnectorDefinition;
  readonly enabled: boolean;
  readonly custom?: boolean;
}
