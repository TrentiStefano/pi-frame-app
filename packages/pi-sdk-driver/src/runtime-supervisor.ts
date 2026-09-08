import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  DefaultPackageManager,
  DefaultResourceLoader,
  type PackageSource,
  SettingsManager,
  parseFrontmatter,
  stripFrontmatter,
  type ExtensionFactory,
  type PathMetadata,
  type ModelRuntime,
  type ResolvedPaths,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import type {
  RuntimeLoginCallbacks,
  RuntimePackageUpdate,
  RuntimeConfiguredPackage,
  RuntimeExtensionDiagnostic,
  RuntimeExtensionRecord,
  RuntimeModelRecord,
  RuntimeProviderRecord,
  RuntimeResourceDriver,
  RuntimeSettingsSnapshot,
  RuntimeSkillRecord,
  RuntimeSourceInfo,
  RuntimeSnapshot,
} from "@pi-frame/session-driver/runtime-types";
import type { WorkspaceRef } from "@pi-frame/session-driver";
import { createRuntimeDependencies } from "./runtime-deps.js";
import { createSettingsManagerWithoutNpmPackages, isGlobalNpmLookupError } from "./npm-package-fallback.js";
import { skillSlashCommand } from "./runtime-command-utils.js";
import {
  BUILT_IN_PROVIDER_IDS,
  CustomProviderStore,
  type CustomProviderEntry,
  type CustomProviderApi,
  type CustomProviderInput,
  type CustomProviderModelInput,
  type CustomProviderModelMutationInput,
} from "./custom-provider-store.js";
import { writeJsonFileAtomic } from "./atomic-write.js";

export {
  BUILT_IN_PROVIDER_IDS,
  CUSTOM_PROVIDER_ID_PATTERN,
  isValidHttpBaseUrl,
  OPENAI_COMPLETIONS_API,
} from "./custom-provider-store.js";
export type { CustomProviderApi, CustomProviderEntry, CustomProviderInput, CustomProviderModelInput } from "./custom-provider-store.js";

export type ModelConfigurationAuthSource = "none" | "oauth" | "auth_file" | "env" | "external";

export interface ModelConfigurationProviderPreset {
  readonly id: string;
  readonly name: string;
  readonly kind: "builtin" | "custom";
  readonly apiKeySetupSupported: boolean;
  readonly authAvailable: boolean;
  readonly authSource: ModelConfigurationAuthSource;
  readonly baseUrl?: string;
  readonly api?: CustomProviderApi;
  readonly models: readonly { readonly id: string; readonly label: string }[];
}

export interface ConfiguredModelRecord {
  readonly providerId: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly label: string;
  readonly providerKind: "builtin" | "custom";
  readonly baseUrl?: string;
  readonly available: boolean;
  readonly authSource: ModelConfigurationAuthSource;
  readonly reasoning: boolean;
  readonly supportsImages: boolean;
  readonly thinkingLevels?: readonly NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>[];
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly cost?: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
  readonly isDefault: boolean;
}

export interface ModelConfigurationSnapshot {
  readonly providers: readonly ModelConfigurationProviderPreset[];
  readonly models: readonly ConfiguredModelRecord[];
  readonly defaultProvider?: string;
  readonly defaultModelId?: string;
  readonly defaultThinkingLevel?: RuntimeSettingsSnapshot["defaultThinkingLevel"];
}

export type SaveModelConfigurationInput =
  | {
      readonly providerKind: "builtin";
      readonly providerId: string;
      readonly modelId: string;
      readonly apiKey?: string;
      readonly name?: string;
      readonly reasoning?: boolean;
      readonly thinkingLevelMap?: CustomProviderModelInput["thinkingLevelMap"];
      readonly input?: readonly ("text" | "image")[];
      readonly contextWindow?: number;
      readonly maxTokens?: number;
      readonly cost?: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
    }
  | {
      readonly providerKind: "custom";
      readonly providerId: string;
      readonly baseUrl: string;
      readonly api?: CustomProviderApi;
      readonly modelId: string;
      readonly apiKey?: string;
      readonly name?: string;
      readonly reasoning?: boolean;
      readonly thinkingLevelMap?: CustomProviderModelInput["thinkingLevelMap"];
      readonly input?: readonly ("text" | "image")[];
      readonly contextWindow?: number;
      readonly maxTokens?: number;
      readonly cost?: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
    };

export interface DeleteModelConfigurationInput {
  readonly providerId: string;
  readonly modelId: string;
  readonly removeCredentialWhenUnused?: boolean;
}

export interface ModelConfigurationDefaultsInput {
  readonly providerId?: string;
  readonly modelId?: string;
  readonly thinkingLevel?: RuntimeSettingsSnapshot["defaultThinkingLevel"];
}

interface ModelSettingsSnapshot {
  readonly defaultProvider?: string;
  readonly defaultModelId?: string;
  readonly defaultThinkingLevel?: RuntimeSettingsSnapshot["defaultThinkingLevel"];
  readonly enabledModelPatterns: readonly string[];
}

interface RuntimeContext {
  readonly workspace: WorkspaceRef;
  readonly settingsManager: SettingsManager;
  readonly packageManager: DefaultPackageManager;
  readonly resourceLoader: DefaultResourceLoader;
}

export interface RuntimeInlineExtensionMetadata {
  readonly displayName: string;
  readonly description?: string;
}

interface ProjectWritableSettingsManager {
  markProjectModified(field: string, nestedKey?: string): void;
  saveProjectSettings(settings: Record<string, unknown>): void;
}

export interface RuntimeSupervisorOptions {
  readonly agentDir?: string;
  readonly modelRuntime?: ModelRuntime | Promise<ModelRuntime>;
  readonly extensionFactories?: readonly ExtensionFactory[];
  readonly inlineExtensionMetadata?: readonly RuntimeInlineExtensionMetadata[];
  readonly customProviderStore?: CustomProviderStore;
}

type ResourceScope = "user" | "project";
type ToggleableResourceKind = "extension" | "skill";

interface PackageMetadata {
  readonly displayName?: string;
  readonly description?: string;
}

export class RuntimeSupervisor implements RuntimeResourceDriver {
  private readonly agentDir: string;
  private readonly modelRuntime: Promise<ModelRuntime>;
  private readonly extensionFactories: readonly ExtensionFactory[];
  private readonly inlineExtensionMetadata: readonly RuntimeInlineExtensionMetadata[];
  private readonly customProviderStore: CustomProviderStore;
  private readonly contexts = new Map<string, RuntimeContext>();

  constructor(options: RuntimeSupervisorOptions = {}) {
    const deps = createRuntimeDependencies(options);
    this.agentDir = deps.agentDir;
    this.modelRuntime = deps.modelRuntime;
    this.extensionFactories = options.extensionFactories ?? [];
    this.inlineExtensionMetadata = options.inlineExtensionMetadata ?? [];
    this.customProviderStore = deps.customProviderStore;
  }

  async getRuntimeSnapshot(workspace: WorkspaceRef): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    return this.buildSnapshot(context);
  }

  async refreshRuntime(workspace: WorkspaceRef): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    context.settingsManager.reload();
    await (await this.modelRuntime).reloadConfig();
    await reloadResourceLoaderWithoutPackageInstallation(context.resourceLoader);
    return this.buildSnapshot(context);
  }

  async refreshModelRuntime(workspace: WorkspaceRef): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    await (await this.modelRuntime).reloadConfig();
    return this.buildSnapshot(context);
  }

  async checkForExtensionUpdates(workspace: WorkspaceRef): Promise<readonly RuntimePackageUpdate[]> {
    const context = await this.ensureContext(workspace);
    return context.packageManager.checkForAvailableUpdates();
  }

  async updateExtensions(workspace: WorkspaceRef, sources?: readonly string[]): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    if (sources?.length) {
      for (const source of sources) {
        await context.packageManager.update(source);
      }
    } else {
      await context.packageManager.update();
    }
    context.settingsManager.reload();
    await reloadResourceLoaderWithoutPackageInstallation(context.resourceLoader);
    return this.buildSnapshot(context);
  }

  async listPackages(workspace: WorkspaceRef): Promise<readonly RuntimeConfiguredPackage[]> {
    const context = await this.ensureContext(workspace);
    return context.packageManager.listConfiguredPackages().map((entry) => ({
      source: entry.source,
      scope: entry.scope,
      filtered: entry.filtered,
      installed: Boolean(entry.installedPath),
    }));
  }

  async installPackage(
    workspace: WorkspaceRef,
    source: string,
    scope: "user" | "project",
  ): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    await context.packageManager.installAndPersist(source, { local: scope === "project" });
    await context.settingsManager.flush();
    context.settingsManager.reload();
    await reloadResourceLoaderWithoutPackageInstallation(context.resourceLoader);
    return this.buildSnapshot(context);
  }

  async removePackage(
    workspace: WorkspaceRef,
    source: string,
    scope: "user" | "project",
  ): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const removed = await context.packageManager.removeAndPersist(source, { local: scope === "project" });
    if (!removed) throw new Error(`Package is not installed at ${scope} scope: ${source}`);
    await context.settingsManager.flush();
    context.settingsManager.reload();
    await reloadResourceLoaderWithoutPackageInstallation(context.resourceLoader);
    return this.buildSnapshot(context);
  }

  async login(workspace: WorkspaceRef, providerId: string, callbacks: RuntimeLoginCallbacks): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const modelRuntime = await this.modelRuntime;
    const provider = modelRuntime.getProvider(providerId);
    if (!provider?.auth.oauth) {
      throw new Error(`OAuth login is not supported for ${providerId}.`);
    }
    await modelRuntime.login(providerId, "oauth", toPiAuthInteraction(callbacks));
    await reloadResourceLoaderWithoutPackageInstallation(context.resourceLoader);
    return this.buildSnapshot(context);
  }

  async logout(workspace: WorkspaceRef, providerId: string): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    await (await this.modelRuntime).logout(providerId);
    await reloadResourceLoaderWithoutPackageInstallation(context.resourceLoader);
    return this.buildSnapshot(context);
  }

  async setProviderApiKey(workspace: WorkspaceRef, providerId: string, apiKey: string): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const normalized = apiKey.trim();
    if (!normalized) {
      throw new Error("API key is required.");
    }
    if (!providerSupportsDesktopApiKeySetup(providerId)) {
      throw new Error(`API key setup is not supported for ${providerId}.`);
    }
    const modelRuntime = await this.modelRuntime;
    const provider = modelRuntime.getProvider(providerId);
    if (!provider?.auth.apiKey?.login) {
      throw new Error(`API key setup is not supported for ${providerId}.`);
    }
    await modelRuntime.login(providerId, "api_key", {
      prompt: async () => normalized,
      notify: () => {},
    });
    await reloadResourceLoaderWithoutPackageInstallation(context.resourceLoader);
    return this.buildSnapshot(context);
  }

  async listCustomProviders(): Promise<readonly CustomProviderEntry[]> {
    return this.customProviderStore.list();
  }

  async getModelConfiguration(): Promise<ModelConfigurationSnapshot> {
    const modelRuntime = await this.modelRuntime;
    await modelRuntime.reloadConfig();
    return this.readModelConfiguration();
  }

  private async readModelConfiguration(): Promise<ModelConfigurationSnapshot> {
    const [providerRecords, modelRecords, customProviders, globalSettings] = await Promise.all([
      this.buildProviderRecords(),
      this.buildModelRecords(),
      this.customProviderStore.list(),
      readJsonRecord(join(this.agentDir, "settings.json")),
    ]);
    const customById = new Map(customProviders.map((provider) => [provider.providerId, provider]));
    const providersById = new Map(providerRecords.map((provider) => [provider.id, provider]));
    const modelsByPattern = new Map(modelRecords.map((model) => [modelPattern(model.providerId, model.modelId), model]));
    const configuredPatterns = stringArray(globalSettings.enabledModels);
    const defaultProvider = stringValue(globalSettings.defaultProvider);
    const defaultModelId = stringValue(globalSettings.defaultModel);
    const effectiveConfiguredPatterns = configuredPatterns.length > 0
      ? configuredPatterns
      : [
          ...(defaultProvider && defaultModelId ? [modelPattern(defaultProvider, defaultModelId)] : []),
          ...modelRecords
            .filter((model) => model.available)
            .map((model) => modelPattern(model.providerId, model.modelId)),
        ].filter((pattern, index, patterns) => patterns.indexOf(pattern) === index);

    const models = effectiveConfiguredPatterns.map<ConfiguredModelRecord>((pattern) => {
      const ref = parseModelPattern(pattern);
      const runtimeModel = ref ? modelsByPattern.get(pattern) : undefined;
      const runtimeModelWithOverrides = runtimeModel as (typeof runtimeModel & { readonly contextWindow?: number; readonly maxTokens?: number; readonly thinkingLevels?: readonly NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>[] });
      const providerId = ref?.providerId ?? pattern;
      const modelId = ref?.modelId ?? pattern;
      const provider = providersById.get(providerId);
      const custom = customById.get(providerId);
      const customModel = custom?.models.find((model) => model.id === modelId);
      return {
        providerId,
        providerName: provider?.name ?? providerId,
        modelId,
        label: runtimeModel?.label ?? modelId,
        providerKind: custom ? "custom" : "builtin",
        ...(custom ? { baseUrl: custom.baseUrl } : {}),
        ...(custom ? { api: custom.api } : {}),
        available: runtimeModel?.available ?? false,
        authSource: provider?.authSource ?? "none",
        reasoning: runtimeModel?.reasoning ?? false,
        supportsImages: runtimeModel?.supportsImages ?? false,
        ...(runtimeModelWithOverrides?.thinkingLevels ? { thinkingLevels: runtimeModelWithOverrides.thinkingLevels } : {}),
        ...((customModel?.contextWindow ?? runtimeModelWithOverrides?.contextWindow) ? { contextWindow: customModel?.contextWindow ?? runtimeModelWithOverrides?.contextWindow } : {}),
        ...((customModel?.maxTokens ?? runtimeModelWithOverrides?.maxTokens) ? { maxTokens: customModel?.maxTokens ?? runtimeModelWithOverrides?.maxTokens } : {}),
        ...(customModel?.cost ? { cost: customModel.cost } : {}),
        isDefault: providerId === defaultProvider && modelId === defaultModelId,
      };
    });

    const suggestionsByProvider = new Map<string, { id: string; label: string }[]>();
    for (const model of modelRecords) {
      const suggestions = suggestionsByProvider.get(model.providerId) ?? [];
      suggestions.push({ id: model.modelId, label: model.label });
      suggestionsByProvider.set(model.providerId, suggestions);
    }
    const providerIds = new Set([
      ...providerRecords.map((provider) => provider.id),
      ...customProviders.map((provider) => provider.providerId),
    ]);
    const providers = [...providerIds].map<ModelConfigurationProviderPreset>((providerId) => {
      const provider = providersById.get(providerId);
      const custom = customById.get(providerId);
      return {
        id: providerId,
        name: provider?.name ?? providerId,
        kind: custom ? "custom" : "builtin",
        apiKeySetupSupported: custom ? true : (provider?.apiKeySetupSupported ?? false),
        authAvailable: provider?.hasAuth ?? Boolean(custom),
        authSource: provider?.authSource ?? (custom ? "external" : "none"),
        ...(custom ? { baseUrl: custom.baseUrl } : {}),
        ...(custom ? { api: custom.api } : {}),
        models: suggestionsByProvider.get(providerId) ?? custom?.models.map((model) => ({ id: model.id, label: model.id })) ?? [],
      };
    }).sort((left, right) => left.name.localeCompare(right.name));

    return {
      providers,
      models,
      ...(defaultProvider ? { defaultProvider } : {}),
      ...(defaultModelId ? { defaultModelId } : {}),
      ...(typeof globalSettings.defaultThinkingLevel === "string"
        ? { defaultThinkingLevel: globalSettings.defaultThinkingLevel as RuntimeSettingsSnapshot["defaultThinkingLevel"] }
        : {}),
    };
  }

  async saveModelConfiguration(input: SaveModelConfigurationInput): Promise<ModelConfigurationSnapshot> {
    const providerId = input.providerId.trim();
    const modelId = input.modelId.trim();
    if (!providerId || !modelId) throw new Error("Provider and model ID are required.");
    const modelRuntime = await this.modelRuntime;

    if (input.providerKind === "custom") {
      const existingCustomProvider = (await this.customProviderStore.list()).some(
        (provider) => provider.providerId === providerId,
      );
      if (!existingCustomProvider && (BUILT_IN_PROVIDER_IDS.has(providerId) || modelRuntime.getProvider(providerId))) {
        throw new Error(`Provider ID "${providerId}" conflicts with a built-in provider. Pick a unique ID.`);
      }
      const mutation: CustomProviderModelMutationInput = {
        providerId,
        baseUrl: input.baseUrl.trim(),
        ...(input.api ? { api: input.api } : {}),
        model: { id: modelId, ...modelFields(input) },
        ...(input.apiKey?.trim() ? { apiKey: input.apiKey.trim() } : {}),
      };
      await this.customProviderStore.upsertModel(mutation);
    } else {
      if (!BUILT_IN_PROVIDER_IDS.has(providerId) && !modelRuntime.getProvider(providerId)) {
        throw new Error(`Unknown built-in provider: ${providerId}`);
      }
      const knownModel = modelRuntime.getModel(providerId, modelId);
      if (!knownModel) await this.customProviderStore.upsertBuiltInModel(providerId, { id: modelId, ...modelFields(input) });
      if (input.apiKey?.trim()) await this.saveProviderApiKey(providerId, input.apiKey.trim());
    }

    await modelRuntime.reloadConfig();
    await updateGlobalSettings(this.agentDir, (settings) => {
      settings.enabledModels = mergeEnabledModelPatterns(stringArray(settings.enabledModels), [modelPattern(providerId, modelId)]);
      if (!stringValue(settings.defaultProvider) || !stringValue(settings.defaultModel)) {
        settings.defaultProvider = providerId;
        settings.defaultModel = modelId;
      }
    });
    return this.readModelConfiguration();
  }

  async deleteModelConfiguration(input: DeleteModelConfigurationInput): Promise<ModelConfigurationSnapshot> {
    const pattern = modelPattern(input.providerId, input.modelId);
    const before = await this.getModelConfiguration();
    const target = before.models.find((model) => model.providerId === input.providerId && model.modelId === input.modelId);
    if (!target) return before;
    const remaining = before.models.filter((model) => model !== target);
    const remainingForProvider = remaining.filter((model) => model.providerId === input.providerId);
    if (target.providerKind === "custom") {
      await this.customProviderStore.deleteModel(input.providerId, input.modelId);
    } else {
      await this.customProviderStore.deleteBuiltInModel(input.providerId, input.modelId);
      if (remainingForProvider.length === 0 && input.removeCredentialWhenUnused && target.authSource === "auth_file") {
        await (await this.modelRuntime).logout(input.providerId);
      }
    }
    await (await this.modelRuntime).reloadConfig();
    const fallback = remaining.find((model) => model.available);
    await updateGlobalSettings(this.agentDir, (settings) => {
      settings.enabledModels = stringArray(settings.enabledModels).filter((entry) => entry !== pattern);
      if (settings.defaultProvider === input.providerId && settings.defaultModel === input.modelId) {
        if (fallback) {
          settings.defaultProvider = fallback.providerId;
          settings.defaultModel = fallback.modelId;
        } else {
          delete settings.defaultProvider;
          delete settings.defaultModel;
        }
      }
    });
    return this.readModelConfiguration();
  }

  async setModelConfigurationDefaults(input: ModelConfigurationDefaultsInput): Promise<ModelConfigurationSnapshot> {
    await updateGlobalSettings(this.agentDir, (settings) => {
      if (input.providerId && input.modelId) {
        settings.defaultProvider = input.providerId;
        settings.defaultModel = input.modelId;
      } else if (input.providerId === "" || input.modelId === "") {
        delete settings.defaultProvider;
        delete settings.defaultModel;
      }
      if (input.thinkingLevel) settings.defaultThinkingLevel = input.thinkingLevel;
    });
    for (const context of this.contexts.values()) {
      context.settingsManager.reload();
    }
    return this.readModelConfiguration();
  }

  async migrateModelConfiguration(workspacePaths: readonly string[]): Promise<ModelConfigurationSnapshot> {
    const globalSettings = await readJsonRecord(join(this.agentDir, "settings.json"));
    const customProviders = await this.customProviderStore.list();
    const patterns = [...stringArray(globalSettings.enabledModels)];
    const defaults: { providerId: string; modelId: string }[] = [];
    const globalProvider = stringValue(globalSettings.defaultProvider);
    const globalModel = stringValue(globalSettings.defaultModel);
    if (globalProvider && globalModel) defaults.push({ providerId: globalProvider, modelId: globalModel });
    for (const workspacePath of workspacePaths) {
      const project = await readJsonRecord(join(workspacePath, ".pi", "settings.json"));
      patterns.push(...stringArray(project.enabledModels));
      const providerId = stringValue(project.defaultProvider);
      const modelId = stringValue(project.defaultModel);
      if (providerId && modelId) defaults.push({ providerId, modelId });
    }
    for (const provider of customProviders) {
      patterns.push(...provider.models.map((model) => modelPattern(provider.providerId, model.id)));
    }
    for (const selection of defaults) patterns.push(modelPattern(selection.providerId, selection.modelId));
    const merged = mergeEnabledModelPatterns([], patterns);
    await updateGlobalSettings(this.agentDir, (settings) => {
      settings.enabledModels = merged;
      if (!stringValue(settings.defaultProvider) || !stringValue(settings.defaultModel)) {
        const fallback = defaults[0];
        if (fallback) {
          settings.defaultProvider = fallback.providerId;
          settings.defaultModel = fallback.modelId;
        }
      }
    });
    const migrated = await this.getModelConfiguration();
    if (migrated.defaultProvider && migrated.defaultModelId) return migrated;
    const fallback = migrated.models.find((model) => model.available);
    if (!fallback) return migrated;
    await updateGlobalSettings(this.agentDir, (settings) => {
      settings.defaultProvider = fallback.providerId;
      settings.defaultModel = fallback.modelId;
    });
    return this.getModelConfiguration();
  }

  private async saveProviderApiKey(providerId: string, apiKey: string): Promise<void> {
    if (!providerSupportsDesktopApiKeySetup(providerId)) {
      throw new Error(`API key setup is not supported for ${providerId}.`);
    }
    const modelRuntime = await this.modelRuntime;
    const provider = modelRuntime.getProvider(providerId);
    if (!provider?.auth.apiKey?.login) throw new Error(`API key setup is not supported for ${providerId}.`);
    await modelRuntime.login(providerId, "api_key", { prompt: async () => apiKey, notify: () => {} });
  }

  async setCustomProvider(workspace: WorkspaceRef, input: CustomProviderInput): Promise<RuntimeSnapshot> {
    const providerIds = new Set((await this.modelRuntime).getProviders().map((provider) => provider.id));
    if (BUILT_IN_PROVIDER_IDS.has(input.providerId) || providerIds.has(input.providerId)) {
      throw new Error(
        `Provider ID "${input.providerId}" conflicts with a built-in provider. Pick a unique ID.`,
      );
    }
    const context = await this.ensureContext(workspace);
    await this.customProviderStore.set(input);
    await (await this.modelRuntime).reloadConfig();
    await reloadResourceLoaderWithoutPackageInstallation(context.resourceLoader);
    return this.buildSnapshot(context);
  }

  async deleteCustomProvider(workspace: WorkspaceRef, providerId: string): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    await this.customProviderStore.delete(providerId);
    await (await this.modelRuntime).reloadConfig();
    await reloadResourceLoaderWithoutPackageInstallation(context.resourceLoader);
    return this.buildSnapshot(context);
  }

  async setDefaultModel(
    workspace: WorkspaceRef,
    selection: {
      readonly provider: string;
      readonly modelId: string;
    },
  ): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    context.settingsManager.setDefaultModelAndProvider(selection.provider, selection.modelId);
    await context.settingsManager.flush();
    return this.buildSnapshot(context);
  }

  async setProjectDefaultModel(
    workspace: WorkspaceRef,
    selection: {
      readonly provider: string;
      readonly modelId: string;
    },
  ): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const settingsManager = context.settingsManager as unknown as ProjectWritableSettingsManager;
    const projectSettings = context.settingsManager.getProjectSettings() as Record<string, unknown>;
    projectSettings.defaultProvider = selection.provider;
    projectSettings.defaultModel = selection.modelId;
    settingsManager.markProjectModified("defaultProvider");
    settingsManager.markProjectModified("defaultModel");
    settingsManager.saveProjectSettings(projectSettings);
    await context.settingsManager.flush();
    context.settingsManager.reload();
    return this.buildSnapshot(context);
  }

  async setDefaultThinkingLevel(
    workspace: WorkspaceRef,
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    if (!thinkingLevel) {
      throw new Error("Thinking level is required.");
    }
    context.settingsManager.setDefaultThinkingLevel(thinkingLevel);
    await context.settingsManager.flush();
    return this.buildSnapshot(context);
  }

  async setProjectDefaultThinkingLevel(
    workspace: WorkspaceRef,
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    if (!thinkingLevel) {
      throw new Error("Thinking level is required.");
    }
    const settingsManager = context.settingsManager as unknown as ProjectWritableSettingsManager;
    const projectSettings = context.settingsManager.getProjectSettings() as Record<string, unknown>;
    projectSettings.defaultThinkingLevel = thinkingLevel;
    settingsManager.markProjectModified("defaultThinkingLevel");
    settingsManager.saveProjectSettings(projectSettings);
    await context.settingsManager.flush();
    context.settingsManager.reload();
    return this.buildSnapshot(context);
  }

  async setEnableSkillCommands(workspace: WorkspaceRef, enabled: boolean): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    context.settingsManager.setEnableSkillCommands(enabled);
    await context.settingsManager.flush();
    await reloadResourceLoaderWithoutPackageInstallation(context.resourceLoader);
    return this.buildSnapshot(context);
  }

  async setScopedModelPatterns(workspace: WorkspaceRef, patterns: readonly string[]): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    context.settingsManager.setEnabledModels(patterns.length > 0 ? [...patterns] : undefined);
    await context.settingsManager.flush();
    return this.buildSnapshot(context);
  }

  async setProjectScopedModelPatterns(workspace: WorkspaceRef, patterns: readonly string[]): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const settingsManager = context.settingsManager as unknown as ProjectWritableSettingsManager;
    const projectSettings = context.settingsManager.getProjectSettings() as Record<string, unknown>;
    projectSettings.enabledModels = patterns.length > 0 ? [...patterns] : undefined;
    settingsManager.markProjectModified("enabledModels");
    settingsManager.saveProjectSettings(projectSettings);
    await context.settingsManager.flush();
    context.settingsManager.reload();
    return this.buildSnapshot(context);
  }

  async getGlobalModelSettings(workspace: WorkspaceRef): Promise<ModelSettingsSnapshot> {
    const context = await this.ensureContext(workspace);
    const settings = context.settingsManager.getGlobalSettings() as Record<string, unknown>;
    return toModelSettingsSnapshot(settings);
  }

  async getCurrentModelSettings(workspace: WorkspaceRef): Promise<ModelSettingsSnapshot> {
    const globalSettings = await readJsonRecord(join(this.agentDir, "settings.json"));
    const projectSettings = await readJsonRecord(join(workspace.path, ".pi", "settings.json"));
    const globalModelSettings = toModelSettingsSnapshot(globalSettings);
    const projectModelSettings = toModelSettingsSnapshot(projectSettings);
    const snapshot: {
      defaultProvider?: string;
      defaultModelId?: string;
      defaultThinkingLevel?: ModelSettingsSnapshot["defaultThinkingLevel"];
      enabledModelPatterns: readonly string[];
    } = {
      enabledModelPatterns: Array.isArray(projectSettings.enabledModels)
        ? projectModelSettings.enabledModelPatterns
        : globalModelSettings.enabledModelPatterns,
    };

    if (Object.prototype.hasOwnProperty.call(projectSettings, "defaultProvider")) {
      if (projectModelSettings.defaultProvider) {
        snapshot.defaultProvider = projectModelSettings.defaultProvider;
      }
    } else if (globalModelSettings.defaultProvider) {
      snapshot.defaultProvider = globalModelSettings.defaultProvider;
    }

    if (Object.prototype.hasOwnProperty.call(projectSettings, "defaultModel")) {
      if (projectModelSettings.defaultModelId) {
        snapshot.defaultModelId = projectModelSettings.defaultModelId;
      }
    } else if (globalModelSettings.defaultModelId) {
      snapshot.defaultModelId = globalModelSettings.defaultModelId;
    }

    if (Object.prototype.hasOwnProperty.call(projectSettings, "defaultThinkingLevel")) {
      if (projectModelSettings.defaultThinkingLevel) {
        snapshot.defaultThinkingLevel = projectModelSettings.defaultThinkingLevel;
      }
    } else if (globalModelSettings.defaultThinkingLevel) {
      snapshot.defaultThinkingLevel = globalModelSettings.defaultThinkingLevel;
    }

    return snapshot;
  }

  async setSkillEnabled(workspace: WorkspaceRef, filePath: string, enabled: boolean): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const resolvedPaths = await this.resolveRuntimePaths(context);
    const resource = resolvedPaths.skills.find((entry) => resolve(entry.path) === resolve(filePath));
    if (!resource) {
      throw new Error(`Unknown skill: ${filePath}`);
    }

    this.toggleResource(context, resource, enabled, "skill");
    await context.settingsManager.flush();
    await reloadResourceLoaderWithoutPackageInstallation(context.resourceLoader);
    return this.buildSnapshot(context);
  }

  async setExtensionEnabled(workspace: WorkspaceRef, filePath: string, enabled: boolean): Promise<RuntimeSnapshot> {
    const context = await this.ensureContext(workspace);
    const resolvedPaths = await this.resolveRuntimePaths(context);
    const resource = resolvedPaths.extensions.find((entry) => resolve(entry.path) === resolve(filePath));
    if (!resource) {
      throw new Error(`Unknown extension: ${filePath}`);
    }

    this.toggleResource(context, resource, enabled, "extension");
    await context.settingsManager.flush();
    await reloadResourceLoaderWithoutPackageInstallation(context.resourceLoader);
    return this.buildSnapshot(context);
  }

  private async ensureContext(workspace: WorkspaceRef): Promise<RuntimeContext> {
    const existing = this.contexts.get(workspace.workspaceId);
    if (existing) {
      return existing;
    }

    let settingsManager = SettingsManager.create(workspace.path, this.agentDir);
    let packageManager = new DefaultPackageManager({
      cwd: workspace.path,
      agentDir: this.agentDir,
      settingsManager,
    });
    let resourceLoader = new DefaultResourceLoader({
      cwd: workspace.path,
      agentDir: this.agentDir,
      settingsManager,
      extensionFactories: [...this.extensionFactories],
    });
    try {
      await reloadResourceLoaderWithoutPackageInstallation(resourceLoader);
    } catch (error) {
      if (!isGlobalNpmLookupError(error)) {
        throw error;
      }

      const fallbackSettingsManager = createSettingsManagerWithoutNpmPackages(settingsManager);
      if (!fallbackSettingsManager) {
        throw error;
      }

      console.warn(
        `[pi-gui] Falling back to runtime resource loading without npm package sources for ${workspace.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      settingsManager = fallbackSettingsManager;
      packageManager = new DefaultPackageManager({
        cwd: workspace.path,
        agentDir: this.agentDir,
        settingsManager,
      });
      resourceLoader = new DefaultResourceLoader({
        cwd: workspace.path,
        agentDir: this.agentDir,
        settingsManager,
        extensionFactories: [...this.extensionFactories],
      });
      await reloadResourceLoaderWithoutPackageInstallation(resourceLoader);
    }

    const context: RuntimeContext = {
      workspace,
      settingsManager,
      packageManager,
      resourceLoader,
    };
    this.contexts.set(workspace.workspaceId, context);
    return context;
  }

  private async buildSnapshot(context: RuntimeContext): Promise<RuntimeSnapshot> {
    const resolvedPaths = await this.resolveRuntimePaths(context);
    const [skills, extensions, providers, models] = await Promise.all([
      this.buildSkillRecords(context, resolvedPaths.skills),
      this.buildExtensionRecords(context, resolvedPaths.extensions),
      this.buildProviderRecords(),
      this.buildModelRecords(),
    ]);

    const defaultProvider = context.settingsManager.getDefaultProvider();
    const defaultModelId = context.settingsManager.getDefaultModel();
    const defaultThinkingLevel = context.settingsManager.getDefaultThinkingLevel();
    const enabledModelPatterns = context.settingsManager.getEnabledModels() ?? [];
    const settings: RuntimeSettingsSnapshot = {
      ...(defaultProvider ? { defaultProvider } : {}),
      ...(defaultModelId ? { defaultModelId } : {}),
      ...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
      enableSkillCommands: context.settingsManager.getEnableSkillCommands(),
      enabledModelPatterns,
    };

    return {
      workspace: context.workspace,
      providers,
      models,
      skills,
      extensions,
      settings,
    };
  }

  private async resolveRuntimePaths(context: RuntimeContext): Promise<ResolvedPaths> {
    try {
      return await withPackageInstallationDisabled(() => context.packageManager.resolve());
    } catch (error) {
      if (!isGlobalNpmLookupError(error)) {
        throw error;
      }

      const fallbackSettingsManager = createSettingsManagerWithoutNpmPackages(context.settingsManager);
      if (!fallbackSettingsManager) {
        throw error;
      }

      console.warn(
        `[pi-gui] Falling back to runtime package resolution without npm package sources for ${context.workspace.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      const fallbackPackageManager = new DefaultPackageManager({
        cwd: context.workspace.path,
        agentDir: this.agentDir,
        settingsManager: fallbackSettingsManager,
      });
      return withPackageInstallationDisabled(() => fallbackPackageManager.resolve());
    }
  }

  private async buildProviderRecords(): Promise<readonly RuntimeProviderRecord[]> {
    const modelRuntime = await this.modelRuntime;
    const credentials = new Map((await modelRuntime.listCredentials()).map((credential) => [credential.providerId, credential]));
    const runtimeProviders = new Map(modelRuntime.getProviders().map((provider) => [provider.id, provider]));
    const providerIds = new Set<string>([
      ...modelRuntime.getModels().map((model) => model.provider),
      ...runtimeProviders.keys(),
      ...credentials.keys(),
    ]);

    return Promise.all([...providerIds]
      .sort((left, right) => left.localeCompare(right))
      .map(async (providerId) => {
        const credential = credentials.get(providerId);
        const provider = runtimeProviders.get(providerId);
        const apiKeySetupSupported = providerSupportsDesktopApiKeySetup(providerId);
        const providerAuthStatus = modelRuntime.getProviderAuthStatus(providerId);
        const hasAuth = providerAuthStatus.configured || Boolean(await modelRuntime.checkAuth(providerId));
        return {
          id: providerId,
          name: provider?.name ?? providerId,
          hasAuth,
          authType: credential?.type ?? "none",
          authSource: inferProviderAuthSource(credential, providerAuthStatus, apiKeySetupSupported),
          oauthSupported: Boolean(provider?.auth.oauth),
          apiKeySetupSupported,
        };
      }));
  }

  private async buildModelRecords(): Promise<readonly RuntimeModelRecord[]> {
    const modelRuntime = await this.modelRuntime;
    const availableKeys = new Set(
      (await modelRuntime.getAvailable()).map((model) => `${model.provider}:${model.id}`),
    );
    const providers = new Map((await this.buildProviderRecords()).map((provider) => [provider.id, provider]));

    return modelRuntime
      .getModels()
      .map<RuntimeModelRecord>((model) => {
        const provider = providers.get(model.provider);
        return {
          providerId: model.provider,
          providerName: provider?.name ?? model.provider,
          modelId: model.id,
          label: model.name,
          available: availableKeys.has(`${model.provider}:${model.id}`),
          authType: provider?.authType ?? "none",
          reasoning: Boolean(model.reasoning),
          supportsImages: model.input.includes("image"),
          thinkingLevels: thinkingLevelsForModel(model),
          ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
          ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
        };
      })
      .sort((left, right) =>
        left.providerId === right.providerId
          ? left.modelId.localeCompare(right.modelId)
          : left.providerId.localeCompare(right.providerId),
      );
  }

  private async buildSkillRecords(
    context: RuntimeContext,
    resolvedSkills: readonly ResolvedResource[],
  ): Promise<readonly RuntimeSkillRecord[]> {
    const loadedSkills = new Map(
      context.resourceLoader
        .getSkills()
        .skills.map((skill) => [resolve(skill.filePath), skill] as const),
    );

    const records = await Promise.all(
      resolvedSkills.map(async (resource) => {
        const filePath = resolve(resource.path);
        const loaded = loadedSkills.get(filePath);
        const fallback = loaded ? undefined : await readSkillMetadata(filePath);
        const name = loaded?.name ?? fallback?.name ?? inferSkillName(filePath);
        const description = loaded?.description ?? fallback?.description ?? "No description provided.";
        const disableModelInvocation = loaded?.disableModelInvocation ?? fallback?.disableModelInvocation ?? false;

        return {
          name,
          description,
          filePath,
          baseDir: loaded?.baseDir ?? dirname(filePath),
          source: resource.metadata.source,
          enabled: resource.enabled,
          disableModelInvocation,
          slashCommand: skillSlashCommand(name),
        } satisfies RuntimeSkillRecord;
      }),
    );

    return records.sort((left: RuntimeSkillRecord, right: RuntimeSkillRecord) => left.name.localeCompare(right.name));
  }

  private async buildExtensionRecords(
    context: RuntimeContext,
    resolvedExtensions: readonly ResolvedResource[],
  ): Promise<readonly RuntimeExtensionRecord[]> {
    const loadedResult = context.resourceLoader.getExtensions();
    const packageMetadataCache = new Map<string, Promise<PackageMetadata>>();
    const loadedByPath = new Map(
      loadedResult.extensions.map((extension) => [resolve(extension.resolvedPath || extension.path), extension] as const),
    );
    const diagnosticsByPath = new Map<string, RuntimeExtensionDiagnostic[]>();

    for (const error of loadedResult.errors) {
      const diagnostics = diagnosticsByPath.get(resolve(error.path)) ?? [];
      diagnostics.push({
        type: "error",
        message: error.error,
        path: error.path,
      });
      diagnosticsByPath.set(resolve(error.path), diagnostics);
    }

    const records = await Promise.all(
      resolvedExtensions.map<Promise<RuntimeExtensionRecord>>(async (resource) => {
        const path = resolve(resource.path);
        const loaded = loadedByPath.get(path);
        const packageMetadata = await inferExtensionPackageMetadata(resource.metadata, packageMetadataCache);
        return {
          path,
          displayName: packageMetadata?.displayName ?? inferExtensionEntryName(path),
          ...(packageMetadata?.description ? { description: packageMetadata.description } : {}),
          enabled: resource.enabled,
          sourceInfo: toRuntimeSourceInfo(path, resource.metadata),
          commands: loaded ? [...loaded.commands.keys()].sort((left, right) => left.localeCompare(right)) : [],
          tools: loaded
            ? [...loaded.tools.values()]
                .map((tool) => tool.definition.name)
                .sort((left, right) => left.localeCompare(right))
            : [],
          flags: loaded ? [...loaded.flags.keys()].sort((left, right) => left.localeCompare(right)) : [],
          shortcuts: loaded ? [...loaded.shortcuts.keys()].sort((left, right) => left.localeCompare(right)) : [],
          diagnostics: diagnosticsByPath.get(path) ?? [],
        };
      }),
    );
    const resolvedRecordPaths = new Set(records.map((record) => resolve(record.path)));
    const inlineRecords = loadedResult.extensions
      .filter((extension) => extension.path.startsWith("<inline:") && !resolvedRecordPaths.has(resolve(extension.path)))
      .map((extension) => this.buildInlineExtensionRecord(extension));
    records.push(...inlineRecords);

    return records.sort((left, right) =>
      left.displayName === right.displayName
        ? left.path.localeCompare(right.path)
        : left.displayName.localeCompare(right.displayName),
    );
  }

  private buildInlineExtensionRecord(extension: ReturnType<DefaultResourceLoader["getExtensions"]>["extensions"][number]): RuntimeExtensionRecord {
    const metadata = inlineExtensionMetadataForPath(extension.path, this.inlineExtensionMetadata);
    return {
      path: extension.path,
      displayName: metadata.displayName,
      ...(metadata.description ? { description: metadata.description } : {}),
      enabled: true,
      sourceInfo: {
        path: extension.path,
        source: "builtin",
        scope: "temporary",
        origin: "top-level",
      },
      commands: [...extension.commands.keys()].sort((left, right) => left.localeCompare(right)),
      tools: [...extension.tools.values()]
        .map((tool) => tool.definition.name)
        .sort((left, right) => left.localeCompare(right)),
      flags: [...extension.flags.keys()].sort((left, right) => left.localeCompare(right)),
      shortcuts: [...extension.shortcuts.keys()].sort((left, right) => left.localeCompare(right)),
      diagnostics: [],
    };
  }

  private toggleResource(
    context: RuntimeContext,
    resource: ResolvedResource,
    enabled: boolean,
    kind: ToggleableResourceKind,
  ): void {
    const { settingsManager } = context;
    const scope = resource.metadata.scope;
    if (scope !== "project" && scope !== "user") {
      throw new Error(`Cannot update ${kind} at scope ${scope}`);
    }
    const origin = resource.metadata.origin;
    const settings = scope === "project" ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();
    const pattern = this.relativeResourcePattern(resource.path, resource.metadata, scope, origin);

    if (origin === "top-level") {
      const currentPaths = kind === "skill" ? [...(settings.skills ?? [])] : [...(settings.extensions ?? [])];
      const updated = replaceResourcePattern(currentPaths, pattern, enabled);
      this.setTopLevelResourcePaths(settingsManager, scope, kind, updated);
      return;
    }

    const packages = [...(settings.packages ?? [])];
    const source = resource.metadata.source;
    const packageIndex = packages.findIndex((entry) => (typeof entry === "string" ? entry : entry.source) === source);
    if (packageIndex < 0) {
      throw new Error(`${titleForResourceKind(kind)} package source not found for ${resource.path}`);
    }

    const currentPackage = packages[packageIndex];
    const nextPackage = typeof currentPackage === "string" ? { source: currentPackage } : { ...currentPackage };
    const currentPatterns = kind === "skill" ? [...(nextPackage.skills ?? [])] : [...(nextPackage.extensions ?? [])];
    const updatedPatterns = replaceResourcePattern(currentPatterns, pattern, enabled);
    if (updatedPatterns.length > 0) {
      if (kind === "skill") {
        nextPackage.skills = updatedPatterns;
      } else {
        nextPackage.extensions = updatedPatterns;
      }
    } else {
      if (kind === "skill") {
        delete nextPackage.skills;
      } else {
        delete nextPackage.extensions;
      }
    }

    const hasFilters = ["skills", "extensions", "prompts", "themes"].some((key) =>
      Object.prototype.hasOwnProperty.call(nextPackage, key),
    );
    packages[packageIndex] = (hasFilters ? nextPackage : nextPackage.source) as PackageSource;

    if (scope === "project") {
      settingsManager.setProjectPackages(packages);
    } else {
      settingsManager.setPackages(packages);
    }
  }

  private setTopLevelResourcePaths(
    settingsManager: SettingsManager,
    scope: ResourceScope,
    kind: ToggleableResourceKind,
    paths: string[],
  ): void {
    if (kind === "skill") {
      if (scope === "project") {
        settingsManager.setProjectSkillPaths(paths);
      } else {
        settingsManager.setSkillPaths(paths);
      }
      return;
    }

    if (scope === "project") {
      settingsManager.setProjectExtensionPaths(paths);
    } else {
      settingsManager.setExtensionPaths(paths);
    }
  }

  private relativeResourcePattern(
    filePath: string,
    metadata: PathMetadata,
    scope: ResourceScope,
    origin: PathMetadata["origin"],
  ): string {
    if (origin === "package") {
      const baseDir = metadata.baseDir ?? dirname(filePath);
      return relative(baseDir, filePath);
    }

    const baseDir = metadata.baseDir ?? (scope === "project" ? dirname(filePath) : this.agentDir);
    return relative(baseDir, filePath);
  }
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function replaceResourcePattern(patterns: readonly string[], resourcePattern: string, enabled: boolean): string[] {
  const next = patterns.filter((pattern) => stripPrefix(pattern) !== resourcePattern);
  next.push(`${enabled ? "+" : "-"}${resourcePattern}`);
  return next;
}

function stripPrefix(pattern: string): string {
  return pattern.startsWith("+") || pattern.startsWith("-") || pattern.startsWith("!") ? pattern.slice(1) : pattern;
}

async function readSkillMetadata(
  filePath: string,
): Promise<{ name?: string; description?: string; disableModelInvocation?: boolean } | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    const frontmatter = parseFrontmatter(raw) as
      | {
          name?: string;
          description?: string;
          "disable-model-invocation"?: boolean;
        }
      | undefined;
    const body = stripFrontmatter(raw);
    const metadata: { name?: string; description?: string; disableModelInvocation?: boolean } = {};
    if (frontmatter?.name) {
      metadata.name = frontmatter.name;
    }
    const description = frontmatter?.description ?? firstNonEmptyLine(body);
    if (description) {
      metadata.description = description;
    }
    if (frontmatter?.["disable-model-invocation"] !== undefined) {
      metadata.disableModelInvocation = frontmatter["disable-model-invocation"];
    }
    return metadata;
  } catch {
    return undefined;
  }
}

function inferSkillName(filePath: string): string {
  const parent = basename(dirname(filePath));
  if (basename(filePath).toLowerCase() === "skill.md" && parent) {
    return parent;
  }
  return basename(filePath).replace(/\.md$/i, "");
}

async function inferExtensionPackageMetadata(
  metadata: PathMetadata,
  packageMetadataCache: Map<string, Promise<PackageMetadata>>,
): Promise<PackageMetadata | undefined> {
  if (metadata.origin === "package" && metadata.baseDir) {
    return inferPackageMetadata(metadata.baseDir, packageMetadataCache);
  }
  return undefined;
}

function inferExtensionEntryName(filePath: string): string {
  return basename(filePath).replace(/\.(c|m)?(t|j)sx?$/i, "");
}

async function inferPackageMetadata(
  packageRoot: string,
  packageMetadataCache: Map<string, Promise<PackageMetadata>>,
): Promise<PackageMetadata> {
  const normalizedRoot = resolve(packageRoot);
  const cached = packageMetadataCache.get(normalizedRoot);
  if (cached) {
    return cached;
  }

  const pending = readPackageMetadata(normalizedRoot);
  packageMetadataCache.set(normalizedRoot, pending);
  return pending;
}

async function readPackageMetadata(packageRoot: string): Promise<PackageMetadata> {
  const folderName = basename(packageRoot).trim();
  const packageJson = await readJsonRecord(join(packageRoot, "package.json")) as {
    readonly displayName?: unknown;
    readonly description?: unknown;
  };
  const displayName =
    typeof packageJson.displayName === "string" && packageJson.displayName.trim()
      ? packageJson.displayName.trim()
      : folderName;
  const description =
    typeof packageJson.description === "string" && packageJson.description.trim()
      ? packageJson.description.trim()
      : undefined;

  return {
    ...(displayName ? { displayName } : {}),
    ...(description ? { description } : {}),
  };
}

const DESKTOP_API_KEY_PROVIDER_IDS = new Set([
  "azure-openai-responses",
  "cerebras",
  "google",
  "groq",
  "huggingface",
  "kimi-coding",
  "minimax",
  "minimax-cn",
  "mistral",
  "openai",
  "opencode",
  "opencode-go",
  "openrouter",
  "vercel-ai-gateway",
  "xai",
  "zai",
]);

function providerSupportsDesktopApiKeySetup(providerId: string): boolean {
  return DESKTOP_API_KEY_PROVIDER_IDS.has(providerId);
}

type PiAuthInteraction = Parameters<ModelRuntime["login"]>[2];

function toPiAuthInteraction(callbacks: RuntimeLoginCallbacks): PiAuthInteraction {
  return {
    prompt: async (prompt) => {
      if (prompt.type === "manual_code" && callbacks.onManualCodeInput) {
        return callbacks.onManualCodeInput();
      }
      if (prompt.type === "select") {
        const defaultOption = prompt.options[0];
        const choice = await callbacks.onPrompt({
          message: `${prompt.message}\n${prompt.options.map((option, index) => `${index + 1}. ${option.label}`).join("\n")}`,
          allowEmpty: true,
          ...(defaultOption ? { placeholder: defaultOption.label } : {}),
        });
        const normalizedChoice = choice.trim();
        if (!normalizedChoice) {
          return defaultOption?.id ?? "";
        }
        const selectedIndex = Number.parseInt(normalizedChoice, 10);
        return Number.isInteger(selectedIndex) && selectedIndex >= 1 && selectedIndex <= prompt.options.length
          ? prompt.options[selectedIndex - 1]?.id ?? ""
          : prompt.options.find((option) => option.id === normalizedChoice || option.label === normalizedChoice)?.id ??
              normalizedChoice;
      }
      return callbacks.onPrompt({
        message: prompt.message,
        ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
        allowEmpty: prompt.type === "manual_code",
      });
    },
    notify: (event) => {
      if (event.type === "auth_url") {
        void callbacks.onAuth({
          url: event.url,
          ...(event.instructions ? { instructions: event.instructions } : {}),
        });
      }
      if (event.type === "device_code") {
        void callbacks.onAuth({
          url: event.verificationUri,
          instructions: [
            `Enter code: ${event.userCode}`,
            event.expiresInSeconds ? `Expires in ${event.expiresInSeconds} seconds.` : undefined,
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n"),
        });
      }
      if (event.type === "progress" && callbacks.onProgress) void callbacks.onProgress(event.message);
      if (event.type === "info" && callbacks.onProgress) void callbacks.onProgress(event.message);
    },
    ...(callbacks.signal ? { signal: callbacks.signal } : {}),
  };
}

type ModelRuntimeAuthStatus = ReturnType<ModelRuntime["getProviderAuthStatus"]>;

function inferProviderAuthSource(
  auth: { readonly type: "oauth" | "api_key" } | undefined,
  providerAuthStatus: ModelRuntimeAuthStatus,
  apiKeySetupSupported: boolean,
): "none" | "oauth" | "auth_file" | "env" | "external" {
  if (auth?.type === "oauth") {
    return "oauth";
  }
  if (auth?.type === "api_key") {
    return "auth_file";
  }
  switch (providerAuthStatus.source) {
    case "stored":
      return "auth_file";
    case "environment":
      return "env";
    case "fallback":
    case "models_json_command":
    case "models_json_key":
    case "runtime":
      return "external";
  }
  if (!providerAuthStatus.configured) {
    return "none";
  }
  return apiKeySetupSupported ? "env" : "external";
}

function toRuntimeSourceInfo(path: string, metadata: PathMetadata): RuntimeSourceInfo {
  return {
    path,
    source: metadata.source,
    scope: metadata.scope,
    origin: metadata.origin,
    ...(metadata.baseDir ? { baseDir: metadata.baseDir } : {}),
  };
}

function inlineExtensionMetadataForPath(
  path: string,
  metadata: readonly RuntimeInlineExtensionMetadata[],
): RuntimeInlineExtensionMetadata {
  const match = /^<inline:(\d+)>$/.exec(path);
  const index = match?.[1] ? Number.parseInt(match[1], 10) - 1 : -1;
  return metadata[index] ?? { displayName: path };
}

function titleForResourceKind(kind: ToggleableResourceKind): string {
  return kind === "skill" ? "Skill" : "Extension";
}

function toModelSettingsSnapshot(settings: Record<string, unknown>): ModelSettingsSnapshot {
  return {
    enabledModelPatterns: Array.isArray(settings.enabledModels)
      ? settings.enabledModels.filter((value): value is string => typeof value === "string")
      : [],
    ...(typeof settings.defaultProvider === "string" ? { defaultProvider: settings.defaultProvider } : {}),
    ...(typeof settings.defaultModel === "string" ? { defaultModelId: settings.defaultModel } : {}),
    ...(typeof settings.defaultThinkingLevel === "string"
      ? { defaultThinkingLevel: settings.defaultThinkingLevel as ModelSettingsSnapshot["defaultThinkingLevel"] }
      : {}),
  } satisfies ModelSettingsSnapshot;
}

function mergeEnabledModelPatterns(
  existingPatterns: readonly string[],
  providerPatterns: readonly string[],
): readonly string[] {
  const merged = [...existingPatterns];
  const seen = new Set(existingPatterns);
  for (const pattern of providerPatterns) {
    if (seen.has(pattern)) {
      continue;
    }
    seen.add(pattern);
    merged.push(pattern);
  }
  return merged;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function modelPattern(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

function modelFields(input: SaveModelConfigurationInput): Omit<CustomProviderModelInput, "id"> {
  return {
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
    ...(input.thinkingLevelMap ? { thinkingLevelMap: input.thinkingLevelMap } : {}),
    ...(input.input?.length ? { input: input.input } : {}),
    ...(input.contextWindow !== undefined ? { contextWindow: input.contextWindow } : {}),
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    ...(input.cost ? { cost: input.cost } : {}),
  };
}

type ThinkingLevel = NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>;
const THINKING_LEVEL_ORDER: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function thinkingLevelsForModel(model: { readonly reasoning: boolean; readonly thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>> }): readonly ThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  const map = model.thinkingLevelMap;
  return THINKING_LEVEL_ORDER.filter((level) => {
    if (map?.[level] === null) return false;
    if (level === "xhigh" || level === "max") return map?.[level] != null;
    return true;
  });
}

function parseModelPattern(pattern: string): { readonly providerId: string; readonly modelId: string } | undefined {
  const separator = pattern.indexOf("/");
  if (separator <= 0 || separator === pattern.length - 1) return undefined;
  return { providerId: pattern.slice(0, separator), modelId: pattern.slice(separator + 1) };
}

async function withPackageInstallationDisabled<T>(action: () => Promise<T>): Promise<T> {
  const previous = process.env.PI_OFFLINE;
  process.env.PI_OFFLINE = "1";
  try {
    return await action();
  } finally {
    if (previous === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previous;
  }
}

async function reloadResourceLoaderWithoutPackageInstallation(
  resourceLoader: DefaultResourceLoader,
): Promise<void> {
  await withPackageInstallationDisabled(() => resourceLoader.reload());
}

async function updateGlobalSettings(agentDir: string, mutate: (settings: Record<string, unknown>) => void): Promise<void> {
  const path = join(agentDir, "settings.json");
  const settings = await readJsonRecord(path);
  mutate(settings);
  await writeJsonFileAtomic(path, settings);
}

function firstNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}
