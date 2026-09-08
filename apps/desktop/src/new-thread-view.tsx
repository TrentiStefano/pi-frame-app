import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { RuntimeSnapshot } from "@pi-frame/session-driver/runtime-types";
import type { CollaborationMode, ComposerAttachment, NewThreadEnvironment, WorkspaceRecord } from "./desktop-state";
import type { MentionOption } from "./hooks/use-mention-menu";
import { ArrowUpIcon, ChevronDownIcon, FolderIcon, PlusIcon, WorktreeIcon } from "./icons";
import { Check } from "lucide-react";
import btksIconUrl from "../resources/icon.png";
import {
  MODEL_OPTIONS_EMPTY_TITLE,
  type ComposerSlashCommand,
  type ComposerSlashCommandSection,
  type ComposerSlashOption,
  type ComposerSlashOptionEmptyState,
} from "./composer-commands";
import { ComposerSurface } from "./composer-surface";
import { useTranslation } from "react-i18next";
import { ModelOnboardingNoticeBanner } from "./model-onboarding-notice";
import type { ModelOnboardingState, ModelOnboardingSettingsSection } from "./model-onboarding";
import { ModelSelector } from "./model-selector";
import { VoiceInput } from "./voice-input";

interface NewThreadViewProps {
  readonly workspaces: readonly WorkspaceRecord[];
  readonly selectedWorkspaceId: string;
  readonly runtime?: RuntimeSnapshot;
  readonly environment: NewThreadEnvironment;
  readonly collaborationMode: CollaborationMode;
  readonly prompt: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly isSubmitting: boolean;
  readonly lastError?: string;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly modelOnboarding: ModelOnboardingState;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly activeSlashCommand?: ComposerSlashCommand;
  readonly activeSlashCommandMeta?: string;
  readonly slashSections: readonly ComposerSlashCommandSection[];
  readonly slashOptions: readonly ComposerSlashOption[];
  readonly selectedSlashCommand?: ComposerSlashCommand;
  readonly selectedSlashOption?: ComposerSlashOption;
  readonly showSlashMenu: boolean;
  readonly showSlashOptionMenu: boolean;
  readonly slashOptionEmptyState?: ComposerSlashOptionEmptyState;
  readonly showMentionMenu: boolean;
  readonly mentionOptions: readonly MentionOption[];
  readonly selectedMentionIndex: number;
  readonly onChangePrompt: (prompt: string) => void;
  readonly onSelectEnvironment: (environment: NewThreadEnvironment) => void;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onOpenModelSettings: (section: ModelOnboardingSettingsSection) => void;
  readonly onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onComposerPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly onComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly onClearSlashCommand: () => void;
  readonly onSelectSlashCommand: (command: ComposerSlashCommand) => void;
  readonly onSelectSlashOption: (option: ComposerSlashOption) => void;
  readonly onSelectMention: (option: MentionOption) => void;
  readonly onEnableMentionExtension: (option: Extract<MentionOption, { kind: "extension" }>) => void;
  readonly onAddAttachments: (files: File[]) => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly onSubmit: () => void;
}

export function NewThreadView({
  workspaces,
  selectedWorkspaceId,
  runtime,
  environment,
  collaborationMode,
  prompt,
  attachments,
  isSubmitting,
  lastError,
  provider,
  modelId,
  thinkingLevel,
  modelOnboarding,
  composerRef,
  activeSlashCommand,
  activeSlashCommandMeta,
  slashSections,
  slashOptions,
  selectedSlashCommand,
  selectedSlashOption,
  showSlashMenu,
  showSlashOptionMenu,
  slashOptionEmptyState,
  showMentionMenu,
  mentionOptions,
  selectedMentionIndex,
  onChangePrompt,
  onSelectEnvironment,
  onSelectWorkspace,
  onSetModel,
  onSetThinking,
  onOpenModelSettings,
  onComposerKeyDown,
  onComposerPaste,
  onComposerDrop,
  onClearSlashCommand,
  onSelectSlashCommand,
  onSelectSlashOption,
  onSelectMention,
  onEnableMentionExtension,
  onAddAttachments,
  onRemoveAttachment,
  onSubmit,
}: NewThreadViewProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workspace = workspaces.find((entry) => entry.id === selectedWorkspaceId);

  useEffect(() => {
    composerRef.current?.focus();
  }, [composerRef]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }

    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 260)}px`;
  }, [composerRef, prompt]);

  if (!workspace) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">{t("common.newThread")}</div>
          <h1>{t("newThread.openFolderTitle")}</h1>
          <p>{t("newThread.openFolderBody")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="canvas canvas--new-thread">
      <div className="new-thread">
        <div className="new-thread__hero">
          <div className="new-thread__logo" data-testid="new-thread-logo">
            <img alt="" src={btksIconUrl} />
          </div>
          <div className="new-thread__eyebrow">{t("common.newThread")}</div>
          <h1 className="new-thread__title">{t("newThread.title")}</h1>
        </div>

        <div className="new-thread__composer-shell">
          <div className="new-thread__composer composer">
            <div className="conversation conversation--composer">
              <ComposerSurface
              lastError={lastError}
              activeSlashCommand={activeSlashCommand}
              activeSlashCommandMeta={activeSlashCommandMeta}
              topNotice={(
                <ModelOnboardingNoticeBanner notice={modelOnboarding.notice} onOpenSettings={onOpenModelSettings} />
              )}
              queuedMessages={[]}
              composerDraft={prompt}
              setComposerDraft={onChangePrompt}
              composerRef={composerRef}
              attachments={attachments}
              slashSections={slashSections}
              slashOptions={slashOptions}
              selectedSlashCommand={selectedSlashCommand}
              selectedSlashOption={selectedSlashOption}
              showSlashMenu={showSlashMenu}
              showSlashOptionMenu={showSlashOptionMenu}
              slashOptionEmptyState={slashOptionEmptyState}
              onClearSlashCommand={onClearSlashCommand}
              onComposerKeyDown={onComposerKeyDown}
              onComposerPaste={onComposerPaste}
              onComposerDrop={onComposerDrop}
              onEditQueuedMessage={() => undefined}
              onCancelQueuedEdit={() => undefined}
              onRemoveQueuedMessage={() => undefined}
              onSteerQueuedMessage={() => undefined}
              onRemoveAttachment={onRemoveAttachment}
              onSelectSlashCommand={onSelectSlashCommand}
              onSelectSlashOption={onSelectSlashOption}
              showMentionMenu={showMentionMenu}
              mentionOptions={mentionOptions}
              selectedMentionIndex={selectedMentionIndex}
              onSelectMention={onSelectMention}
              onEnableMentionExtension={onEnableMentionExtension}
              textareaLabel={t("newThread.promptLabel")}
              textareaTestId="new-thread-composer"
              textareaClassName="new-thread__textarea"
              textareaPlaceholder={collaborationMode === "plan"
                ? "Describe your task to generate a plan..."
                : t("newThread.promptPlaceholder")}
              footer={(
                <NewThreadComposerFooter
                  workspaces={workspaces}
                  workspace={workspace}
                  runtime={runtime}
                  environment={environment}
                  collaborationMode={collaborationMode}
                  provider={provider}
                  modelId={modelId}
                  thinkingLevel={thinkingLevel}
                  modelOnboarding={modelOnboarding}
                  hasContent={Boolean(prompt.trim() || attachments.length > 0)}
                  isSubmitting={isSubmitting}
                  prompt={prompt}
                  composerRef={composerRef}
                  fileInputRef={fileInputRef}
                  onChangePrompt={onChangePrompt}
                  onSelectWorkspace={onSelectWorkspace}
                  onSelectEnvironment={onSelectEnvironment}
                  onSetModel={onSetModel}
                  onSetThinking={onSetThinking}
                  onAddAttachments={onAddAttachments}
                  onSubmit={onSubmit}
                />
              )}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface NewThreadWorkspacePickerProps {
  readonly workspaces: readonly WorkspaceRecord[];
  readonly workspace: WorkspaceRecord;
  readonly onSelectWorkspace: (workspaceId: string) => void;
}

function NewThreadWorkspacePicker({
  workspaces,
  workspace,
  onSelectWorkspace,
}: NewThreadWorkspacePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>(`[data-workspace-id="${CSS.escape(workspace.id)}"]`)
        ?.focus();
    });
  }, [open, workspace.id]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? []);
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || items.length === 0) {
      return;
    }

    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (activeIndex + 1 + items.length) % items.length
          : (activeIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  return (
    <div className="new-thread__workspace-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("newThread.projectButtonLabel", { name: workspace.name })}
        className="new-thread__workspace composer-select__trigger"
        data-testid="new-thread-workspace-picker"
        data-workspace-id={workspace.id}
        type="button"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="new-thread__workspace-icon composer-select__icon"><FolderIcon /></span>
        <span className="new-thread__workspace-name composer-select__label">{workspace.name}</span>
        <span className="new-thread__workspace-chevron composer-select__chevron"><ChevronDownIcon /></span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          aria-label={t("newThread.chooseProject")}
          className="new-thread__workspace-menu composer-select__menu composer-select__menu--below"
          role="menu"
          onKeyDown={handleMenuKeyDown}
        >
          <div className="new-thread__workspace-menu-label">{t("newThread.project")}</div>
          <div className="new-thread__workspace-list">
            {workspaces.map((entry) => {
              const selected = entry.id === workspace.id;
              return (
                <button
                  aria-checked={selected}
                  className={`new-thread__workspace-option composer-select__option${selected ? " new-thread__workspace-option--selected composer-select__option--selected" : ""}`}
                  data-workspace-id={entry.id}
                  key={entry.id}
                  role="menuitemradio"
                  tabIndex={-1}
                  type="button"
                  onClick={() => {
                    if (!selected) {
                      onSelectWorkspace(entry.id);
                    }
                    closeAndRestoreFocus();
                  }}
                >
                  <span className="new-thread__workspace-option-icon composer-select__option-icon"><FolderIcon /></span>
                  <span className="new-thread__workspace-option-name composer-select__option-label">{entry.name}</span>
                  <span className="new-thread__workspace-check composer-select__check" aria-hidden="true">
                    {selected ? <Check /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface NewThreadComposerFooterProps {
  readonly workspaces: readonly WorkspaceRecord[];
  readonly workspace: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly environment: NewThreadEnvironment;
  readonly collaborationMode: CollaborationMode;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly modelOnboarding: ModelOnboardingState;
  readonly hasContent: boolean;
  readonly isSubmitting: boolean;
  readonly prompt: string;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly onChangePrompt: (prompt: string) => void;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onSelectEnvironment: (environment: NewThreadEnvironment) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onAddAttachments: (files: File[]) => void;
  readonly onSubmit: () => void;
}

function NewThreadComposerFooter({
  workspaces,
  workspace,
  runtime,
  environment,
  collaborationMode,
  provider,
  modelId,
  thinkingLevel,
  modelOnboarding,
  hasContent,
  isSubmitting,
  prompt,
  composerRef,
  fileInputRef,
  onChangePrompt,
  onSelectWorkspace,
  onSelectEnvironment,
  onSetModel,
  onSetThinking,
  onAddAttachments,
  onSubmit,
}: NewThreadComposerFooterProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="composer__footer">
        <div className="composer__footer-row">
          <div className="composer__hint new-thread__hint">
            {collaborationMode === "plan" ? (
              <span className="composer__mode" data-testid="new-thread-plan-mode-indicator">Plan</span>
            ) : null}
            <NewThreadWorkspacePicker
              workspaces={workspaces}
              workspace={workspace}
              onSelectWorkspace={onSelectWorkspace}
            />
            <NewThreadEnvironmentPicker environment={environment} onSelectEnvironment={onSelectEnvironment} />
            <ModelSelector
              runtime={runtime}
              provider={provider}
              modelId={modelId}
              thinkingLevel={thinkingLevel}
              dropdownPlacement="below"
              showEmptyModelControl
              unselectedModelLabel={modelOnboarding.unselectedModelLabel}
              emptyModelLabel={MODEL_OPTIONS_EMPTY_TITLE}
              emptyModelTitle={modelOnboarding.emptyModelTitle}
              onSetModel={onSetModel}
              onSetThinking={onSetThinking}
            />
          </div>

          <div className="composer__actions">
            <VoiceInput value={prompt} onChange={onChangePrompt} textareaRef={composerRef} />
            <input
              ref={fileInputRef}
              hidden
              type="file"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length > 0) {
                  onAddAttachments(files);
                }
                event.currentTarget.value = "";
              }}
            />
            <button
              aria-label={t("composer.attachFiles")}
              className="icon-button composer__attach"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <PlusIcon />
            </button>
            <button
              aria-label={t("newThread.start")}
              className="button button--primary button--cta-icon"
              type="button"
              disabled={isSubmitting || !hasContent || modelOnboarding.requiresModelSelection}
              onClick={onSubmit}
            >
              <ArrowUpIcon />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function NewThreadEnvironmentPicker({
  environment,
  onSelectEnvironment,
}: {
  readonly environment: NewThreadEnvironment;
  readonly onSelectEnvironment: (environment: NewThreadEnvironment) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const options: readonly { value: NewThreadEnvironment; label: string; description: string }[] = [
    { value: "local", label: t("newThread.local"), description: t("newThread.localDescription") },
    { value: "worktree", label: t("newThread.worktree"), description: t("newThread.worktreeDescription") },
  ];
  const selected = options.find((option) => option.value === environment) ?? options[0]!;

  return (
    <div className="new-thread__environment-picker" ref={pickerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={selected.label}
        className="composer-select__trigger"
        data-testid="new-thread-environment-picker"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="composer-select__icon" aria-hidden="true">
          {environment === "worktree" ? <WorktreeIcon /> : <FolderIcon />}
        </span>
        <span className="composer-select__label">{selected.label}</span>
        <span className="composer-select__chevron" aria-hidden="true"><ChevronDownIcon /></span>
      </button>
      {open ? (
        <div className="composer-select__menu composer-select__menu--below" role="menu">
          {options.map((option) => {
            const isSelected = option.value === environment;
            return (
              <button
                aria-checked={isSelected}
                className={`composer-select__option${isSelected ? " composer-select__option--selected" : ""}`}
                key={option.value}
                role="menuitemradio"
                type="button"
                onClick={() => {
                  if (!isSelected) onSelectEnvironment(option.value);
                  setOpen(false);
                }}
              >
                <span className="composer-select__option-icon" aria-hidden="true">
                  {option.value === "worktree" ? <WorktreeIcon /> : <FolderIcon />}
                </span>
                <span className="composer-select__option-copy">
                  <span className="composer-select__option-label">{option.label}</span>
                  <span className="composer-select__option-description">{option.description}</span>
                </span>
                <span className="composer-select__check" aria-hidden="true">{isSelected ? <Check /> : null}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
