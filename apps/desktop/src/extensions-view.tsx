import { useMemo, useState } from "react";
import type { RuntimeExtensionRecord, RuntimeSnapshot } from "@pi-frame/session-driver/runtime-types";
import type { ExtensionCommandCompatibilityRecord, WorkspaceRecord } from "./desktop-state";
import { extensionScopeLabel, extensionSourceSummary } from "./extension-display";
import { RefreshIcon } from "./icons";
import { useTranslation } from "react-i18next";

interface ExtensionsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly commandCompatibility?: readonly ExtensionCommandCompatibilityRecord[];
  readonly onRefresh: () => void;
  readonly onOpenExtensionFolder: (filePath: string) => void;
  readonly onToggleExtension: (filePath: string, enabled: boolean) => void;
}

export function ExtensionsView({
  workspace,
  runtime,
  commandCompatibility = [],
  onRefresh,
  onOpenExtensionFolder,
  onToggleExtension,
}: ExtensionsViewProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedExtensionPath, setSelectedExtensionPath] = useState<string | undefined>();
  const extensions = runtime?.extensions ?? [];
  const filteredExtensions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return extensions;
    }

    return extensions.filter((extension) =>
      [
        extension.displayName,
        extension.path,
        extension.sourceInfo.source,
        extensionScopeLabel(extension),
        extensionSourceSummary(extension),
        extension.sourceInfo.origin,
        ...extension.commands,
        ...extension.tools,
        ...extension.flags,
        ...extension.shortcuts,
        ...extension.diagnostics.map((diagnostic) => diagnostic.message),
      ].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [extensions, query]);
  const selectedExtension =
    filteredExtensions.find((extension) => extension.path === selectedExtensionPath) ?? filteredExtensions[0];
  const selectedExtensionCanBeManaged = selectedExtension ? isManageableExtension(selectedExtension) : false;
  const selectedCompatibilityRecords = useMemo(
    () =>
      selectedExtension
        ? commandCompatibility
            .filter((record) => record.extensionPath === selectedExtension.path)
            .sort((left, right) => left.commandName.localeCompare(right.commandName))
        : [],
    [commandCompatibility, selectedExtension],
  );

  if (!workspace) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">{t("common.extensions")}</div>
          <h1>{t("extensions.selectWorkspace")}</h1>
          <p>{t("extensions.selectWorkspaceDescription")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="canvas">
      <div className="conversation skills-view">
        <header className="view-header">
          <div>
            <h1 className="view-header__title">{t("common.extensions")}</h1>
            <p className="view-header__body">
              Inspect and manage first-class runtime extensions for this workspace.
            </p>
          </div>
          <div className="view-header__actions">
            <button className="button button--secondary" type="button" onClick={onRefresh}>
              <RefreshIcon />
              <span>{t("common.refresh")}</span>
            </button>
          </div>
        </header>

        <div className="skills-toolbar">
          <input
            aria-label={t("extensions.search")}
            className="skills-search"
            placeholder={t("extensions.search")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>

        <div className="skills-layout">
          <div className="skills-grid" data-testid="extensions-list">
            {filteredExtensions.length === 0 ? (
              <ExtensionsEmptyState message={t("extensions.loadDiscovery")} />
            ) : (
              filteredExtensions.map((extension) => (
                <button
                  className={`skill-card ${selectedExtension?.path === extension.path ? "skill-card--active" : ""}`}
                  key={extension.path}
                  type="button"
                  onClick={() => {
                    setSelectedExtensionPath(extension.path);
                  }}
                >
                  <span className="skill-card__title-row">
                    <span className="skill-card__title">{extension.displayName}</span>
                    <span className={`skill-card__badge ${extension.enabled ? "skill-card__badge--enabled" : ""}`}>
                      {extension.enabled ? t("common.enabled") : t("common.disabled")}
                    </span>
                  </span>
                  <span className="skill-card__description">
                    {extensionSourceSummary(extension)}
                  </span>
                  <span className="skill-card__meta">
                    <span>{extension.sourceInfo.source}</span>
                    {extension.commands.length > 0 ? <span>{extension.commands.length} commands</span> : null}
                    {extension.tools.length > 0 ? <span>{extension.tools.length} tools</span> : null}
                    {extension.diagnostics.length > 0 ? <span>{extension.diagnostics.length} issues</span> : null}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="skill-detail">
            {selectedExtension ? (
              <>
                <div className="skill-detail__header">
                  <div>
                    <h2>{selectedExtension.displayName}</h2>
                    <div className="skill-detail__slash">{selectedExtension.sourceInfo.source}</div>
                  </div>
                  <span className={`skill-detail__status ${selectedExtension.enabled ? "skill-detail__status--enabled" : ""}`}>
                    {selectedExtension.enabled ? t("common.enabled") : t("common.disabled")}
                  </span>
                </div>
                <div className="skill-detail__meta-list">
                  <DetailItem label={t("extensions.scope")} value={extensionScopeLabel(selectedExtension)} />
                  <DetailItem label={t("extensions.origin")} value={selectedExtension.sourceInfo.origin} />
                  <DetailItem label={t("extensions.path")} value={selectedExtension.path} mono />
                  {selectedExtension.sourceInfo.baseDir ? (
                    <DetailItem label={t("extensions.baseDirectory")} value={selectedExtension.sourceInfo.baseDir} mono />
                  ) : null}
                </div>
                {selectedExtensionCanBeManaged ? (
                  <div className="skill-detail__actions">
                    <button className="button button--secondary" type="button" onClick={() => onOpenExtensionFolder(selectedExtension.path)}>
                      Open folder
                    </button>
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => onToggleExtension(selectedExtension.path, !selectedExtension.enabled)}
                    >
                      {selectedExtension.enabled ? t("extensions.disable") : t("extensions.enable")}
                    </button>
                  </div>
                ) : null}

                <ExtensionContributionSection title={t("extensions.commands")} items={selectedExtension.commands} emptyLabel={t("extensions.noCommands")} />
                <ExtensionCompatibilitySection
                  commands={selectedExtension.commands}
                  compatibilityRecords={selectedCompatibilityRecords}
                />
                <ExtensionContributionSection title={t("extensions.tools")} items={selectedExtension.tools} emptyLabel={t("extensions.noTools")} />
                <ExtensionContributionSection title={t("extensions.flags")} items={selectedExtension.flags} emptyLabel={t("extensions.noFlags")} />
                <ExtensionContributionSection title={t("extensions.shortcuts")} items={selectedExtension.shortcuts} emptyLabel={t("extensions.noShortcuts")} />
                <ExtensionDiagnostics diagnostics={selectedExtension.diagnostics} />
              </>
            ) : (
              <ExtensionsEmptyState message={t("extensions.refreshDiscovery")} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function isManageableExtension(extension: RuntimeExtensionRecord): boolean {
  return extension.sourceInfo.scope === "project" || extension.sourceInfo.scope === "user";
}

function DetailItem({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div>
      <div className="skill-detail__meta-label">{label}</div>
      <div className={mono ? "skill-detail__path" : "skill-detail__description"}>{value}</div>
    </div>
  );
}

function ExtensionContributionSection({
  title,
  items,
  emptyLabel,
}: {
  readonly title: string;
  readonly items: readonly string[];
  readonly emptyLabel: string;
}) {
  return (
    <div className="skill-detail__meta-list">
      <div>
        <div className="skill-detail__meta-label">{title}</div>
        {items.length > 0 ? (
          <div className="extension-detail__tokens">
            {items.map((item) => (
              <span className="slash-menu__skill-badge" key={item}>
                {item}
              </span>
            ))}
          </div>
        ) : (
          <div className="skill-detail__description">{emptyLabel}</div>
        )}
      </div>
    </div>
  );
}

function ExtensionDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: RuntimeExtensionRecord["diagnostics"];
}) {
  const { t } = useTranslation();
  return (
    <div className="skill-detail__meta-list">
      <div>
        <div className="skill-detail__meta-label">{t("extensions.diagnostics")}</div>
        {diagnostics.length > 0 ? (
          <div className="extension-detail__diagnostics">
            {diagnostics.map((diagnostic, index) => (
              <div className={`activity-item activity-item--${diagnostic.type === "error" ? "error" : "info"}`} key={`${diagnostic.message}:${index}`}>
                <div className="activity-item__text">{diagnostic.message}</div>
                {diagnostic.path ? <div className="activity-item__meta">{diagnostic.path}</div> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="skill-detail__description">{t("extensions.noDiagnostics")}</div>
        )}
      </div>
    </div>
  );
}

function ExtensionCompatibilitySection({
  commands,
  compatibilityRecords,
}: {
  readonly commands: readonly string[];
  readonly compatibilityRecords: readonly ExtensionCommandCompatibilityRecord[];
}) {
  const { t } = useTranslation();
  const supported = compatibilityRecords.filter((record) => record.status === "supported");
  const terminalOnly = compatibilityRecords.filter((record) => record.status === "terminal-only");
  const unknown = commands.filter((commandName) =>
    compatibilityRecords.every(
      (record) => record.commandName !== commandName && !record.commandName.startsWith(`${commandName}:`),
    ),
  );

  return (
    <div className="skill-detail__meta-list">
      <div>
        <div className="skill-detail__meta-label">{t("extensions.compatibility")}</div>
        <div className="skill-detail__description">
          {t("extensions.compatibilityDescription")}
        </div>
        <div className="extension-detail__tokens">
          {supported.map((record) => (
            <span className="slash-menu__skill-badge" key={`supported:${record.commandName}`}>
              {record.commandName} · {t("extensions.guiCompatible")}
            </span>
          ))}
          {terminalOnly.map((record) => (
            <span className="slash-menu__skill-badge slash-menu__skill-badge--warning" key={`terminal:${record.commandName}`}>
              {record.commandName} · {t("extensions.terminalOnly")}
            </span>
          ))}
          {unknown.map((commandName) => (
            <span className="slash-menu__skill-badge" key={`unknown:${commandName}`}>
              {commandName} · {t("extensions.unknown")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExtensionsEmptyState({ message }: { readonly message: string }) {
  const { t } = useTranslation();
  return (
    <div className="empty-state">
      <h2>{t("extensions.empty")}</h2>
      <p>{message}</p>
    </div>
  );
}
