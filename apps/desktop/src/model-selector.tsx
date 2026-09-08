import { useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeSnapshot } from "@pi-frame/session-driver/runtime-types";
import { Check } from "lucide-react";
import { ChevronDownIcon, ModelIcon, ReasoningIcon } from "./icons";
import {
  buildModelOptions,
  MODEL_OPTIONS_EMPTY_TITLE,
  THINKING_OPTIONS,
  type ComposerModelOption,
} from "./composer-commands";
import { useTranslation } from "react-i18next";

interface ModelSelectorProps {
  readonly runtime: RuntimeSnapshot | undefined;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly disabled?: boolean;
  readonly dropdownPlacement?: "above" | "below";
  readonly showEmptyModelControl?: boolean;
  readonly unselectedModelLabel?: string;
  readonly emptyModelLabel?: string;
  readonly emptyModelTitle?: string;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
}

type OpenDropdown = "none" | "model" | "thinking";

export function ModelSelector({
  runtime,
  provider,
  modelId,
  thinkingLevel,
  disabled,
  dropdownPlacement = "above",
  showEmptyModelControl = false,
  unselectedModelLabel = "Choose model",
  emptyModelLabel = "Choose model",
  emptyModelTitle = MODEL_OPTIONS_EMPTY_TITLE,
  onSetModel,
  onSetThinking,
}: ModelSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<OpenDropdown>("none");
  const [modelFilter, setModelFilter] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  const modelOptions = useMemo(() => buildModelOptions(runtime), [runtime]);
  const filteredModels = useMemo(() => {
    if (!modelFilter) return modelOptions;
    const q = modelFilter.toLowerCase();
    return modelOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.description.toLowerCase().includes(q) ||
        opt.providerId.toLowerCase().includes(q),
    );
  }, [modelOptions, modelFilter]);

  const groupedModels = useMemo(() => groupByProvider(filteredModels), [filteredModels]);
  const hasAvailableModelOptions = modelOptions.length > 0;
  const hasModelControl = Boolean(provider && modelId) || hasAvailableModelOptions;
  const shouldRenderModelControl = hasModelControl || showEmptyModelControl;
  const modelBadgeLabel = provider && modelId ? `${provider}:${modelId}` : hasAvailableModelOptions ? unselectedModelLabel : emptyModelLabel;
  const noMatchingModels = hasAvailableModelOptions && modelFilter.trim().length > 0 && groupedModels.length === 0;
  const currentModel = runtime?.models.find((model) => model.providerId === provider && model.modelId === modelId);
  const thinkingOptions = useMemo(
    () => currentModel?.thinkingLevels?.length
      ? THINKING_OPTIONS.filter((option) => currentModel.thinkingLevels?.includes(option.value as NonNullable<RuntimeSnapshot["settings"]["defaultThinkingLevel"]>))
      : THINKING_OPTIONS,
    [currentModel],
  );

  useEffect(() => {
    if (open === "none") {
      setModelFilter("");
      return undefined;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen("none");
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen("none");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (!shouldRenderModelControl && !thinkingLevel) {
    return null;
  }

  return (
    <span className="model-selector" ref={containerRef}>
      {shouldRenderModelControl ? (
        <span className="model-selector__anchor">
          <button
            className="model-selector__badge"
            aria-expanded={open === "model"}
            aria-haspopup="menu"
            type="button"
            disabled={disabled}
            onClick={() => setOpen(open === "model" ? "none" : "model")}
          >
            <span className="composer-select__icon" aria-hidden="true"><ModelIcon /></span>
            <span className="composer-select__label">{modelBadgeLabel}</span>
            <span className="composer-select__chevron" aria-hidden="true"><ChevronDownIcon /></span>
          </button>
          {open === "model" ? (
            <div
              className={`model-selector__dropdown ${dropdownPlacement === "below" ? "model-selector__dropdown--below" : ""}`}
              role="menu"
              onWheel={(event) => event.stopPropagation()}
            >
              <div className="model-selector__filter">
                <input
                  className="model-selector__filter-input"
                  placeholder={t("modelSelector.filter")}
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  autoFocus
                />
              </div>
              {groupedModels.map((group) => (
                <div key={group.provider}>
                  <div className="model-selector__group-title">{group.provider}</div>
                  {group.items.map((option) => {
                    const isActive = option.providerId === provider && option.modelId === modelId;
                    return (
                      <button
                        className={`model-selector__item${isActive ? " model-selector__item--active" : ""}`}
                        aria-checked={isActive}
                        key={`${option.providerId}:${option.modelId}`}
                        type="button"
                        role="menuitemradio"
                        onClick={() => {
                          if (!isActive) {
                            onSetModel(option.providerId, option.modelId);
                          }
                          setOpen("none");
                        }}
                      >
                        <span className="model-selector__item-label">{option.label}</span>
                        <span className="model-selector__item-check" aria-hidden="true">{isActive ? <Check /> : null}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {groupedModels.length === 0 ? (
                <>
                  <div className="model-selector__group-title">
                    {noMatchingModels ? t("modelSelector.noMatching") : emptyModelTitle}
                  </div>
                  {noMatchingModels ? <div className="model-selector__empty">{t("modelSelector.tryDifferentFilter")}</div> : null}
                </>
              ) : null}
            </div>
          ) : null}
        </span>
      ) : null}
      {thinkingLevel ? (
        <span className="model-selector__anchor">
          <button
            className="model-selector__badge"
            aria-expanded={open === "thinking"}
            aria-haspopup="menu"
            type="button"
            disabled={disabled}
            onClick={() => setOpen(open === "thinking" ? "none" : "thinking")}
          >
            <span className="composer-select__icon" aria-hidden="true"><ReasoningIcon /></span>
            <span className="composer-select__label">{thinkingLevelLabel(thinkingLevel, t)}</span>
            <span className="composer-select__chevron" aria-hidden="true"><ChevronDownIcon /></span>
          </button>
          {open === "thinking" ? (
            <div
              className={`model-selector__dropdown ${dropdownPlacement === "below" ? "model-selector__dropdown--below" : ""}`}
              role="menu"
              onWheel={(event) => event.stopPropagation()}
            >
              <div className="model-selector__group-title">{t("modelSelector.thinkingLevel")}</div>
                {thinkingOptions.map((option) => {
                const isActive = option.value === thinkingLevel;
                return (
                  <button
                    className={`model-selector__item${isActive ? " model-selector__item--active" : ""}`}
                    aria-checked={isActive}
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    onClick={() => {
                      if (!isActive) {
                        onSetThinking(option.value);
                      }
                      setOpen("none");
                    }}
                  >
                    <span className="model-selector__item-label">{thinkingLevelLabel(option.value, t)}</span>
                    <span className="model-selector__item-meta">{option.description}</span>
                    <span className="model-selector__item-check" aria-hidden="true">{isActive ? <Check /> : null}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function thinkingLevelLabel(value: string, t: (key: string) => string): string {
  return t(`modelSelector.thinking.${value}`);
}

interface ModelGroup {
  readonly provider: string;
  readonly items: readonly ComposerModelOption[];
}

function groupByProvider(options: readonly ComposerModelOption[]): readonly ModelGroup[] {
  const groups = new Map<string, ComposerModelOption[]>();
  for (const option of options) {
    const existing = groups.get(option.providerId);
    if (existing) {
      existing.push(option);
    } else {
      groups.set(option.providerId, [option]);
    }
  }
  return Array.from(groups.entries()).map(([provider, items]) => ({ provider, items }));
}
