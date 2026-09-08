import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Blocks, Check, Download, ExternalLink, Plug, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import type { RuntimeConfiguredPackage } from "@pi-frame/session-driver/runtime-types";
import { useTranslation } from "react-i18next";
import type { DesktopAppState, WorkspaceRecord } from "./desktop-state";
import type { PiDesktopApi } from "./ipc";
import type { CapabilityCatalogEntry, CapabilityCenterSnapshot, CapabilityScope } from "./capability-types";

type CapabilityTab = "discover" | "installed" | "skills" | "connectors";

interface CapabilitiesViewProps {
  readonly api: PiDesktopApi;
  readonly snapshot: DesktopAppState;
  readonly workspaces: readonly WorkspaceRecord[];
  readonly initialWorkspaceId: string;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
}

export function CapabilitiesView({ api, snapshot, workspaces, initialWorkspaceId, setSnapshot }: CapabilitiesViewProps) {
  const { t } = useTranslation();
  const [center, setCenter] = useState<CapabilityCenterSnapshot | null>(null);
  const [packages, setPackages] = useState<readonly RuntimeConfiguredPackage[]>([]);
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId || workspaces[0]?.id || "");
  const [tab, setTab] = useState<CapabilityTab>("discover");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [scope, setScope] = useState<CapabilityScope>("user");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");

  const load = async (refresh = false) => {
    setError("");
    const [centerResult, packagesResult] = await Promise.allSettled([
      api.getCapabilityCenter(refresh),
      workspaceId ? api.listCapabilityPackages(workspaceId) : Promise.resolve([]),
    ]);
    const errors: string[] = [];
    if (centerResult.status === "fulfilled") {
      setCenter(centerResult.value);
    } else {
      errors.push(centerResult.reason instanceof Error ? centerResult.reason.message : String(centerResult.reason));
    }
    if (packagesResult.status === "fulfilled") {
      setPackages(packagesResult.value);
    } else {
      errors.push(packagesResult.reason instanceof Error ? packagesResult.reason.message : String(packagesResult.reason));
    }
    if (errors.length > 0) setError(errors.join("\n"));
  };

  useEffect(() => { void load(); }, [workspaceId]);

  const connectedIds = useMemo(() => new Set(center?.connectors.map((item) => item.id) ?? []), [center]);
  const installedSources = useMemo(() => new Set(packages.filter((item) => item.installed).map((item) => item.source)), [packages]);
  const entries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const catalogEntries = center?.catalog.entries ?? [];
    const catalogSources = new Set(
      catalogEntries.flatMap((entry) => entry.package ? [entry.package.source] : []),
    );
    const unlistedInstalledEntries = tab === "installed"
      ? buildUnlistedInstalledPackageEntries(packages, catalogSources)
      : [];
    return [...catalogEntries, ...unlistedInstalledEntries].filter((entry) => {
      if (tab === "installed") {
        const installed = entry.kind === "connector" ? connectedIds.has(entry.id) : Boolean(entry.package && installedSources.has(entry.package.source));
        if (!installed) return false;
      }
      if (tab === "skills" && entry.kind !== "skill") return false;
      if (tab === "connectors" && entry.kind !== "connector") return false;
      return !needle || [entry.name, entry.description, entry.category, entry.author, ...(entry.tags ?? [])]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [center, connectedIds, installedSources, query, tab]);
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];

  const run = async (id: string, action: () => Promise<DesktopAppState>) => {
    setBusyId(id);
    setError("");
    try {
      setSnapshot(await action());
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusyId("");
    }
  };

  const installPackage = (entry: CapabilityCatalogEntry) => {
    if (!workspaceId || !entry.package) return;
    const message = t("capabilities.confirmInstall", { name: entry.name, scope: t(`capabilities.scope.${scope}`) });
    if (!window.confirm(message)) return;
    void run(entry.id, () => api.installCapabilityPackage({ workspaceId, source: entry.package!.source, scope }));
  };

  const removePackage = (entry: CapabilityCatalogEntry, configured: RuntimeConfiguredPackage) => {
    if (!workspaceId || !entry.package || !window.confirm(t("capabilities.confirmRemove", { name: entry.name }))) return;
    void run(entry.id, () => api.removeCapabilityPackage({ workspaceId, source: configured.source, scope: configured.scope }));
  };

  const setConnector = (entry: CapabilityCatalogEntry, enabled: boolean) => {
    if (!workspaceId || !entry.connector) return;
    if (enabled && !window.confirm(t("capabilities.confirmConnect", { name: entry.name }))) return;
    void run(entry.id, () => api.setCapabilityConnector(workspaceId, {
      id: entry.id,
      name: entry.name,
      definition: entry.connector!,
      enabled,
    }));
  };

  const addCustomConnector = () => {
    if (!workspaceId || !customName.trim() || !customUrl.trim()) return;
    if (!window.confirm(t("capabilities.confirmConnect", { name: customName.trim() }))) return;
    const id = `custom-${Date.now().toString(36)}`;
    void run(id, () => api.setCapabilityConnector(workspaceId, {
      id,
      name: customName.trim(),
      definition: { transport: "streamable-http", url: customUrl.trim() },
      enabled: true,
      custom: true,
    }));
  };

  return (
    <section className="capabilities" data-testid="capabilities-view">
      <header className="capabilities__header">
        <div>
          <p className="capabilities__eyebrow"><Blocks size={15} />{t("capabilities.eyebrow")}</p>
          <h1>{t("capabilities.title")}</h1>
          <p>{t("capabilities.description")}</p>
        </div>
        <div className="capabilities__header-actions">
          <select aria-label={t("capabilities.workspace")} value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
          <button className="capabilities__icon-button" type="button" title={t("common.refresh")} onClick={() => void load(true)}>
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <div className="capabilities__controls">
        <div className="capabilities__tabs" role="tablist">
          {(["discover", "installed", "skills", "connectors"] as const).map((item) => (
            <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>
              {t(`capabilities.tabs.${item}`)}
            </button>
          ))}
        </div>
        <label className="capabilities__search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("capabilities.search")} /></label>
      </div>

      {error ? <div className="capabilities__error" role="alert">{error}</div> : null}
      <div className="capabilities__body">
        <div className="capabilities__list" role="list">
          {entries.length === 0 ? <div className="capabilities__empty">{center ? t("capabilities.empty") : t("common.loading")}</div> : entries.map((entry) => {
            const isConnected = connectedIds.has(entry.id);
            const isInstalled = Boolean(entry.package && installedSources.has(entry.package.source));
            return <button key={entry.id} type="button" role="listitem" className={`capability-row ${selected?.id === entry.id ? "is-selected" : ""}`} onClick={() => setSelectedId(entry.id)}>
              <span className={`capability-row__icon capability-row__icon--${entry.kind}`}>{entry.kind === "connector" ? <Plug size={17} /> : <Blocks size={17} />}</span>
              <span className="capability-row__copy"><strong>{entry.name}</strong><span>{entry.description}</span><small>{entry.category} · {entry.author}</small></span>
              {(isConnected || isInstalled) ? <Check className="capability-row__check" size={16} aria-label={t("capabilities.installed")} /> : null}
            </button>;
          })}
          <button className="capabilities__custom-trigger" type="button" onClick={() => setShowCustom((value) => !value)}><Plus size={15} />{t("capabilities.addCustom")}</button>
        </div>

        <article className="capabilities__detail">
          {selected ? <CapabilityDetail entry={selected} center={center} packages={packages} scope={scope} busy={busyId === selected.id} onScope={setScope} onInstall={installPackage} onRemove={removePackage} onSetConnector={setConnector} onReconnect={() => workspaceId && void run(selected.id, () => api.reconnectCapabilityConnector(workspaceId, selected.id))} onOpen={(url) => void api.openExternal(url)} /> : null}
          {showCustom ? <div className="capabilities__custom">
            <h2>{t("capabilities.customTitle")}</h2>
            <p>{t("capabilities.customDescription")}</p>
            <label>{t("capabilities.name")}<input value={customName} onChange={(event) => setCustomName(event.target.value)} /></label>
            <label>{t("capabilities.endpoint")}<input value={customUrl} onChange={(event) => setCustomUrl(event.target.value)} placeholder="https://example.com/mcp" /></label>
            <button className="button button--primary" type="button" disabled={Boolean(busyId) || !customName.trim() || !customUrl.trim()} onClick={addCustomConnector}><Plug size={15} />{t("capabilities.connect")}</button>
          </div> : null}
        </article>
      </div>
      <footer className="capabilities__footer"><ShieldCheck size={14} />{t("capabilities.catalogStatus", { date: center ? new Date(center.refreshedAt).toLocaleString() : "-" })}</footer>
    </section>
  );
}

function buildUnlistedInstalledPackageEntries(
  packages: readonly RuntimeConfiguredPackage[],
  catalogSources: ReadonlySet<string>,
): readonly CapabilityCatalogEntry[] {
  const sources = new Set(
    packages
      .filter((item) => item.installed && !catalogSources.has(item.source))
      .map((item) => item.source),
  );

  return [...sources].map((source) => ({
    id: `installed-${stableSourceHash(source)}`,
    kind: "extension" as const,
    name: source,
    description: "Installed package not listed in the capability catalog.",
    category: "Installed packages",
    author: "Local",
    version: "installed",
    trust: "local" as const,
    package: { source },
  }));
}

function stableSourceHash(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function CapabilityDetail({ entry, center, packages, scope, busy, onScope, onInstall, onRemove, onSetConnector, onReconnect, onOpen }: {
  readonly entry: CapabilityCatalogEntry;
  readonly center: CapabilityCenterSnapshot | null;
  readonly packages: readonly RuntimeConfiguredPackage[];
  readonly scope: CapabilityScope;
  readonly busy: boolean;
  readonly onScope: (scope: CapabilityScope) => void;
  readonly onInstall: (entry: CapabilityCatalogEntry) => void;
  readonly onRemove: (entry: CapabilityCatalogEntry, configured: RuntimeConfiguredPackage) => void;
  readonly onSetConnector: (entry: CapabilityCatalogEntry, enabled: boolean) => void;
  readonly onReconnect: () => void;
  readonly onOpen: (url: string) => void;
}) {
  const { t } = useTranslation();
  const configured = entry.package ? packages.find((item) => item.source === entry.package?.source && item.installed) : undefined;
  const connector = center?.connectors.find((item) => item.id === entry.id);
  return <>
    <div className="capabilities__detail-head">
      <div><span className="capabilities__kind">{t(`capabilities.kind.${entry.kind}`)}</span><h2>{entry.name}</h2><p>{entry.description}</p></div>
      {entry.homepage ? <button className="capabilities__icon-button" title={t("capabilities.homepage")} onClick={() => onOpen(entry.homepage!)}><ExternalLink size={16} /></button> : null}
    </div>
    <dl className="capabilities__meta">
      <div><dt>{t("capabilities.author")}</dt><dd>{entry.author}</dd></div>
      <div><dt>{t("capabilities.version")}</dt><dd>{entry.version}</dd></div>
      <div><dt>{t("capabilities.trust")}</dt><dd>{t(`capabilities.trustLevel.${entry.trust}`)}</dd></div>
      {connector ? <div><dt>{t("capabilities.status")}</dt><dd data-status={connector.status}>{t(`capabilities.connectorStatus.${connector.status}`)} · {t("capabilities.toolCount", { count: connector.toolCount })}</dd></div> : null}
    </dl>
    {connector?.error ? <div className="capabilities__error" role="alert">{connector.error}</div> : null}
    <div className="capabilities__permissions"><h3>{t("capabilities.permissions")}</h3><ul>{(entry.permissions ?? []).map((permission) => <li key={permission}>{permission}</li>)}</ul></div>
    <div className="capabilities__actions">
      {entry.kind === "connector" ? connector ? <>
        {connector.status === "error" ? <button className="button" disabled={busy} onClick={onReconnect}><RefreshCw size={15} />{t("common.retry")}</button> : null}
        <button className="button button--danger" disabled={busy} onClick={() => onSetConnector(entry, false)}><Trash2 size={15} />{t("capabilities.disconnect")}</button>
      </> : <button className="button button--primary" disabled={busy} onClick={() => onSetConnector(entry, true)}><Plug size={15} />{t("capabilities.connect")}</button> : configured ?
        <button className="button button--danger" disabled={busy} onClick={() => onRemove(entry, configured)}><Trash2 size={15} />{t("capabilities.remove")}</button> : <>
          <div className="capabilities__scope" role="group" aria-label={t("capabilities.installScope")}>{(["user", "project"] as const).map((value) => <button key={value} className={scope === value ? "is-active" : ""} onClick={() => onScope(value)}>{t(`capabilities.scope.${value}`)}</button>)}</div>
          <button className="button button--primary" disabled={busy} onClick={() => onInstall(entry)}><Download size={15} />{t("capabilities.install")}</button>
        </>}
    </div>
  </>;
}
