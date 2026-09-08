import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Bug,
  Camera,
  CircleStop,
  Columns2,
  Copy,
  ExternalLink,
  FilePlus2,
  Globe,
  LoaderCircle,
  MoreHorizontal,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Pause,
  Play,
  Plus,
  RotateCw,
  RotateCcw,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BrowserSessionState, BrowserSessionTarget } from "./browser-types";
import type { PiDesktopApi } from "./ipc";

export type BrowserLayoutMode = "conversation" | "split" | "browser";

interface BrowserPanelProps {
  readonly api: PiDesktopApi;
  readonly target: BrowserSessionTarget;
  readonly layoutMode: BrowserLayoutMode;
  readonly onLayoutModeChange: (mode: BrowserLayoutMode) => void;
}

export function BrowserPanel({ api, target, layoutMode, onLayoutModeChange }: BrowserPanelProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<BrowserSessionState | null>(null);
  const [address, setAddress] = useState("");
  const [addressEditing, setAddressEditing] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [agentResultVisible, setAgentResultVisible] = useState(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const targetKey = `${target.workspaceId}:${target.sessionId}`;
  const activeTab = useMemo(() => state?.tabs.find((tab) => tab.id === state.activeTabId), [state]);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError("");
    void api.getBrowserState(target).then((next) => {
      if (!cancelled) setState(next);
    }).catch(() => {
      if (!cancelled) setError(t("browser.stateUnavailable"));
    });
    const unsubscribeState = api.onBrowserStateChanged((next) => {
      if (next.target.workspaceId === target.workspaceId && next.target.sessionId === target.sessionId) setState(next);
    });
    const unsubscribeElement = api.onBrowserElementSelected((event) => {
      if (event.target.workspaceId !== target.workspaceId || event.target.sessionId !== target.sessionId) return;
      void api.addComposerAttachments([event.attachment]).then(() => {
        setFeedback(t(event.attachment.kind === "image"
          ? "browser.screenshotAttached"
          : event.attachment.kind === "file"
            ? "browser.downloadAttached"
            : "browser.contextAttached"));
      }).catch(() => setError(t("browser.attachmentFailed")));
    });
    return () => {
      cancelled = true;
      unsubscribeState();
      unsubscribeElement();
    };
  }, [api, targetKey, t]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 2_400);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!state?.agentActivity.completedAt) return;
    setAgentResultVisible(true);
    const timer = window.setTimeout(() => setAgentResultVisible(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [state?.agentActivity.completedAt]);

  useEffect(() => {
    if (!addressEditing) setAddress(activeTab?.url === "about:blank" ? "" : activeTab?.url ?? "");
  }, [activeTab?.url, addressEditing]);

  useEffect(() => {
    if (!state?.addressFocusRequest) return;
    addressRef.current?.focus();
    addressRef.current?.select();
  }, [state?.addressFocusRequest]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setConfirmClear(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    let frame = 0;
    const publish = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        void api.setBrowserSurface({
          target,
          visible: rect.width > 1 && rect.height > 1,
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        }).catch(() => setError(t("browser.surfaceUnavailable")));
      });
    };
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    window.addEventListener("resize", publish);
    publish();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", publish);
      const rect = element.getBoundingClientRect();
      void api.setBrowserSurface({
        target,
        visible: false,
        bounds: { x: rect.x, y: rect.y, width: Math.max(1, rect.width), height: Math.max(1, rect.height) },
      }).catch(() => undefined);
    };
  }, [api, targetKey, layoutMode, t]);

  const command = async (next: Parameters<PiDesktopApi["sendBrowserCommand"]>[1]) => {
    try {
      setError("");
      setState(await api.sendBrowserCommand(target, next));
    } catch {
      setError(t(next.kind === "open-tab" && (state?.tabs.length ?? 0) >= 10 ? "browser.tabLimitReached" : "browser.commandFailed"));
    }
  };

  const navigate = (event: FormEvent) => {
    event.preventDefault();
    if (!address.trim()) return;
    setAddressEditing(false);
    void command({ kind: "navigate", url: address });
  };

  const focusTab = (tabId: string) => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-browser-tab-id="${CSS.escape(tabId)}"]`)?.focus();
    });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tabId: string) => {
    if (!state || (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End")) return;
    event.preventDefault();
    const index = state.tabs.findIndex((tab) => tab.id === tabId);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? state.tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + state.tabs.length) % state.tabs.length;
    const next = state.tabs[nextIndex];
    if (!next) return;
    void command({ kind: "activate-tab", tabId: next.id }).then(() => focusTab(next.id));
  };

  const copyAddress = async () => {
    if (!activeTab?.url) return;
    try {
      await navigator.clipboard.writeText(activeTab.url);
      setFeedback(t("browser.addressCopied"));
      setMenuOpen(false);
    } catch {
      setError(t("browser.copyFailed"));
    }
  };

  const failure = activeTab?.failure;
  const activity = state?.agentActivity;

  return (
    <aside className="browser-panel" data-testid="browser-panel" aria-label={t("browser.panelLabel")}>
      <div className="browser-panel__tabs" role="tablist" aria-label={t("browser.tabs")}>
        <div className="browser-panel__tab-strip">
          {state?.tabs.map((tab) => (
            <div className={`browser-panel__tab-wrap${tab.id === state.activeTabId ? " browser-panel__tab-wrap--active" : ""}`} key={tab.id}>
              <button
                aria-selected={tab.id === state.activeTabId}
                className="browser-panel__tab"
                data-browser-tab-id={tab.id}
                role="tab"
                tabIndex={tab.id === state.activeTabId ? 0 : -1}
                type="button"
                onClick={() => void command({ kind: "activate-tab", tabId: tab.id })}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
              >
                {tab.loading ? <LoaderCircle className="browser-panel__loading" aria-hidden="true" /> : tab.faviconUrl ? <img alt="" src={tab.faviconUrl} /> : <Globe aria-hidden="true" />}
                <span>{tab.title || t("browser.newTab")}</span>
              </button>
              <button
                aria-label={t("browser.closeTabNamed", { name: tab.title || t("browser.newTab") })}
                className="browser-panel__tab-close"
                tabIndex={tab.id === state.activeTabId ? 0 : -1}
                title={t("browser.closeTab")}
                type="button"
                onClick={() => void command({ kind: "close-tab", tabId: tab.id })}
              ><X aria-hidden="true" /></button>
            </div>
          ))}
        </div>
        <IconButton label={t("browser.newTabShortcut")} onClick={() => void command({ kind: "open-tab" })}><Plus aria-hidden="true" /></IconButton>
        <div className="browser-panel__layout-modes" aria-label={t("browser.layout")} role="group">
          <LayoutButton active={layoutMode === "conversation"} label={t("browser.layoutConversation")} onClick={() => onLayoutModeChange("conversation")}><PanelLeft /></LayoutButton>
          <LayoutButton active={layoutMode === "split"} label={t("browser.layoutSplit")} onClick={() => onLayoutModeChange("split")}><Columns2 /></LayoutButton>
          <LayoutButton active={layoutMode === "browser"} label={t("browser.layoutBrowser")} onClick={() => onLayoutModeChange("browser")}><PanelRight /></LayoutButton>
        </div>
      </div>

      <div className="browser-panel__toolbar">
        <IconButton disabled={!activeTab?.canGoBack} label={t("common.back")} onClick={() => void command({ kind: "history", action: "back" })}><ArrowLeft /></IconButton>
        <IconButton disabled={!activeTab?.canGoForward} label={t("browser.forward")} onClick={() => void command({ kind: "history", action: "forward" })}><ArrowRight /></IconButton>
        <IconButton label={activeTab?.loading ? t("browser.stopLoading") : t("common.refresh")} onClick={() => void command({ kind: "history", action: activeTab?.loading ? "stop" : "reload" })}>
          {activeTab?.loading ? <CircleStop /> : <RotateCw />}
        </IconButton>
        <form className="browser-panel__address" onSubmit={navigate}>
          <Globe aria-hidden="true" />
          <input
            ref={addressRef}
            aria-label={t("browser.address")}
            placeholder={t("browser.addressPlaceholder")}
            spellCheck={false}
            value={address}
            onBlur={() => setAddressEditing(false)}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => { setAddressEditing(true); event.currentTarget.select(); }}
          />
        </form>
        <IconButton label={t("browser.attachPage")} onClick={() => void command({ kind: "capture-context", mode: "page" })}><FilePlus2 /></IconButton>
        <IconButton label={t("browser.attachScreenshot")} onClick={() => void command({ kind: "capture-context", mode: "screenshot" })}><Camera /></IconButton>
        <IconButton active={state?.selectionMode} label={t("browser.selectElement")} onClick={() => void command({ kind: "set-selection-mode", enabled: !(state?.selectionMode ?? false) })}><MousePointer2 /></IconButton>
        <div className="browser-panel__menu-wrap" ref={menuRef}>
          <IconButton active={menuOpen} label={t("common.more")} onClick={() => setMenuOpen((current) => !current)}><MoreHorizontal /></IconButton>
          {menuOpen ? (
            <div className="browser-panel__menu" role="menu">
              <MenuButton icon={<Copy />} label={t("browser.copyAddress")} onClick={() => void copyAddress()} />
              <MenuButton disabled={!activeTab?.url || activeTab.url === "about:blank"} icon={<ExternalLink />} label={t("browser.openExternal")} onClick={() => { if (activeTab?.url) void api.openExternal(activeTab.url); setMenuOpen(false); }} />
              <MenuButton disabled={!state?.closedTabCount} icon={<RotateCcw />} label={t("browser.reopenClosedTab")} onClick={() => { void command({ kind: "reopen-closed-tab" }); setMenuOpen(false); }} />
              <MenuButton active={activeTab?.devToolsOpen} icon={<Bug />} label={t("browser.devToolsShortcut")} onClick={() => { void command({ kind: "toggle-devtools" }); setMenuOpen(false); }} />
              <MenuButton active={!state?.persistent} icon={<ShieldOff />} label={t("browser.temporaryMode")} onClick={() => { void command({ kind: "set-persistence", persistent: !(state?.persistent ?? true) }); setMenuOpen(false); }} />
              <MenuButton danger={confirmClear} icon={<Trash2 />} label={t(confirmClear ? "browser.confirmClearData" : "browser.clearData")} onClick={() => {
                if (!confirmClear) { setConfirmClear(true); return; }
                void command({ kind: "clear-data" });
                setConfirmClear(false);
                setMenuOpen(false);
              }} />
            </div>
          ) : null}
        </div>
      </div>

      {activity && (activity.status !== "idle" || (agentResultVisible && activity.lastAction)) ? (
        <div className={`browser-panel__agent browser-panel__agent--${activity.status}`} aria-live="polite">
          <Bot aria-hidden="true" />
          <span>{activity.status === "running" ? t("browser.agentRunning", { action: activity.action }) : activity.status === "paused" ? t("browser.agentPaused") : t(activity.lastResult === "error" ? "browser.agentFailed" : "browser.agentFinished")}</span>
          {activity.status === "running" ? <button type="button" onClick={() => void command({ kind: "agent-control", action: "pause" })}><Pause />{t("browser.pauseAgent")}</button> : null}
          {activity.status === "paused" ? <button type="button" onClick={() => void command({ kind: "agent-control", action: "resume" })}><Play />{t("browser.resumeAgent")}</button> : null}
          {activity.status === "running" ? <button type="button" onClick={() => void command({ kind: "agent-control", action: "takeover" })}>{t("browser.takeOver")}</button> : null}
        </div>
      ) : null}

      {state?.pendingPermission ? (
        <div className="browser-panel__permission" role="alert">
          <span>{t(`browser.permission.${state.pendingPermission.permission}`, { origin: state.pendingPermission.origin })}</span>
          <button type="button" onClick={() => void command({ kind: "resolve-permission", requestId: state.pendingPermission!.id, decision: "deny" })}>{t("common.cancel")}</button>
          <button className="button--primary" type="button" onClick={() => void command({ kind: "resolve-permission", requestId: state.pendingPermission!.id, decision: "allow" })}>{t("browser.allowOnce")}</button>
        </div>
      ) : null}

      {failure ? (
        <div className="browser-panel__failure" role="alert">
          <span>{t(`browser.failure.${failure.kind}`)}</span>
          <button type="button" onClick={() => void command({ kind: "history", action: "back" })}>{t("common.back")}</button>
          <button type="button" onClick={() => void command({ kind: "history", action: "reload" })}>{t("common.retry")}</button>
          <button type="button" onClick={() => { if (activeTab?.url) void api.openExternal(activeTab.url); }}>{t("browser.openExternal")}</button>
        </div>
      ) : null}
      {error ? <div className="browser-panel__error" role="alert">{error}<button aria-label={t("common.dismiss")} type="button" onClick={() => setError("")}><X /></button></div> : null}
      <div className="browser-panel__feedback" aria-live="polite">{feedback}</div>
      <div className="browser-panel__surface" data-testid="browser-surface" ref={surfaceRef}>
        {!state ? <LoaderCircle className="browser-panel__surface-loading" aria-label={t("common.loading")} /> : null}
      </div>
    </aside>
  );
}

function IconButton({ active, disabled, label, onClick, children }: { readonly active?: boolean; readonly disabled?: boolean; readonly label: string; readonly onClick: () => void; readonly children: React.ReactNode }) {
  return <button aria-label={label} aria-pressed={active} className={`browser-panel__icon-button${active ? " browser-panel__icon-button--active" : ""}`} disabled={disabled} title={label} type="button" onClick={onClick}>{children}</button>;
}

function LayoutButton({ active, label, onClick, children }: { readonly active: boolean; readonly label: string; readonly onClick: () => void; readonly children: React.ReactNode }) {
  return <button aria-label={label} aria-pressed={active} className={active ? "browser-panel__layout-button--active" : ""} title={label} type="button" onClick={onClick}>{children}</button>;
}

function MenuButton({ active, danger, disabled, icon, label, onClick }: { readonly active?: boolean; readonly danger?: boolean; readonly disabled?: boolean; readonly icon: React.ReactNode; readonly label: string; readonly onClick: () => void }) {
  return <button aria-checked={active} className={danger ? "browser-panel__menu-item--danger" : ""} disabled={disabled} role={active === undefined ? "menuitem" : "menuitemcheckbox"} type="button" onClick={onClick}>{icon}<span>{label}</span></button>;
}
