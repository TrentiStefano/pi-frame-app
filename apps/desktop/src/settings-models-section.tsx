import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CUSTOM_PROVIDER_ID_PATTERN, isValidHttpBaseUrl, type CustomProviderApi, type CustomProviderThinkingLevel } from "@pi-frame/pi-sdk-driver/custom-provider-types";
import type {
  ConfiguredModelRecord,
  DeleteModelConfigurationInput,
  ModelConfigurationDefaultsInput,
  ModelConfigurationSnapshot,
  SaveModelConfigurationInput,
} from "./ipc";
import { labelForThinking, settingsPill, SettingsGroup, SettingsRow, THINKING_LEVELS } from "./settings-utils";

interface SettingsModelsSectionProps {
  readonly onSaveModel: (input: SaveModelConfigurationInput) => Promise<string | undefined>;
  readonly onDeleteModel: (input: DeleteModelConfigurationInput) => Promise<string | undefined>;
  readonly onSetDefaults: (input: ModelConfigurationDefaultsInput) => Promise<string | undefined>;
}

type EditorState =
  | { readonly kind: "closed" }
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly model: ConfiguredModelRecord };

export function SettingsModelsSection({ onSaveModel, onDeleteModel, onSetDefaults }: SettingsModelsSectionProps) {
  const { t } = useTranslation();
  const [configuration, setConfiguration] = useState<ModelConfigurationSnapshot>();
  const [loadError, setLoadError] = useState<string>();
  const [editor, setEditor] = useState<EditorState>({ kind: "closed" });
  const [deleteTarget, setDeleteTarget] = useState<ConfiguredModelRecord>();

  const reload = useCallback(async () => {
    const api = window.piApp;
    if (!api) {
      setLoadError(t("settings.desktopBridgeUnavailable"));
      return;
    }
    try {
      setConfiguration(await api.getModelConfiguration());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const availableModels = configuration?.models.filter((model) => model.available) ?? [];
  const defaultModel = configuration?.models.find((model) => model.providerId === configuration.defaultProvider && model.modelId === configuration.defaultModelId);
  const thinkingLevels = defaultModel?.thinkingLevels?.length ? defaultModel.thinkingLevels : THINKING_LEVELS;
  const effectiveThinkingLevel = configuration?.defaultThinkingLevel && thinkingLevels.includes(configuration.defaultThinkingLevel)
    ? configuration?.defaultThinkingLevel
    : thinkingLevels[0];
  const defaultValue = configuration?.defaultProvider && configuration.defaultModelId
    ? `${configuration.defaultProvider}/${configuration.defaultModelId}`
    : "";

  const updateDefaults = async (input: ModelConfigurationDefaultsInput) => {
    const error = await onSetDefaults(input);
    if (error) setLoadError(error);
    else await reload();
  };

  return (
    <>
      <SettingsGroup>
        <SettingsRow title={t("settings.defaultModel")} description={t("settings.defaultModelDescription")}>
          <select
            aria-label={t("settings.defaultModel")}
            className="settings-select"
            disabled={!configuration}
            value={availableModels.some((model) => `${model.providerId}/${model.modelId}` === defaultValue) ? defaultValue : ""}
            onChange={(event) => {
              const separator = event.target.value.indexOf("/");
              if (separator > 0) {
                void updateDefaults({
                  providerId: event.target.value.slice(0, separator),
                  modelId: event.target.value.slice(separator + 1),
                });
              }
            }}
          >
            <option value="">{t("settings.chooseModel")}</option>
            {availableModels.map((model) => (
              <option key={`${model.providerId}/${model.modelId}`} value={`${model.providerId}/${model.modelId}`}>
                {model.providerName} · {model.label}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow title={t("settings.reasoning")} description={t("settings.reasoningDescription")}>
          <div className="settings-pill-row">
            {thinkingLevels.map((level) => (
              <button
                className={settingsPill(effectiveThinkingLevel === level)}
                key={level}
                type="button"
                onClick={() => void updateDefaults({ thinkingLevel: level })}
              >
                {labelForThinking(level)}
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.configuredModels")} description={t("settings.configuredModelsDescription")}>
        {loadError ? <div className="settings-row settings-warning" role="alert">{loadError}</div> : null}
        {!configuration ? (
          <div className="settings-row"><span className="settings-hint">{t("common.loading")}</span></div>
        ) : configuration.models.length === 0 ? (
          <div className="settings-model-empty">
            <strong>{t("settings.noConfiguredModels")}</strong>
            <span>{t("settings.noConfiguredModelsDescription")}</span>
            <button className="button" type="button" onClick={() => setEditor({ kind: "create" })}>
              <Plus aria-hidden size={16} />
              {t("settings.addModel")}
            </button>
          </div>
        ) : (
          <div className="settings-model-list">
            {configuration.models.map((model) => (
              <div className="settings-model-row" key={`${model.providerId}/${model.modelId}`}>
                <div className="settings-model-row__body">
                  <div className="settings-model-row__title">
                    <strong>{model.label}</strong>
                    {model.isDefault ? <span className="settings-status settings-status--default">{t("settings.defaultBadge")}</span> : null}
                    <span className={model.available ? "settings-status settings-status--ready" : "settings-status settings-status--warning"}>
                      {model.available ? t("settings.ready") : t("settings.apiKeyRequired")}
                    </span>
                  </div>
                  <div className="settings-model-row__meta">
                    <span>{model.providerName}</span>
                    <code>{model.providerId}/{model.modelId}</code>
                    {model.baseUrl ? <span className="settings-model-row__endpoint">{model.baseUrl}</span> : null}
                  </div>
                </div>
                <div className="settings-model-row__actions">
                  {model.providerKind === "custom" ? (
                    <button
                      aria-label={t("settings.editModel", { model: model.label })}
                      className="icon-button"
                      title={t("common.edit")}
                      type="button"
                      onClick={() => setEditor({ kind: "edit", model })}
                    >
                      <Pencil aria-hidden size={15} />
                    </button>
                  ) : null}
                  <button
                    aria-label={t("settings.deleteModel", { model: model.label })}
                    className="icon-button icon-button--danger"
                    title={t("common.delete")}
                    type="button"
                    onClick={() => setDeleteTarget(model)}
                  >
                    <Trash2 aria-hidden size={15} />
                  </button>
                </div>
              </div>
            ))}
            <div className="settings-model-list__footer">
              <button className="button" type="button" onClick={() => setEditor({ kind: "create" })}>
                <Plus aria-hidden size={16} />
                {t("settings.addModel")}
              </button>
            </div>
          </div>
        )}
      </SettingsGroup>

      {editor.kind !== "closed" && configuration ? (
        <ModelEditorDialog
          configuration={configuration}
          editor={editor}
          onClose={() => setEditor({ kind: "closed" })}
          onSaved={async (input) => {
            const error = await onSaveModel(input);
            if (!error) await reload();
            return error;
          }}
        />
      ) : null}
      {deleteTarget && configuration ? (
        <DeleteModelDialog
          configuration={configuration}
          model={deleteTarget}
          onClose={() => setDeleteTarget(undefined)}
          onDelete={async (input) => {
            const error = await onDeleteModel(input);
            if (!error) await reload();
            return error;
          }}
        />
      ) : null}
    </>
  );
}

function ModelEditorDialog({
  configuration,
  editor,
  onClose,
  onSaved,
}: {
  readonly configuration: ModelConfigurationSnapshot;
  readonly editor: Exclude<EditorState, { kind: "closed" }>;
  readonly onClose: () => void;
  readonly onSaved: (input: SaveModelConfigurationInput) => Promise<string | undefined>;
}) {
  const { t } = useTranslation();
  const editedModel = editor.kind === "edit" ? editor.model : undefined;
  const customProviders = configuration.providers.filter((provider) => provider.kind === "custom");
  const initialChoice = editedModel
    ? `custom:${editedModel.providerId}`
    : customProviders[0] ? `custom:${customProviders[0].id}` : "new-custom";
  const [providerChoice, setProviderChoice] = useState(initialChoice);
  const [providerId, setProviderId] = useState(editedModel?.providerId ?? "");
  const [baseUrl, setBaseUrl] = useState(editedModel?.baseUrl ?? "");
  const [api, setApi] = useState<CustomProviderApi>(configuration.providers.find((provider) => provider.id === editedModel?.providerId)?.api ?? "openai-completions");
  const [modelId, setModelId] = useState(editedModel?.modelId ?? "");
  const [modelName, setModelName] = useState(editedModel?.label ?? "");
  const [reasoning, setReasoning] = useState(editedModel?.reasoning ?? false);
  const [supportedThinkingLevels, setSupportedThinkingLevels] = useState<readonly CustomProviderThinkingLevel[]>(editedModel?.thinkingLevels ?? ["off", "minimal", "low", "medium", "high"]);
  const [supportsImages, setSupportsImages] = useState(editedModel?.supportsImages ?? false);
  const [contextWindow, setContextWindow] = useState(editedModel?.contextWindow?.toString() ?? "");
  const [maxTokens, setMaxTokens] = useState(editedModel?.maxTokens?.toString() ?? "");
  const [costInput, setCostInput] = useState(editedModel?.cost?.input?.toString() ?? "");
  const [costOutput, setCostOutput] = useState(editedModel?.cost?.output?.toString() ?? "");
  const [costCacheRead, setCostCacheRead] = useState(editedModel?.cost?.cacheRead?.toString() ?? "");
  const [costCacheWrite, setCostCacheWrite] = useState(editedModel?.cost?.cacheWrite?.toString() ?? "");
  const [apiKey, setApiKey] = useState("");
  const [detectedModels, setDetectedModels] = useState<readonly string[]>([]);
  const [pending, setPending] = useState(false);
  const [probePending, setProbePending] = useState(false);
  const [error, setError] = useState<string>();

  const isNewCustom = providerChoice === "new-custom";
  const selectedProviderId = isNewCustom ? providerId.trim() : providerChoice.slice(providerChoice.indexOf(":") + 1);
  const selectedProvider = configuration.providers.find((provider) => provider.id === selectedProviderId);
  const providerKind = "custom" as const;
  const effectiveBaseUrl = isNewCustom ? baseUrl : (baseUrl || selectedProvider?.baseUrl || "");
  const effectiveApi = isNewCustom ? api : (selectedProvider?.api ?? "openai-completions");
  const suggestions = useMemo(
    () => [...new Set([...(selectedProvider?.models.map((model) => model.id) ?? []), ...detectedModels])],
    [detectedModels, selectedProvider],
  );
  const providerModelCount = configuration.models.filter((model) => model.providerId === selectedProviderId).length;

  useEffect(() => {
    if (editedModel || isNewCustom) return;
    const provider = configuration.providers.find((entry) => `${entry.kind}:${entry.id}` === providerChoice);
    setProviderId(provider?.id ?? "");
      setBaseUrl(provider?.baseUrl ?? "");
    setApi(provider?.api ?? "openai-completions");
    setModelId("");
    setDetectedModels([]);
  }, [configuration.providers, editedModel, isNewCustom, providerChoice]);

  const validate = (): string | undefined => {
    if (!selectedProviderId) return t("settings.providerRequired");
    if (!modelId.trim()) return t("settings.modelIdRequired");
    for (const value of [contextWindow, maxTokens, costInput, costOutput, costCacheRead, costCacheWrite]) {
      if (value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0)) return t("settings.invalidAdvancedValue");
    }
    if (providerKind === "custom") {
      if (!CUSTOM_PROVIDER_ID_PATTERN.test(selectedProviderId)) return t("settings.invalidProviderId");
      if (!isValidHttpBaseUrl(effectiveBaseUrl)) return t("settings.invalidBaseUrl");
    }
    return undefined;
  };

  const probe = async () => {
    if (!isValidHttpBaseUrl(effectiveBaseUrl)) {
      setError(t("settings.invalidBaseUrl"));
      return;
    }
    setProbePending(true);
    setError(undefined);
    const result = await window.piApp?.probeCustomProviderModels({
      baseUrl: effectiveBaseUrl.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    });
    setProbePending(false);
    if (!result) setError(t("settings.desktopBridgeUnavailable"));
    else if (!result.ok) setError(result.error);
    else setDetectedModels(result.models);
  };

  const save = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setPending(true);
    setError(undefined);
    const common = {
      providerId: selectedProviderId,
      modelId: modelId.trim(),
      ...(modelName.trim() && modelName.trim() !== modelId.trim() ? { name: modelName.trim() } : {}),
      reasoning,
      ...(reasoning ? { thinkingLevelMap: thinkingLevelMapFromSupported(supportedThinkingLevels) } : {}),
      input: supportsImages ? ["text", "image"] as const : ["text"] as const,
      ...(contextWindow.trim() ? { contextWindow: Number(contextWindow) } : {}),
      ...(maxTokens.trim() ? { maxTokens: Number(maxTokens) } : {}),
      ...([costInput, costOutput, costCacheRead, costCacheWrite].some((value) => value.trim()) ? { cost: {
        input: Number(costInput || 0), output: Number(costOutput || 0), cacheRead: Number(costCacheRead || 0), cacheWrite: Number(costCacheWrite || 0),
      } } : {}),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    };
    const input: SaveModelConfigurationInput = providerKind === "custom"
      ? { ...common, providerKind: "custom", baseUrl: effectiveBaseUrl.trim(), api: effectiveApi }
      : { ...common, providerKind: "builtin" };
    const saveError = await onSaved(input);
    setPending(false);
    if (saveError) setError(saveError);
    else onClose();
  };

  return (
    <div className="extension-dialog-backdrop">
      <div className="extension-dialog settings-model-dialog" data-testid="model-configuration-dialog" onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) onClose();
      }}>
        <div className="extension-dialog__title">{editedModel ? t("settings.editModelTitle") : t("settings.addModel")}</div>
        <p className="extension-dialog__body">{t("settings.modelDialogDescription")}</p>
        <div className="settings-field__header"><strong>{t("settings.requiredModelSettings")}</strong><span>{t("settings.requiredModelSettingsDescription")}</span></div>
        <label className="settings-field">
          <span>{t("settings.provider")}</span>
          <select
            aria-label={t("settings.provider")}
            autoFocus={!editedModel}
            className="settings-select"
            disabled={Boolean(editedModel) || pending}
            value={providerChoice}
            onChange={(event) => {
              setProviderChoice(event.target.value);
              if (event.target.value === "new-custom") {
                setProviderId("");
                setBaseUrl("");
              }
            }}
          >
            {customProviders.length > 0 ? (
              <optgroup label={t("settings.customProviders")}>
                {customProviders.map((provider) => (
                  <option key={provider.id} value={`custom:${provider.id}`}>{provider.name}</option>
                ))}
              </optgroup>
            ) : null}
            <option value="new-custom">{t("settings.newCustomProvider")}</option>
          </select>
        </label>
        {isNewCustom ? (
          <label className="settings-field">
            <span>{t("settings.providerId")}</span>
            <input aria-label={t("settings.providerId")} className="settings-search" disabled={pending} placeholder="ollama-local" value={providerId} onChange={(event) => setProviderId(event.target.value.trim().toLowerCase())} />
          </label>
        ) : null}
        {providerKind === "custom" ? (
          <label className="settings-field"><span>{t("settings.apiProtocol")}</span><select aria-label={t("settings.apiProtocol")} className="settings-select" disabled={Boolean(editedModel) || pending} value={effectiveApi} onChange={(event) => setApi(event.target.value as CustomProviderApi)}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages (Claude)</option><option value="google-generative-ai">Google Generative AI</option></select></label>
        ) : null}
        {providerKind === "custom" ? (
          <label className="settings-field">
            <span>{t("settings.baseUrl")}</span>
            <input aria-label={t("settings.baseUrl")} className="settings-search" disabled={pending} placeholder="http://localhost:11434/v1" value={effectiveBaseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
            {providerModelCount > 1 ? <span className="settings-row__description">{t("settings.sharedProviderChange", { count: providerModelCount })}</span> : null}
          </label>
        ) : null}
        <label className="settings-field">
          <span>{t("settings.modelId")}</span>
          <input aria-label={t("settings.modelId")} className="settings-search" disabled={Boolean(editedModel) || pending} placeholder="gpt-5" value={modelId} onChange={(event) => setModelId(event.target.value)} />
          {!editedModel && suggestions.length > 0 ? (
            <select
              aria-label={t("settings.modelSuggestions")}
              className="settings-select settings-model-suggestions"
              disabled={pending}
              value={suggestions.includes(modelId) ? modelId : ""}
              onChange={(event) => setModelId(event.target.value)}
            >
              <option value="">{t("settings.chooseSuggestedModel")}</option>
              {suggestions.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          ) : null}
        </label>
        {(providerKind === "custom" || selectedProvider?.apiKeySetupSupported) ? (
          <label className="settings-field">
            <span>{t("settings.apiKey")}</span>
            <input aria-label={t("settings.apiKey")} className="settings-search" disabled={pending} placeholder={editedModel || selectedProvider?.authAvailable ? t("settings.keepExistingKey") : t("settings.optionalForLocalEndpoint")} type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
            <span className="settings-row__description">{t("settings.keyStoredLocally")}</span>
          </label>
        ) : null}
        <div className="settings-field__header"><strong>{t("settings.advancedModelSettings")}</strong><span>{t("settings.advancedModelSettingsDescription")}</span></div>
        <label className="settings-field"><span>{t("settings.modelName")}</span><input aria-label={t("settings.modelName")} className="settings-search" disabled={pending} placeholder={modelId || "Llama 3.1 8B"} value={modelName} onChange={(event) => setModelName(event.target.value)} /></label>
        <div className="settings-toggle-row">
          <label className="settings-toggle"><input checked={reasoning} disabled={pending} type="checkbox" onChange={(event) => setReasoning(event.target.checked)} /><span>{t("settings.supportsReasoning")}</span></label>
          <label className="settings-toggle"><input checked={supportsImages} disabled={pending} type="checkbox" onChange={(event) => setSupportsImages(event.target.checked)} /><span>{t("settings.supportsImages")}</span></label>
        </div>
        {reasoning ? (
          <div className="settings-field"><span>{t("settings.supportedThinkingLevels")}</span><div className="settings-pill-row">{THINKING_LEVELS.map((level) => <button className={settingsPill(supportedThinkingLevels.includes(level))} key={level} type="button" onClick={() => setSupportedThinkingLevels((current) => current.includes(level) ? current.filter((entry) => entry !== level) : [...current, level])}>{labelForThinking(level)}</button>)}</div><span className="settings-row__description">{t("settings.supportedThinkingLevelsDescription")}</span></div>
        ) : null}
        <div className="settings-field-grid">
          <label className="settings-field"><span>{t("settings.contextWindow")}</span><input aria-label={t("settings.contextWindow")} className="settings-search" disabled={pending} inputMode="numeric" placeholder="128000" value={contextWindow} onChange={(event) => setContextWindow(event.target.value)} /></label>
          <label className="settings-field"><span>{t("settings.maxTokens")}</span><input aria-label={t("settings.maxTokens")} className="settings-search" disabled={pending} inputMode="numeric" placeholder="16384" value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} /></label>
        </div>
        <div className="settings-field__header"><strong>{t("settings.pricing")}</strong><span>{t("settings.pricingDescription")}</span></div>
        <div className="settings-field-grid settings-field-grid--four">
          <label className="settings-field"><span>{t("settings.inputCost")}</span><input aria-label={t("settings.inputCost")} className="settings-search" disabled={pending} inputMode="decimal" placeholder="0" value={costInput} onChange={(event) => setCostInput(event.target.value)} /></label>
          <label className="settings-field"><span>{t("settings.outputCost")}</span><input aria-label={t("settings.outputCost")} className="settings-search" disabled={pending} inputMode="decimal" placeholder="0" value={costOutput} onChange={(event) => setCostOutput(event.target.value)} /></label>
          <label className="settings-field"><span>{t("settings.cacheReadCost")}</span><input aria-label={t("settings.cacheReadCost")} className="settings-search" disabled={pending} inputMode="decimal" placeholder="0" value={costCacheRead} onChange={(event) => setCostCacheRead(event.target.value)} /></label>
          <label className="settings-field"><span>{t("settings.cacheWriteCost")}</span><input aria-label={t("settings.cacheWriteCost")} className="settings-search" disabled={pending} inputMode="decimal" placeholder="0" value={costCacheWrite} onChange={(event) => setCostCacheWrite(event.target.value)} /></label>
        </div>
        {providerKind === "custom" && effectiveApi === "openai-completions" ? (
          <button className="button button--secondary settings-model-dialog__probe" disabled={probePending || pending} type="button" onClick={() => void probe()}>
            {probePending ? t("settings.detectingModels") : t("settings.detectModels")}
          </button>
        ) : null}
        {error ? <p className="extension-dialog__body settings-warning" role="alert">{error}</p> : null}
        <div className="extension-dialog__actions">
          <button className="button button--secondary" disabled={pending} type="button" onClick={onClose}>{t("common.cancel")}</button>
          <button className="button" disabled={pending} type="button" onClick={() => void save()}>{pending ? t("common.saving") : t("common.save")}</button>
        </div>
      </div>
    </div>
  );
}

function thinkingLevelMapFromSupported(levels: readonly CustomProviderThinkingLevel[]): Partial<Record<CustomProviderThinkingLevel, string | null>> {
  return Object.fromEntries(THINKING_LEVELS.map((level) => [level, levels.includes(level) ? level : null] as const));
}

function DeleteModelDialog({
  configuration,
  model,
  onClose,
  onDelete,
}: {
  readonly configuration: ModelConfigurationSnapshot;
  readonly model: ConfiguredModelRecord;
  readonly onClose: () => void;
  readonly onDelete: (input: DeleteModelConfigurationInput) => Promise<string | undefined>;
}) {
  const { t } = useTranslation();
  const isLastForProvider = configuration.models.filter((entry) => entry.providerId === model.providerId).length === 1;
  const canRemoveKey = model.providerKind === "builtin" && isLastForProvider && model.authSource === "auth_file";
  const [removeCredential, setRemoveCredential] = useState(canRemoveKey);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <div className="extension-dialog-backdrop">
      <div className="extension-dialog settings-model-dialog" data-testid="delete-model-dialog">
        <div className="extension-dialog__title">{t("settings.deleteModelTitle", { model: model.label })}</div>
        <p className="extension-dialog__body">{t("settings.deleteModelDescription")}</p>
        {canRemoveKey ? (
          <label className="settings-toggle">
            <input checked={removeCredential} type="checkbox" onChange={(event) => setRemoveCredential(event.target.checked)} />
            <span>{t("settings.removeUnusedKey", { provider: model.providerName })}</span>
          </label>
        ) : null}
        {error ? <p className="extension-dialog__body settings-warning" role="alert">{error}</p> : null}
        <div className="extension-dialog__actions">
          <button className="button button--secondary" disabled={pending} type="button" onClick={onClose}>{t("common.cancel")}</button>
          <button className="button button--danger" disabled={pending} type="button" onClick={async () => {
            setPending(true);
            const deleteError = await onDelete({ providerId: model.providerId, modelId: model.modelId, removeCredentialWhenUnused: removeCredential });
            setPending(false);
            if (deleteError) setError(deleteError);
            else onClose();
          }}>{t("common.delete")}</button>
        </div>
      </div>
    </div>
  );
}
