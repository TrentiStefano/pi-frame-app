import { readFile } from "node:fs/promises";
import { writeJsonFileAtomic } from "./atomic-write.js";
import {
  BUILT_IN_PROVIDER_IDS,
  CUSTOM_PROVIDER_APIS,
  CUSTOM_PROVIDER_ID_PATTERN,
  CUSTOM_PROVIDER_PLACEHOLDER_API_KEY,
  isValidHttpBaseUrl,
  OPENAI_COMPLETIONS_API,
  PI_GUI_CUSTOM_PROVIDER_MARKER,
  PI_GUI_CONFIGURED_MODEL_MARKER,
  type CustomProviderEntry,
  type CustomProviderApi,
  type CustomProviderThinkingLevel,
  type CustomProviderInput,
  type CustomProviderModelMutationInput,
  type CustomProviderModelInput,
} from "./custom-provider-types.js";

export type {
  CustomProviderApi,
  CustomProviderEntry,
  CustomProviderInput,
  CustomProviderThinkingLevel,
  CustomProviderModelInput,
  CustomProviderModelMutationInput,
} from "./custom-provider-types.js";
export {
  BUILT_IN_PROVIDER_IDS,
  CUSTOM_PROVIDER_ID_PATTERN,
  CUSTOM_PROVIDER_PLACEHOLDER_API_KEY,
  isValidHttpBaseUrl,
  OPENAI_COMPLETIONS_API,
  PI_GUI_CUSTOM_PROVIDER_MARKER,
  PI_GUI_CONFIGURED_MODEL_MARKER,
} from "./custom-provider-types.js";

export class CustomProviderStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly modelsJsonPath: string) {}

  async list(): Promise<readonly CustomProviderEntry[]> {
    return this.enqueue(async () => {
      const data = await readModelsJson(this.modelsJsonPath);
      return readCustomProviders(data);
    });
  }

  async set(input: CustomProviderInput): Promise<void> {
    validateInput(input);
    await this.enqueue(async () => {
      const data = await readModelsJson(this.modelsJsonPath);
      const providers = ensureProvidersRecord(data);
      const existing = providers[input.providerId];
      if (existing && typeof existing === "object" && !isPiGuiCustomProviderConfig(input.providerId, existing as Record<string, unknown>)) {
        throw new Error(
          `Provider ID "${input.providerId}" already exists in models.json and is not managed by this desktop app.`,
        );
      }
      providers[input.providerId] = toProviderConfig(input);
      await atomicWriteJson(this.modelsJsonPath, data);
    });
  }

  async upsertModel(input: CustomProviderModelMutationInput): Promise<void> {
    validateProviderIdentity(input.providerId, input.baseUrl);
    validateModel(input.model);
    await this.enqueue(async () => {
      const data = await readModelsJson(this.modelsJsonPath);
      const providers = ensureProvidersRecord(data);
      const existing = providers[input.providerId];
      if (existing && (typeof existing !== "object" || !isPiGuiCustomProviderConfig(input.providerId, existing as Record<string, unknown>))) {
        throw new Error(
          `Provider ID "${input.providerId}" already exists in models.json and is not managed by this desktop app.`,
        );
      }
      const config = existing && typeof existing === "object" ? { ...(existing as Record<string, unknown>) } : {};
      const currentModels = Array.isArray(config.models) ? [...config.models] : [];
      const modelIndex = currentModels.findIndex((entry) => modelIdFromUnknown(entry) === input.model.id);
      const previousModel = modelIndex >= 0 && isRecord(currentModels[modelIndex])
        ? currentModels[modelIndex] as Record<string, unknown>
        : {};
      const nextModel: Record<string, unknown> = { ...previousModel, id: input.model.id };
      applyModelFields(nextModel, input.model);
      if (modelIndex >= 0) {
        currentModels[modelIndex] = nextModel;
      } else {
        currentModels.push(nextModel);
      }
      const trimmedKey = input.apiKey?.trim();
      providers[input.providerId] = {
        ...config,
        baseUrl: input.baseUrl,
        api: input.api ?? (typeof config.api === "string" && CUSTOM_PROVIDER_APIS.includes(config.api as CustomProviderApi) ? config.api : OPENAI_COMPLETIONS_API),
        apiKey: trimmedKey || (typeof config.apiKey === "string" ? config.apiKey : CUSTOM_PROVIDER_PLACEHOLDER_API_KEY),
        [PI_GUI_CUSTOM_PROVIDER_MARKER]: true,
        models: currentModels,
      };
      await atomicWriteJson(this.modelsJsonPath, data);
    });
  }

  async upsertBuiltInModel(providerId: string, model: CustomProviderModelInput): Promise<void> {
    if (!BUILT_IN_PROVIDER_IDS.has(providerId)) {
      throw new Error(`Unknown built-in provider: ${providerId}`);
    }
    validateModel(model);
    await this.enqueue(async () => {
      const data = await readModelsJson(this.modelsJsonPath);
      const providers = ensureProvidersRecord(data);
      const existing = isRecord(providers[providerId]) ? providers[providerId] as Record<string, unknown> : {};
      const currentModels = Array.isArray(existing.models) ? [...existing.models] : [];
      const modelIndex = currentModels.findIndex((entry) => modelIdFromUnknown(entry) === model.id);
      const previousModel = modelIndex >= 0 && isRecord(currentModels[modelIndex])
        ? currentModels[modelIndex] as Record<string, unknown>
        : {};
      const nextModel: Record<string, unknown> = {
        ...previousModel,
        id: model.id,
        [PI_GUI_CONFIGURED_MODEL_MARKER]: true,
      };
      applyModelFields(nextModel, model);
      if (modelIndex >= 0) {
        currentModels[modelIndex] = nextModel;
      } else {
        currentModels.push(nextModel);
      }
      providers[providerId] = { ...existing, models: currentModels };
      await atomicWriteJson(this.modelsJsonPath, data);
    });
  }

  async deleteModel(providerId: string, modelId: string): Promise<{ readonly providerDeleted: boolean }> {
    return this.enqueue(async () => {
      const data = await readModelsJson(this.modelsJsonPath);
      const providers = data.providers;
      if (!isRecord(providers) || !isRecord(providers[providerId])) {
        return { providerDeleted: false };
      }
      const config = providers[providerId] as Record<string, unknown>;
      if (!isPiGuiCustomProviderConfig(providerId, config)) {
        return { providerDeleted: false };
      }
      const models = Array.isArray(config.models) ? config.models : [];
      const nextModels = models.filter((entry) => modelIdFromUnknown(entry) !== modelId);
      if (nextModels.length === models.length) {
        return { providerDeleted: false };
      }
      if (nextModels.length === 0) {
        delete providers[providerId];
        await atomicWriteJson(this.modelsJsonPath, data);
        return { providerDeleted: true };
      }
      providers[providerId] = { ...config, models: nextModels };
      await atomicWriteJson(this.modelsJsonPath, data);
      return { providerDeleted: false };
    });
  }

  async deleteBuiltInModel(providerId: string, modelId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const data = await readModelsJson(this.modelsJsonPath);
      const providers = data.providers;
      if (!isRecord(providers) || !isRecord(providers[providerId])) {
        return false;
      }
      const config = providers[providerId] as Record<string, unknown>;
      const models = Array.isArray(config.models) ? config.models : [];
      const nextModels = models.filter((entry) => {
        if (!isRecord(entry) || entry.id !== modelId) return true;
        return entry[PI_GUI_CONFIGURED_MODEL_MARKER] !== true;
      });
      if (nextModels.length === models.length) return false;
      const nextConfig = { ...config };
      if (nextModels.length > 0) nextConfig.models = nextModels;
      else delete nextConfig.models;
      providers[providerId] = nextConfig;
      await atomicWriteJson(this.modelsJsonPath, data);
      return true;
    });
  }

  async delete(providerId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const data = await readModelsJson(this.modelsJsonPath);
      const providers = data.providers;
      if (!providers || typeof providers !== "object" || !(providerId in providers)) {
        return false;
      }
      const existing = (providers as Record<string, unknown>)[providerId];
      if (!existing || typeof existing !== "object" || !isPiGuiCustomProviderConfig(providerId, existing as Record<string, unknown>)) {
        return false;
      }
      delete (providers as Record<string, unknown>)[providerId];
      await atomicWriteJson(this.modelsJsonPath, data);
      return true;
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

function validateInput(input: CustomProviderInput): void {
  validateProviderIdentity(input.providerId, input.baseUrl);
  if (input.models.length === 0) {
    throw new Error("At least one model is required.");
  }
  for (const model of input.models) {
    validateModel(model);
  }
}

function validateProviderIdentity(providerId: string, baseUrl: string): void {
  if (!CUSTOM_PROVIDER_ID_PATTERN.test(providerId)) {
    throw new Error(`Provider ID must be lowercase alphanumerics or dashes (max 64 chars): ${JSON.stringify(providerId)}`);
  }
  if (!isValidHttpBaseUrl(baseUrl)) {
    throw new Error(`Base URL must start with http:// or https://: ${JSON.stringify(baseUrl)}`);
  }
}

function validateModel(model: CustomProviderModelInput): void {
  if (!model.id || typeof model.id !== "string") throw new Error("Model id is required.");
  if (model.contextWindow !== undefined && !Number.isFinite(model.contextWindow)) {
    throw new Error(`Model ${model.id} has non-numeric contextWindow.`);
  }
  if (model.maxTokens !== undefined && (!Number.isFinite(model.maxTokens) || model.maxTokens <= 0)) {
    throw new Error(`Model ${model.id} has an invalid maxTokens value.`);
  }
  if (model.cost && Object.values(model.cost).some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`Model ${model.id} has invalid cost values.`);
  }
}

function toProviderConfig(input: CustomProviderInput): Record<string, unknown> {
  const trimmedKey = input.apiKey?.trim();
  return {
    baseUrl: input.baseUrl,
    api: input.api ?? OPENAI_COMPLETIONS_API,
    apiKey: trimmedKey ? trimmedKey : CUSTOM_PROVIDER_PLACEHOLDER_API_KEY,
    [PI_GUI_CUSTOM_PROVIDER_MARKER]: true,
    models: input.models.map((model) => {
      const entry: Record<string, unknown> = { id: model.id };
      applyModelFields(entry, model);
      return entry;
    }),
  };
}

function readCustomProviders(data: Record<string, unknown>): readonly CustomProviderEntry[] {
  const providers = data.providers;
  if (!providers || typeof providers !== "object") {
    return [];
  }
  const entries: CustomProviderEntry[] = [];
  for (const [providerId, rawConfig] of Object.entries(providers as Record<string, unknown>)) {
    if (!rawConfig || typeof rawConfig !== "object") {
      continue;
    }
    const config = rawConfig as Record<string, unknown>;
    if (!isPiGuiCustomProviderConfig(providerId, config)) {
      continue;
    }
    const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl : undefined;
    if (!baseUrl) {
      continue;
    }
    const models = Array.isArray(config.models)
      ? (config.models as unknown[])
          .map((raw): CustomProviderModelInput | undefined => {
            if (!raw || typeof raw !== "object") {
              return undefined;
            }
            const modelConfig = raw as Record<string, unknown>;
            if (typeof modelConfig.id !== "string" || !modelConfig.id) {
              return undefined;
            }
            const contextWindow =
              typeof modelConfig.contextWindow === "number" ? modelConfig.contextWindow : undefined;
            const name = typeof modelConfig.name === "string" ? modelConfig.name : undefined;
            const reasoning = typeof modelConfig.reasoning === "boolean" ? modelConfig.reasoning : undefined;
            const thinkingLevelMap = isRecord(modelConfig.thinkingLevelMap)
              ? Object.fromEntries(Object.entries(modelConfig.thinkingLevelMap).filter(([level, value]) =>
                ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(level) && (typeof value === "string" || value === null))) as Partial<Record<CustomProviderThinkingLevel, string | null>>
              : undefined;
            const input = Array.isArray(modelConfig.input) && modelConfig.input.every((value) => value === "text" || value === "image")
              ? modelConfig.input as ("text" | "image")[] : undefined;
            const maxTokens = typeof modelConfig.maxTokens === "number" ? modelConfig.maxTokens : undefined;
            const rawCost = isRecord(modelConfig.cost) ? modelConfig.cost : undefined;
            const cost = rawCost && ["input", "output", "cacheRead", "cacheWrite"].every((key) => typeof rawCost[key] === "number")
              ? { input: rawCost.input as number, output: rawCost.output as number, cacheRead: rawCost.cacheRead as number, cacheWrite: rawCost.cacheWrite as number } : undefined;
            return { id: modelConfig.id, ...(name ? { name } : {}), ...(reasoning !== undefined ? { reasoning } : {}), ...(thinkingLevelMap && Object.keys(thinkingLevelMap).length ? { thinkingLevelMap } : {}), ...(input ? { input } : {}), ...(contextWindow !== undefined ? { contextWindow } : {}), ...(maxTokens !== undefined ? { maxTokens } : {}), ...(cost ? { cost } : {}) };
          })
          .filter((entry): entry is CustomProviderModelInput => entry !== undefined)
      : [];
    const rawApiKey = typeof config.apiKey === "string" ? config.apiKey : undefined;
    const api = typeof config.api === "string" && CUSTOM_PROVIDER_APIS.includes(config.api as CustomProviderApi)
      ? config.api as CustomProviderApi : OPENAI_COMPLETIONS_API;
    const apiKey = rawApiKey === CUSTOM_PROVIDER_PLACEHOLDER_API_KEY ? undefined : rawApiKey;
    entries.push({
      providerId,
      baseUrl,
      api,
      ...(apiKey !== undefined ? { apiKey } : {}),
      models,
    });
  }
  entries.sort((left, right) => left.providerId.localeCompare(right.providerId));
  return entries;
}

function isPiGuiCustomProviderConfig(providerId: string, config: Record<string, unknown>): boolean {
  if (config[PI_GUI_CUSTOM_PROVIDER_MARKER] === true) {
    return true;
  }
  if (BUILT_IN_PROVIDER_IDS.has(providerId)) {
    return false;
  }
  return (
    typeof config.api === "string" && CUSTOM_PROVIDER_APIS.includes(config.api as CustomProviderApi) &&
    typeof config.baseUrl === "string" &&
    Array.isArray(config.models) &&
    config.models.length > 0
  );
}

function ensureProvidersRecord(data: Record<string, unknown>): Record<string, unknown> {
  if (!data.providers || typeof data.providers !== "object") {
    data.providers = {};
  }
  return data.providers as Record<string, unknown>;
}

function applyModelFields(target: Record<string, unknown>, model: CustomProviderModelInput): void {
  if (model.name?.trim()) target.name = model.name.trim(); else delete target.name;
  if (model.reasoning !== undefined) target.reasoning = model.reasoning; else delete target.reasoning;
  if (model.thinkingLevelMap) target.thinkingLevelMap = { ...model.thinkingLevelMap }; else delete target.thinkingLevelMap;
  if (model.input?.length) target.input = [...model.input]; else delete target.input;
  if (model.contextWindow !== undefined) target.contextWindow = model.contextWindow; else delete target.contextWindow;
  if (model.maxTokens !== undefined) target.maxTokens = model.maxTokens; else delete target.maxTokens;
  if (model.cost) target.cost = { ...model.cost }; else delete target.cost;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function modelIdFromUnknown(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === "string" ? value.id : undefined;
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function readModelsJson(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }
    throw error;
  }
  if (text.trim().length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${path} is not valid JSON. Fix or remove the file before editing custom endpoints from the app. (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object at the top level.`);
  }
  return parsed as Record<string, unknown>;
}

async function atomicWriteJson(path: string, data: Record<string, unknown>): Promise<void> {
  await writeJsonFileAtomic(path, data);
}
