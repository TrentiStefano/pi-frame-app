import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { BrowserWindow, session, WebContentsView, type Rectangle, type Session, type WebContents } from "electron";
import type {
  BrowserCommand,
  BrowserElementAttachment,
  BrowserElementSelectedEvent,
  BrowserSessionState,
  BrowserSessionTarget,
  BrowserSurfaceBounds,
  BrowserTabState,
} from "../src/browser-types";
import { JsonFileStore } from "./json-file-store";

const MAX_TABS = 10;
const PAGE_CHANNEL = "pi-browser-page";
const SEARCH_URL = "https://www.bing.com/search?q=";

export interface BrowserObservation {
  readonly tab: BrowserTabState;
  readonly nodes: readonly {
    readonly ref: string;
    readonly tag: string;
    readonly role?: string;
    readonly name?: string;
    readonly text?: string;
    readonly disabled?: boolean;
  }[];
}

export interface BrowserScreenshot {
  readonly data: string;
  readonly mimeType: "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly tab: BrowserTabState;
}

export interface BrowserWaitOptions {
  readonly state: "loaded" | "text-visible" | "text-hidden";
  readonly text?: string;
  readonly timeoutMs: number;
}

export type BrowserAction =
  | { readonly kind: "click"; readonly ref: string; readonly revision: number }
  | { readonly kind: "hover"; readonly ref: string; readonly revision: number }
  | { readonly kind: "type"; readonly ref: string; readonly revision: number; readonly text: string; readonly replace?: boolean }
  | { readonly kind: "press"; readonly ref?: string; readonly revision: number; readonly key: string }
  | { readonly kind: "select"; readonly ref: string; readonly revision: number; readonly values: readonly string[] }
  | { readonly kind: "scroll"; readonly ref?: string; readonly revision: number; readonly deltaX?: number; readonly deltaY?: number };

interface BrowserTab {
  readonly id: string;
  readonly view: WebContentsView;
  readonly webContents: WebContents;
  devToolsView?: WebContentsView;
  devToolsOpen: boolean;
  loading: boolean;
  crashed: boolean;
  revision: number;
  title: string;
  url: string;
  faviconUrl?: string;
  failure?: BrowserTabState["failure"];
  pending: Map<string, PendingPageRequest>;
}

interface PersistedBrowserThread {
  readonly target: BrowserSessionTarget;
  readonly tabs: readonly { readonly id: string; readonly url: string }[];
  readonly activeTabId: string | null;
  readonly closedTabs: readonly string[];
}

interface PendingPermission {
  readonly id: string;
  readonly permission: "clipboard" | "notifications" | "geolocation" | "file-upload" | "download";
  readonly origin: string;
  readonly requestedAt: string;
  readonly callback?: (allowed: boolean) => void;
  readonly tabId?: string;
  readonly downloadUrl?: string;
}

interface ApprovedDownload {
  readonly origin: string;
  readonly url: string;
}

interface PendingPageRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

interface BrowserThread {
  readonly target: BrowserSessionTarget;
  readonly partition: string;
  readonly session: Session;
  readonly tabs: Map<string, BrowserTab>;
  activeTabId: string | null;
  selectionMode: boolean;
  closedTabs: string[];
  agentActivity: BrowserSessionState["agentActivity"];
  agentAbort?: AbortController;
  pendingPermission?: PendingPermission;
  approvedDownload?: ApprovedDownload;
  addressFocusRequest: number;
  persistent: boolean;
  surfaceOwner: BrowserWindow | null;
  surfaceBounds: Rectangle;
  attachedTabId: string | null;
}

export class BrowserService {
  private readonly threads = new Map<string, BrowserThread>();
  private readonly persisted = new Map<string, PersistedBrowserThread>();
  private readonly stateStore: JsonFileStore<PersistedBrowserThread>;

  constructor(
    private readonly options: {
      readonly preloadPath: string;
      readonly userDataDir: string;
      readonly onStateChanged: (target: BrowserSessionTarget, state: BrowserSessionState) => void;
      readonly onElementSelected: (event: BrowserElementSelectedEvent) => void;
    },
  ) {
    this.stateStore = new JsonFileStore<PersistedBrowserThread>(options.userDataDir, "browser-sessions");
  }

  async initialize(): Promise<void> {
    const keys = await this.stateStore.listKeys();
    await Promise.all(keys.map(async (key) => {
      const value = await this.stateStore.read(key);
      if (isPersistedBrowserThread(value)) this.persisted.set(key, value);
    }));
  }

  getState(target: BrowserSessionTarget): BrowserSessionState {
    return this.stateFor(this.ensureThread(target));
  }

  async command(target: BrowserSessionTarget, command: BrowserCommand): Promise<BrowserSessionState> {
    const thread = this.ensureThread(target);
    switch (command.kind) {
      case "open-tab": {
        const tab = this.createTab(thread, command.url ?? "about:blank");
        thread.activeTabId = tab.id;
        this.attachActiveTab(thread);
        break;
      }
      case "activate-tab": {
        this.requireTab(thread, command.tabId);
        thread.activeTabId = command.tabId;
        this.attachActiveTab(thread);
        break;
      }
      case "close-tab": {
        this.closeTab(thread, command.tabId);
        break;
      }
      case "navigate": {
        const tab = this.activeOr(thread, command.tabId);
        await tab.webContents.loadURL(normalizeBrowserInput(command.url));
        break;
      }
      case "history": {
        const tab = this.activeOr(thread, command.tabId);
        if (command.action === "back" && tab.webContents.canGoBack()) tab.webContents.goBack();
        if (command.action === "forward" && tab.webContents.canGoForward()) tab.webContents.goForward();
        if (command.action === "reload") tab.webContents.reload();
        if (command.action === "stop") tab.webContents.stop();
        break;
      }
      case "toggle-devtools": {
        const tab = this.activeOr(thread, command.tabId);
        this.setDevToolsOpen(thread, tab, command.open ?? !tab.devToolsOpen);
        break;
      }
      case "set-selection-mode": {
        thread.selectionMode = command.enabled;
        const tab = thread.activeTabId ? thread.tabs.get(thread.activeTabId) : undefined;
        if (tab) this.sendPageCommand(tab, "set-selection-mode", { enabled: command.enabled });
        break;
      }
      case "reopen-closed-tab": {
        const url = thread.closedTabs.shift();
        if (!url) break;
        const tab = this.createTab(thread, url);
        thread.activeTabId = tab.id;
        this.attachActiveTab(thread);
        break;
      }
      case "capture-context": {
        await this.captureContext(thread, command.mode);
        break;
      }
      case "agent-control": {
        if (command.action !== "resume") thread.agentAbort?.abort();
        thread.agentActivity = command.action === "resume"
          ? { status: "idle", lastAction: thread.agentActivity.lastAction, lastResult: thread.agentActivity.lastResult }
          : { ...thread.agentActivity, status: "paused", action: undefined, startedAt: undefined };
        break;
      }
      case "resolve-permission": {
        this.resolvePermission(thread, command.requestId, command.decision === "allow");
        break;
      }
      case "set-persistence": {
        thread.persistent = command.persistent;
        if (!command.persistent) {
          await thread.session.clearStorageData({ storages: ["cookies", "localstorage", "cachestorage", "serviceworkers"] });
          this.persisted.delete(browserTargetKey(thread.target));
          await this.stateStore.remove(browserTargetKey(thread.target));
        }
        break;
      }
      case "clear-data": {
        await this.clearThreadData(thread);
        break;
      }
    }
    this.persistThread(thread);
    this.emit(thread);
    return this.stateFor(thread);
  }

  async withAgentActivity<T>(target: BrowserSessionTarget, action: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const thread = this.ensureThread(target);
    if (thread.agentActivity.status === "paused") {
      throw new Error("browser_paused: the user has paused browser automation");
    }
    const tabId = thread.activeTabId ?? undefined;
    const controller = new AbortController();
    thread.agentAbort = controller;
    thread.agentActivity = { status: "running", action, tabId, startedAt: new Date().toISOString() };
    this.emit(thread);
    try {
      const result = await run(controller.signal);
      if (thread.agentActivity.status !== "paused") {
        thread.agentActivity = { status: "idle", lastAction: action, lastResult: "success", completedAt: new Date().toISOString() };
      }
      this.emit(thread);
      return result;
    } catch (error) {
      if (thread.agentActivity.status !== "paused") {
        thread.agentActivity = { status: "idle", lastAction: action, lastResult: "error", completedAt: new Date().toISOString() };
      }
      this.emit(thread);
      throw error;
    } finally {
      if (thread.agentAbort === controller) thread.agentAbort = undefined;
    }
  }

  setSurface(window: BrowserWindow, input: BrowserSurfaceBounds): BrowserSessionState {
    const thread = this.ensureThread(input.target);
    if (!input.visible && thread.surfaceOwner !== window) {
      return this.stateFor(thread);
    }
    if (thread.surfaceOwner && thread.surfaceOwner !== window && !thread.surfaceOwner.isDestroyed()) {
      const active = this.activeTab(thread);
      if (active) this.removeTabViews(thread.surfaceOwner, active);
      thread.attachedTabId = null;
    }
    thread.surfaceOwner = input.visible ? window : null;
    thread.surfaceBounds = sanitizeBounds(input.bounds);
    if (input.visible) this.attachActiveTab(thread);
    else {
      const active = this.activeTab(thread);
      if (active && !window.isDestroyed()) this.removeTabViews(window, active);
      thread.attachedTabId = null;
    }
    this.emit(thread);
    return this.stateFor(thread);
  }

  async observe(target: BrowserSessionTarget, tabId?: string, signal?: AbortSignal): Promise<BrowserObservation> {
    const thread = this.ensureThread(target);
    const tab = this.activeOr(thread, tabId);
    const result = await this.requestPage(tab, "observe", { revision: tab.revision }, signal);
    return {
      tab: this.tabState(tab),
      nodes: isRecord(result) && Array.isArray(result.nodes) ? result.nodes as BrowserObservation["nodes"] : [],
    };
  }

  async act(target: BrowserSessionTarget, tabId: string | undefined, action: BrowserAction, signal?: AbortSignal): Promise<unknown> {
    const thread = this.ensureThread(target);
    const tab = this.activeOr(thread, tabId);
    if (action.revision !== tab.revision) {
      throw new Error("stale_page: observe the tab again before acting");
    }
    return this.requestPage(tab, "act", action, signal);
  }

  async screenshot(target: BrowserSessionTarget, tabId?: string, signal?: AbortSignal): Promise<BrowserScreenshot> {
    const thread = this.ensureThread(target);
    const tab = this.activeOr(thread, tabId);
    throwIfAborted(signal);
    const image = await tab.webContents.capturePage();
    throwIfAborted(signal);
    const size = image.getSize();
    return {
      data: image.toJPEG(82).toString("base64"),
      mimeType: "image/jpeg",
      width: size.width,
      height: size.height,
      tab: this.tabState(tab),
    };
  }

  async waitFor(target: BrowserSessionTarget, tabId: string | undefined, options: BrowserWaitOptions, signal?: AbortSignal): Promise<unknown> {
    const thread = this.ensureThread(target);
    const tab = this.activeOr(thread, tabId);
    const startedAt = Date.now();
    while (true) {
      throwIfAborted(signal);
      let matched = options.state === "loaded" ? !tab.loading : false;
      if (options.state !== "loaded") {
        const remaining = options.timeoutMs - (Date.now() - startedAt);
        if (remaining <= 0) throw new Error(`browser wait timed out after ${options.timeoutMs}ms`);
        const result = await this.requestPage(
          tab,
          "text-state",
          { text: options.text },
          signal,
          remaining,
          `browser wait timed out after ${options.timeoutMs}ms`,
        );
        const visible = isRecord(result) && result.visible === true;
        matched = options.state === "text-visible" ? visible : !visible;
      }
      if (matched) {
        return { state: options.state, text: options.text, elapsedMs: Date.now() - startedAt, tab: this.tabState(tab) };
      }
      const remaining = options.timeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) throw new Error(`browser wait timed out after ${options.timeoutMs}ms`);
      await abortableDelay(Math.min(150, remaining), signal);
    }
  }

  disposeWindow(window: BrowserWindow): void {
    for (const thread of this.threads.values()) {
      if (thread.surfaceOwner === window) {
        const active = this.activeTab(thread);
        if (active && !window.isDestroyed()) this.removeTabViews(window, active);
        thread.surfaceOwner = null;
        thread.attachedTabId = null;
        this.emit(thread);
      }
    }
  }

  dispose(): void {
    for (const thread of this.threads.values()) {
      this.persistThread(thread);
      for (const tab of thread.tabs.values()) {
        this.destroyTab(tab);
      }
      thread.pendingPermission?.callback?.(false);
      if (!thread.persistent) void thread.session.clearStorageData().catch(() => undefined);
    }
    this.threads.clear();
  }

  private ensureThread(target: BrowserSessionTarget): BrowserThread {
    const key = browserTargetKey(target);
    const existing = this.threads.get(key);
    if (existing) return existing;
    const partition = `persist:pi-browser-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
    const browserSession = session.fromPartition(partition);
    const restored = this.persisted.get(key);
    const thread: BrowserThread = {
      target: { ...target },
      partition,
      session: browserSession,
      tabs: new Map(),
      activeTabId: restored?.activeTabId ?? null,
      selectionMode: false,
      closedTabs: [...(restored?.closedTabs ?? [])].slice(0, 10),
      agentActivity: { status: "idle" },
      addressFocusRequest: 0,
      persistent: true,
      surfaceOwner: null,
      surfaceBounds: { x: 0, y: 0, width: 1, height: 1 },
      attachedTabId: null,
    };
    browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const supported = supportedPermission(permission);
      if (!supported) {
        callback(false);
        return;
      }
      this.requestPermission(thread, {
        permission: supported,
        origin: safeOrigin(details.requestingUrl || webContents.getURL()),
        callback,
        tabId: this.tabIdForWebContents(thread, webContents),
      });
    });
    browserSession.on("will-download", (_event, item, webContents) => {
      const approved = thread.approvedDownload;
      if (approved) {
        thread.approvedDownload = undefined;
        const filename = safeDownloadFilename(item.getFilename());
        const directory = path.join(this.options.userDataDir, "browser-downloads", createHash("sha256").update(key).digest("hex").slice(0, 24));
        mkdirSync(directory, { recursive: true });
        const savePath = path.join(directory, `${Date.now()}-${randomUUID().slice(0, 8)}-${filename}`);
        item.setSavePath(savePath);
        item.once("done", (_doneEvent, state) => {
          if (state !== "completed") return;
          const sourceName = hostnameForDisplay(approved.url) || approved.origin;
          this.options.onElementSelected({
            target: thread.target,
            attachment: {
              id: randomUUID(),
              kind: "file",
              name: sourceName ? `${filename} (from ${sourceName})` : filename,
              mimeType: item.getMimeType() || "application/octet-stream",
              fsPath: savePath,
              sizeBytes: item.getReceivedBytes(),
            },
          });
        });
        return;
      }
      item.cancel();
      this.requestPermission(thread, {
        permission: "download",
        origin: safeOrigin(item.getURL() || webContents.getURL()),
        tabId: this.tabIdForWebContents(thread, webContents),
        downloadUrl: item.getURL() || webContents.getURL(),
      });
    });
    this.threads.set(key, thread);
    for (const tab of restored?.tabs.slice(0, MAX_TABS) ?? []) this.createTab(thread, tab.url, tab.id);
    if (thread.tabs.size === 0) this.createTab(thread, "about:blank");
    if (!thread.activeTabId || !thread.tabs.has(thread.activeTabId)) thread.activeTabId = [...thread.tabs.keys()][0] ?? null;
    return thread;
  }

  private createTab(thread: BrowserThread, inputUrl: string, restoredId?: string): BrowserTab {
    if (thread.tabs.size >= MAX_TABS) throw new Error(`Browser supports at most ${MAX_TABS} tabs per thread`);
    const url = normalizeBrowserInput(inputUrl);
    const view = new WebContentsView({
      webPreferences: {
        partition: thread.partition,
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    const tab: BrowserTab = {
      id: restoredId ?? randomUUID(),
      view,
      webContents: view.webContents,
      devToolsOpen: false,
      loading: true,
      crashed: false,
      revision: 0,
      title: "New tab",
      url,
      failure: undefined,
      pending: new Map(),
    };
    thread.tabs.set(tab.id, tab);
    const wc = tab.webContents;
    wc.on("did-start-loading", () => { tab.loading = true; tab.failure = undefined; this.emit(thread); });
    wc.on("did-stop-loading", () => { tab.loading = false; this.emit(thread); });
    wc.on("page-title-updated", (_event, title) => { tab.title = title.trim() || tab.title; this.persistThread(thread); this.emit(thread); });
    wc.on("page-favicon-updated", (_event, favicons) => { tab.faviconUrl = favicons.find(isAllowedBrowserUrl); this.emit(thread); });
    wc.on("did-navigate", (_event, url) => { tab.url = sanitizeUrl(url); tab.revision += 1; tab.failure = undefined; this.persistThread(thread); this.emit(thread); });
    wc.on("did-navigate-in-page", (_event, url) => { tab.url = sanitizeUrl(url); tab.revision += 1; tab.failure = undefined; this.persistThread(thread); this.emit(thread); });
    wc.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      tab.loading = false;
      tab.url = sanitizeUrl(validatedURL || tab.url);
      tab.failure = classifyNavigationFailure(errorCode, errorDescription);
      this.emit(thread);
    });
    wc.on("render-process-gone", (_event, details) => {
      tab.crashed = details.reason !== "clean-exit" && details.reason !== "killed";
      if (tab.crashed) tab.failure = { kind: "crashed", code: details.reason };
      tab.loading = false;
      if (tab.crashed) console.error("pi browser render process gone", { reason: details.reason, exitCode: details.exitCode });
      this.emit(thread);
    });
    wc.on("devtools-opened", () => {
      tab.devToolsOpen = true;
      this.attachActiveTab(thread);
      this.emit(thread);
    });
    wc.on("devtools-closed", () => {
      tab.devToolsOpen = false;
      this.destroyDevToolsView(thread, tab);
      this.attachActiveTab(thread);
      this.emit(thread);
    });
    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      if (isDevToolsShortcut(input)) {
        event.preventDefault();
        this.setDevToolsOpen(thread, tab, !tab.devToolsOpen);
        this.emit(thread);
        return;
      }
      const shortcut = browserShortcut(input);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut === "address") {
        thread.addressFocusRequest += 1;
        this.emit(thread);
      } else if (shortcut === "new-tab") {
        void this.command(thread.target, { kind: "open-tab" });
      } else if (shortcut === "reopen-tab") {
        void this.command(thread.target, { kind: "reopen-closed-tab" });
      } else if (shortcut === "close-tab") {
        this.closeTab(thread, tab.id);
        this.persistThread(thread);
        this.emit(thread);
      } else if (shortcut === "back" && tab.webContents.canGoBack()) {
        tab.webContents.goBack();
      } else if (shortcut === "forward" && tab.webContents.canGoForward()) {
        tab.webContents.goForward();
      }
    });
    wc.on("will-navigate", (event, nextUrl) => {
      if (!isAllowedBrowserUrl(nextUrl)) event.preventDefault();
    });
    wc.on("will-attach-webview", (event) => event.preventDefault());
    wc.setWindowOpenHandler(({ url: nextUrl }) => {
      if (isAllowedBrowserUrl(nextUrl)) void this.command(thread.target, { kind: "open-tab", url: nextUrl });
      return { action: "deny" };
    });
    wc.ipc.on(`${PAGE_CHANNEL}:element-selected`, (_event, payload) => {
      this.handleElementSelected(thread, tab, payload);
    });
    wc.ipc.on(`${PAGE_CHANNEL}:response`, (_event, payload) => {
      this.handlePageResponse(tab, payload);
    });
    wc.ipc.on(`${PAGE_CHANNEL}:selection-cancelled`, () => {
      if (!thread.selectionMode) return;
      thread.selectionMode = false;
      this.emit(thread);
    });
    wc.ipc.on(`${PAGE_CHANNEL}:permission-requested`, (_event, payload) => {
      if (!isRecord(payload) || payload.permission !== "file-upload") return;
      this.requestPermission(thread, {
        permission: "file-upload",
        origin: safeOrigin(tab.url),
        tabId: tab.id,
      });
    });
    void wc.loadURL(url).catch((error) => {
      tab.loading = false;
      tab.failure = { kind: "network" };
      console.error("pi browser navigation failed", error);
      this.emit(thread);
    });
    return tab;
  }

  private closeTab(thread: BrowserThread, tabId: string): void {
    const tab = this.requireTab(thread, tabId);
    const tabIds = [...thread.tabs.keys()];
    const closedIndex = tabIds.indexOf(tabId);
    if (tab.url !== "about:blank") thread.closedTabs.unshift(tab.url);
    thread.closedTabs = thread.closedTabs.slice(0, 10);
    if (thread.surfaceOwner && !thread.surfaceOwner.isDestroyed()) this.removeTabViews(thread.surfaceOwner, tab);
    this.destroyTab(tab);
    thread.tabs.delete(tab.id);
    if (thread.tabs.size === 0) {
      const replacement = this.createTab(thread, "about:blank");
      thread.activeTabId = replacement.id;
      return;
    }
    if (thread.activeTabId === tab.id) {
      const remaining = [...thread.tabs.keys()];
      thread.activeTabId = remaining[Math.min(Math.max(0, closedIndex), remaining.length - 1)] ?? null;
    }
    this.attachActiveTab(thread);
  }

  private attachActiveTab(thread: BrowserThread): void {
    const owner = thread.surfaceOwner;
    const active = this.activeTab(thread);
    if (!owner || owner.isDestroyed() || !active) return;
    if (thread.attachedTabId === active.id) {
      this.attachDevToolsView(owner, active);
      this.layoutTab(active, thread.surfaceBounds);
      return;
    }
    for (const tab of thread.tabs.values()) {
      if (tab !== active) this.removeTabViews(owner, tab);
    }
    owner.contentView.addChildView(active.view);
    this.attachDevToolsView(owner, active);
    this.layoutTab(active, thread.surfaceBounds);
    thread.attachedTabId = active.id;
    this.sendPageCommand(active, "set-selection-mode", { enabled: thread.selectionMode });
  }

  private activeTab(thread: BrowserThread): BrowserTab | undefined {
    return thread.activeTabId ? thread.tabs.get(thread.activeTabId) : undefined;
  }

  private activeOr(thread: BrowserThread, tabId?: string): BrowserTab {
    return this.requireTab(thread, tabId ?? thread.activeTabId ?? "");
  }

  private requireTab(thread: BrowserThread, tabId: string): BrowserTab {
    const tab = thread.tabs.get(tabId);
    if (!tab) throw new Error(`Unknown browser tab: ${tabId}`);
    return tab;
  }

  private tabState(tab: BrowserTab): BrowserTabState {
    return {
      id: tab.id,
      title: tab.title,
      url: sanitizeUrl(tab.url),
      loading: tab.loading,
      crashed: tab.crashed,
      canGoBack: tab.webContents.canGoBack(),
      canGoForward: tab.webContents.canGoForward(),
      devToolsOpen: tab.devToolsOpen,
      revision: tab.revision,
      ...(tab.faviconUrl ? { faviconUrl: tab.faviconUrl } : {}),
      ...(tab.failure ? { failure: tab.failure } : {}),
    };
  }

  private stateFor(thread: BrowserThread): BrowserSessionState {
    return {
      target: thread.target,
      tabs: [...thread.tabs.values()].map((tab) => this.tabState(tab)),
      activeTabId: thread.activeTabId,
      selectionMode: thread.selectionMode,
      persistent: thread.persistent,
      closedTabCount: thread.closedTabs.length,
      agentActivity: thread.agentActivity,
      ...(thread.pendingPermission ? { pendingPermission: permissionState(thread.pendingPermission) } : {}),
      addressFocusRequest: thread.addressFocusRequest,
      ...(thread.surfaceOwner ? { surfaceOwnerWebContentsId: thread.surfaceOwner.webContents.id } : {}),
    };
  }

  private emit(thread: BrowserThread): void {
    this.options.onStateChanged(thread.target, this.stateFor(thread));
  }

  private setDevToolsOpen(thread: BrowserThread, tab: BrowserTab, open: boolean): void {
    if (tab.webContents.isDestroyed() || tab.devToolsOpen === open) return;
    if (!open) {
      tab.devToolsOpen = false;
      tab.webContents.closeDevTools();
      this.destroyDevToolsView(thread, tab);
      this.attachActiveTab(thread);
      return;
    }
    const devToolsView = new WebContentsView();
    tab.devToolsView = devToolsView;
    tab.devToolsOpen = true;
    tab.webContents.setDevToolsWebContents(devToolsView.webContents);
    if (thread.activeTabId === tab.id) this.attachActiveTab(thread);
    tab.webContents.openDevTools({ mode: "detach", activate: true });
  }

  private attachDevToolsView(owner: BrowserWindow, tab: BrowserTab): void {
    if (tab.devToolsOpen && tab.devToolsView && !tab.devToolsView.webContents.isDestroyed()) {
      owner.contentView.addChildView(tab.devToolsView);
    }
  }

  private removeTabViews(owner: BrowserWindow, tab: BrowserTab): void {
    owner.contentView.removeChildView(tab.view);
    if (tab.devToolsView) owner.contentView.removeChildView(tab.devToolsView);
  }

  private layoutTab(tab: BrowserTab, bounds: Rectangle): void {
    if (!tab.devToolsOpen || !tab.devToolsView || tab.devToolsView.webContents.isDestroyed()) {
      tab.view.setBounds(bounds);
      return;
    }
    const divider = 1;
    if (bounds.width >= 900) {
      const pageWidth = Math.max(1, Math.round(bounds.width * 0.56));
      tab.view.setBounds({ ...bounds, width: pageWidth });
      tab.devToolsView.setBounds({
        x: bounds.x + pageWidth + divider,
        y: bounds.y,
        width: Math.max(1, bounds.width - pageWidth - divider),
        height: bounds.height,
      });
      return;
    }
    const pageHeight = Math.max(1, Math.round(bounds.height * 0.55));
    tab.view.setBounds({ ...bounds, height: pageHeight });
    tab.devToolsView.setBounds({
      x: bounds.x,
      y: bounds.y + pageHeight + divider,
      width: bounds.width,
      height: Math.max(1, bounds.height - pageHeight - divider),
    });
  }

  private destroyDevToolsView(thread: BrowserThread, tab: BrowserTab): void {
    const devToolsView = tab.devToolsView;
    if (!devToolsView) return;
    if (thread.surfaceOwner && !thread.surfaceOwner.isDestroyed()) {
      thread.surfaceOwner.contentView.removeChildView(devToolsView);
    }
    tab.devToolsView = undefined;
    if (!devToolsView.webContents.isDestroyed()) devToolsView.webContents.close({ waitForBeforeUnload: false });
  }

  private destroyTab(tab: BrowserTab): void {
    for (const pending of tab.pending.values()) {
      this.finishPending(pending);
      pending.reject(new Error("browser tab closed before the page command completed"));
    }
    tab.pending.clear();
    if (tab.devToolsView && !tab.devToolsView.webContents.isDestroyed()) {
      tab.devToolsView.webContents.close({ waitForBeforeUnload: false });
    }
    tab.devToolsView = undefined;
    if (!tab.webContents.isDestroyed()) tab.webContents.close({ waitForBeforeUnload: false });
  }

  private sendPageCommand(tab: BrowserTab, kind: string, payload: unknown): void {
    if (!tab.webContents.isDestroyed()) tab.webContents.send(`${PAGE_CHANNEL}:command`, { kind, payload });
  }

  private requestPage(
    tab: BrowserTab,
    kind: string,
    payload: unknown,
    signal?: AbortSignal,
    timeoutMs = 15_000,
    timeoutMessage = "browser page command timed out",
  ): Promise<unknown> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("browser operation aborted"));
        return;
      }
      const onAbort = signal ? () => {
        const pending = tab.pending.get(requestId);
        if (!pending) return;
        tab.pending.delete(requestId);
        this.finishPending(pending);
        reject(new Error("browser operation aborted"));
      } : undefined;
      const timer = setTimeout(() => {
        const pending = tab.pending.get(requestId);
        if (!pending) return;
        tab.pending.delete(requestId);
        this.finishPending(pending);
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      tab.pending.set(requestId, { resolve, reject, timer, signal, onAbort });
      if (signal && onAbort) {
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
          onAbort();
          return;
        }
      }
      this.sendPageCommand(tab, kind, { requestId, payload });
    });
  }

  private handlePageResponse(tab: BrowserTab, payload: unknown): void {
    if (!isRecord(payload) || typeof payload.requestId !== "string") return;
    const pending = tab.pending.get(payload.requestId);
    if (!pending) return;
    tab.pending.delete(payload.requestId);
    this.finishPending(pending);
    if (payload.error) pending.reject(new Error(String(payload.error)));
    else pending.resolve(payload.result);
  }

  private finishPending(pending: PendingPageRequest): void {
    clearTimeout(pending.timer);
    if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
  }

  private async captureContext(thread: BrowserThread, mode: "page" | "screenshot"): Promise<void> {
    const tab = this.activeOr(thread);
    const observed = await this.observe(thread.target, tab.id);
    const summary = observed.nodes
      .flatMap((node) => node.name || node.text ? [`${node.role ?? node.tag}: ${node.name ?? node.text}`] : [])
      .slice(0, 40)
      .join("\n")
      .slice(0, 4_000);
    const attachment: BrowserElementAttachment = {
      id: randomUUID(),
      kind: "browser-element",
      name: `Page: ${tab.title || sanitizeUrl(tab.url)}`.slice(0, 120),
      tabId: tab.id,
      capturedAt: new Date().toISOString(),
      page: { url: sanitizeUrl(tab.url), title: tab.title, revision: tab.revision },
      frameUrl: sanitizeUrl(tab.url),
      element: {
        tag: "document",
        role: "document",
        accessibleName: tab.title,
        text: summary,
        attributes: {},
        locator: { kind: "css", value: "html", unique: true },
        cssFallback: "html",
        ancestors: [],
      },
    };
    this.options.onElementSelected({ target: thread.target, attachment });
    if (mode === "screenshot") {
      const screenshot = await this.screenshot(thread.target, tab.id);
      this.options.onElementSelected({
        target: thread.target,
        attachment: {
          id: randomUUID(),
          kind: "image",
          name: `${tab.title || "Page"} screenshot.jpg`.slice(0, 120),
          mimeType: screenshot.mimeType,
          data: screenshot.data,
        },
      });
    }
  }

  private requestPermission(
    thread: BrowserThread,
    input: Omit<PendingPermission, "id" | "requestedAt">,
  ): void {
    thread.pendingPermission?.callback?.(false);
    thread.pendingPermission = {
      ...input,
      id: randomUUID(),
      requestedAt: new Date().toISOString(),
    };
    this.emit(thread);
  }

  private resolvePermission(thread: BrowserThread, requestId: string, allow: boolean): void {
    const pending = thread.pendingPermission;
    if (!pending || pending.id !== requestId) return;
    thread.pendingPermission = undefined;
    pending.callback?.(allow);
    if (allow && pending.permission === "file-upload" && pending.tabId) {
      const tab = thread.tabs.get(pending.tabId);
      if (tab) this.sendPageCommand(tab, "allow-file-input-once", {});
    }
    if (allow && pending.permission === "download") {
      thread.approvedDownload = {
        origin: pending.origin,
        url: pending.downloadUrl ?? pending.origin,
      };
    }
  }

  private async clearThreadData(thread: BrowserThread): Promise<void> {
    thread.agentAbort?.abort();
    thread.agentAbort = undefined;
    thread.approvedDownload = undefined;
    thread.pendingPermission?.callback?.(false);
    thread.pendingPermission = undefined;
    for (const tab of thread.tabs.values()) {
      if (thread.surfaceOwner && !thread.surfaceOwner.isDestroyed()) this.removeTabViews(thread.surfaceOwner, tab);
      this.destroyTab(tab);
    }
    thread.tabs.clear();
    thread.closedTabs = [];
    thread.activeTabId = null;
    thread.attachedTabId = null;
    thread.selectionMode = false;
    thread.agentActivity = { status: "idle" };
    await thread.session.clearStorageData();
    const key = browserTargetKey(thread.target);
    this.persisted.delete(key);
    await this.stateStore.remove(key);
    const tab = this.createTab(thread, "about:blank");
    thread.activeTabId = tab.id;
    this.attachActiveTab(thread);
  }

  private persistThread(thread: BrowserThread): void {
    const key = browserTargetKey(thread.target);
    if (!thread.persistent) return;
    const value: PersistedBrowserThread = {
      target: thread.target,
      tabs: [...thread.tabs.values()].map((tab) => ({ id: tab.id, url: sanitizeUrl(tab.url) })),
      activeTabId: thread.activeTabId,
      closedTabs: thread.closedTabs,
    };
    this.persisted.set(key, value);
    void this.stateStore.write(key, value).catch((error) => {
      console.error("pi browser session persistence failed", error);
    });
  }

  private tabIdForWebContents(thread: BrowserThread, webContents: WebContents): string | undefined {
    return [...thread.tabs.values()].find((tab) => tab.webContents === webContents)?.id;
  }

  private handleElementSelected(thread: BrowserThread, tab: BrowserTab, payload: unknown): void {
    if (!isRecord(payload) || !isRecord(payload.element)) return;
    const element = payload.element;
    if (typeof element.tag !== "string" || !isRecord(element.locator)) return;
    const attachment: BrowserElementAttachment = {
      id: randomUUID(),
      kind: "browser-element",
      name: buildElementName(element),
      tabId: tab.id,
      capturedAt: new Date().toISOString(),
      page: { url: sanitizeUrl(tab.url), title: tab.title, revision: tab.revision },
      frameUrl: sanitizeUrl(tab.url),
      element: sanitizeElement(element),
    };
    thread.selectionMode = false;
    this.sendPageCommand(tab, "set-selection-mode", { enabled: false });
    this.options.onElementSelected({ target: thread.target, attachment });
    this.emit(thread);
  }
}

export function browserTargetKey(target: BrowserSessionTarget): string {
  return `${encodeURIComponent(target.workspaceId)}-${encodeURIComponent(target.sessionId)}`;
}

function isPersistedBrowserThread(value: unknown): value is PersistedBrowserThread {
  if (!isRecord(value) || !isRecord(value.target) || !Array.isArray(value.tabs)) return false;
  if (typeof value.target.workspaceId !== "string" || typeof value.target.sessionId !== "string") return false;
  return value.tabs.every((tab) => isRecord(tab) && typeof tab.id === "string" && typeof tab.url === "string")
    && (value.activeTabId === null || typeof value.activeTabId === "string")
    && Array.isArray(value.closedTabs)
    && value.closedTabs.every((url) => typeof url === "string");
}

function permissionState(permission: PendingPermission): NonNullable<BrowserSessionState["pendingPermission"]> {
  return {
    id: permission.id,
    permission: permission.permission,
    origin: permission.origin,
    requestedAt: permission.requestedAt,
  };
}

function supportedPermission(value: string): PendingPermission["permission"] | undefined {
  if (value === "clipboard-read" || value === "clipboard-sanitized-write") return "clipboard";
  if (value === "notifications") return "notifications";
  if (value === "geolocation") return "geolocation";
  return undefined;
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "unknown origin";
  }
}

function hostnameForDisplay(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function safeDownloadFilename(value: string): string {
  const filename = path.basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return filename || "download";
}

function classifyNavigationFailure(errorCode: number, description: string): BrowserTabState["failure"] {
  const code = description || String(errorCode);
  if (errorCode <= -200 && errorCode >= -219) return { kind: "certificate", code };
  if (errorCode === -20 || errorCode === -21 || errorCode === -22) return { kind: "blocked", code };
  if (errorCode === -7 || errorCode === -118) return { kind: "timeout", code };
  if (errorCode < 0) return { kind: "network", code };
  return { kind: "unknown", code };
}

export function isAllowedBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.href === "about:blank";
  } catch {
    return value === "about:blank";
  }
}

export function normalizeBrowserInput(value: string): string {
  const input = value.trim();
  if (!input) return "about:blank";
  if (input === "about:blank") return input;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(input)) {
    return new URL(`http://${input}`).toString();
  }
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    if (isAllowedBrowserUrl(url.toString())) return url.toString();
  } catch {
    // Fall through to the search URL for omnibox text.
  }
  return `${SEARCH_URL}${encodeURIComponent(input)}`;
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|password|key|code|auth/i.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return value === "about:blank" ? value : "";
  }
}

function sanitizeBounds(bounds: BrowserSurfaceBounds["bounds"]): Rectangle {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

function isDevToolsShortcut(input: Electron.Input): boolean {
  if (input.key === "F12") return true;
  if (process.platform === "darwin") return input.meta && input.alt && !input.control && input.key.toLowerCase() === "i";
  return input.control && input.shift && !input.meta && input.key.toLowerCase() === "i";
}

function browserShortcut(input: Electron.Input): "address" | "new-tab" | "reopen-tab" | "close-tab" | "back" | "forward" | undefined {
  const mod = process.platform === "darwin" ? input.meta : input.control;
  const key = input.key.toLowerCase();
  if (mod && !input.alt && key === "l") return "address";
  if (mod && !input.alt && key === "t") return input.shift ? "reopen-tab" : "new-tab";
  if (mod && !input.alt && !input.shift && key === "w") return "close-tab";
  if (input.alt && !mod && !input.shift && key === "left") return "back";
  if (input.alt && !mod && !input.shift && key === "right") return "forward";
  return undefined;
}

function sanitizeElement(value: Record<string, unknown>): BrowserElementAttachment["element"] {
  const locator = value.locator as Record<string, unknown>;
  return {
    tag: String(value.tag).slice(0, 40),
    ...(typeof value.role === "string" ? { role: value.role.slice(0, 100) } : {}),
    ...(typeof value.accessibleName === "string" ? { accessibleName: value.accessibleName.slice(0, 200) } : {}),
    ...(typeof value.text === "string" ? { text: value.text.slice(0, 500) } : {}),
    attributes: isRecord(value.attributes)
      ? Object.fromEntries(Object.entries(value.attributes).slice(0, 24).map(([key, attribute]) => [key.slice(0, 80), String(attribute).slice(0, 256)]))
      : {},
    locator: {
      kind: isLocatorKind(locator.kind) ? locator.kind : "css",
      value: String(locator.value ?? "").slice(0, 600),
      unique: locator.unique === true,
    },
    ...(typeof value.cssFallback === "string" ? { cssFallback: value.cssFallback.slice(0, 600) } : {}),
    ancestors: Array.isArray(value.ancestors)
      ? value.ancestors.slice(0, 4).flatMap((ancestor) => {
          if (!isRecord(ancestor) || typeof ancestor.tag !== "string") return [];
          return [{
            tag: ancestor.tag.slice(0, 40),
            ...(typeof ancestor.role === "string" ? { role: ancestor.role.slice(0, 80) } : {}),
            ...(typeof ancestor.name === "string" ? { name: ancestor.name.slice(0, 120) } : {}),
          }];
        })
      : [],
  };
}

function buildElementName(element: Record<string, unknown>): string {
  const role = typeof element.role === "string" ? element.role : String(element.tag ?? "element");
  const name = typeof element.accessibleName === "string" ? element.accessibleName : typeof element.text === "string" ? element.text : "";
  return `${role}${name ? `: ${name.slice(0, 80)}` : ""}`;
}

function isLocatorKind(value: unknown): value is BrowserElementAttachment["element"]["locator"]["kind"] {
  return value === "role" || value === "test-id" || value === "label" || value === "text" || value === "id" || value === "css";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("browser operation aborted");
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("browser operation aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("browser operation aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
