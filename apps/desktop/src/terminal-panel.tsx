import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Terminal } from "@xterm/xterm";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { WorkspaceRecord } from "./desktop-state";
import { CloseIcon, MaximizeIcon, MinimizeIcon, PlusIcon, RefreshIcon } from "./icons";
import type { TerminalPanelSnapshot, TerminalSessionSnapshot, TerminalSize } from "./ipc";
import { appendTerminalReplay } from "./terminal-model";
import { shortcutMatches, type ShortcutBindings } from "./keyboard-shortcuts";
import { useTranslation } from "react-i18next";
import { recordTerminalData, recordTerminalWrite } from "./test-performance-diagnostics";

const MIN_TERMINAL_HEIGHT = 220;
const DEFAULT_TERMINAL_HEIGHT = 340;

interface TerminalPanelProps {
  readonly workspace: WorkspaceRecord;
  readonly sessionId: string;
  readonly height: number;
  readonly isTakeover: boolean;
  readonly shortcutBindings: ShortcutBindings;
  readonly onHeightChange: (height: number) => void;
  readonly onToggleTakeover: () => void;
  readonly onHide: () => void;
}

export function TerminalPanel({
  workspace,
  sessionId,
  height,
  isTakeover,
  shortcutBindings,
  onHeightChange,
  onToggleTakeover,
  onHide,
}: TerminalPanelProps) {
  const { t } = useTranslation();
  const api = window.piApp;
  const panelRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const activeTerminalIdRef = useRef("");
  const lastSizeRef = useRef<TerminalSize>({ cols: 80, rows: 24 });
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const [panel, setPanel] = useState<TerminalPanelSnapshot | null>(null);
  const [error, setError] = useState<string>("");

  const activeSession = useMemo(
    () => panel?.sessions.find((session) => session.id === panel.activeSessionId),
    [panel],
  );

  const requestPanel = useCallback(async () => {
    if (!api) {
      return;
    }
    try {
      const nextPanel = await api.ensureTerminalPanel(workspace.id, sessionId, lastSizeRef.current);
      setPanel(nextPanel);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api, sessionId, workspace.id]);

  useEffect(() => {
    setPanel(null);
    setError("");
    void requestPanel();
  }, [requestPanel]);

  const createTerminal = useCallback(async () => {
    if (!api) {
      return;
    }
    const nextPanel = await api.createTerminalSession(workspace.id, sessionId, lastSizeRef.current);
    setPanel(nextPanel);
  }, [api, sessionId, workspace.id]);

  const setActiveTerminal = useCallback(async (terminalId: string) => {
    if (!api) {
      return;
    }
    const nextPanel = await api.setActiveTerminalSession(workspace.id, sessionId, terminalId);
    setPanel(nextPanel);
  }, [api, sessionId, workspace.id]);

  const handleTerminalPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const terminalId = activeTerminalIdRef.current;
    const text = event.clipboardData.getData("text");
    if (!api || !terminalId || !text) {
      return;
    }
    event.preventDefault();
    void api.writeTerminal(terminalId, text);
  }, [api]);

  const closeTerminal = useCallback(async (terminalId: string) => {
    if (!api) {
      return;
    }
    const nextPanel = await api.closeTerminalSession(terminalId);
    if (nextPanel) {
      setPanel(nextPanel);
    } else {
      setPanel(null);
      onHide();
    }
  }, [api, onHide]);

  const restartTerminal = useCallback(async () => {
    if (!api || !activeSession) {
      return;
    }
    const nextPanel = await api.restartTerminalSession(activeSession.id, lastSizeRef.current);
    terminalRef.current?.reset();
    setPanel(nextPanel);
  }, [activeSession, api]);

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const terminalId = activeTerminalIdRef.current;
    if (!api || !terminalId || !terminal || !fitAddon || !containerRef.current) {
      return;
    }
    fitAddon.fit();
    const nextSize = { cols: terminal.cols, rows: terminal.rows };
    if (nextSize.cols === lastSizeRef.current.cols && nextSize.rows === lastSizeRef.current.rows) {
      return;
    }
    lastSizeRef.current = nextSize;
    void api.resizeTerminal(terminalId, nextSize);
  }, [api]);

  useEffect(() => {
    const panelElement = panelRef.current;
    if (!api || !panelElement) {
      return undefined;
    }
    const markFocused = () => {
      void api.setTerminalFocused(true, activeTerminalIdRef.current);
    };
    const markBlurred = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && panelElement.contains(event.relatedTarget)) {
        return;
      }
      void api.setTerminalFocused(false);
    };
    const handleShortcut = (event: KeyboardEvent) => {
      if (!shortcutMatches(event, shortcutBindings.toggleTerminal, api.platform)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onHide();
    };
    const handleWindowsPaste = (event: KeyboardEvent) => {
      if (api.platform !== "win32" || !event.ctrlKey || event.shiftKey || event.key.toLowerCase() !== "v") {
        return;
      }
      const terminalId = activeTerminalIdRef.current;
      const text = terminalId ? api.readClipboardText() : "";
      if (!terminalId || !text) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void api.writeTerminal(terminalId, text);
    };
    panelElement.addEventListener("focusin", markFocused);
    panelElement.addEventListener("focusout", markBlurred);
    panelElement.addEventListener("keydown", handleShortcut, true);
    panelElement.addEventListener("keydown", handleWindowsPaste, true);
    return () => {
      panelElement.removeEventListener("focusin", markFocused);
      panelElement.removeEventListener("focusout", markBlurred);
      panelElement.removeEventListener("keydown", handleShortcut, true);
      panelElement.removeEventListener("keydown", handleWindowsPaste, true);
      void api.setTerminalFocused(false);
    };
  }, [api, onHide, shortcutBindings.toggleTerminal]);

  useEffect(() => {
    if (!api) {
      return undefined;
    }
    const removeData = api.onTerminalData((event) => {
      const receivedAt = window.__piAppTestMode ? performance.now() : 0;
      if (window.__piAppTestMode) {
        recordTerminalData(event.data.length);
      }
      setPanel((currentPanel) => updateSession(currentPanel, event.terminalId, (session) => ({
        ...session,
        ...appendTerminalReplay(session.replay, event.data, session.truncated),
      })));
      if (event.terminalId === activeTerminalIdRef.current) {
        const terminal = terminalRef.current;
        if (terminal) {
          const writeStartedAt = window.__piAppTestMode ? performance.now() : 0;
          terminal.write(event.data);
          if (window.__piAppTestMode) {
            recordTerminalWrite(event.data.length, receivedAt, writeStartedAt, performance.now());
          }
        }
      }
    });
    const removeExit = api.onTerminalExit((event) => {
      setPanel((currentPanel) => updateSession(currentPanel, event.terminalId, (session) => ({
        ...session,
        status: "exited",
        exitCode: event.exitCode,
        signal: event.signal,
      })));
    });
    const removeError = api.onTerminalError((event) => {
      setPanel((currentPanel) => updateSession(currentPanel, event.terminalId, (session) => ({
        ...session,
        status: "error",
        ...appendTerminalReplay(session.replay, `${event.message}\r\n`, session.truncated),
      })));
    });
    return () => {
      removeData();
      removeExit();
      removeError();
    };
  }, [api]);

  useEffect(() => {
    const container = containerRef.current;
    if (!api || !container || !activeSession) {
      return undefined;
    }

    activeTerminalIdRef.current = activeSession.id;
    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: true,
      cursorBlink: true,
      fontFamily: "Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontSize: 12,
      scrollback: 2_000,
      theme: {
        background: "#0f1117",
        foreground: "#d7dae0",
        cursor: "#f2f4f8",
        selectionBackground: "#39557a",
      },
    });
    const fitAddon = new FitAddon();
    const clipboardAddon = new ClipboardAddon();
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      void api.openExternal(uri);
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(clipboardAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }
      if (shortcutMatches(event, shortcutBindings.newTerminalTab, api.platform)) {
        void createTerminal();
        return false;
      }
      if (api.platform === "darwin" && event.metaKey) {
        const sequence = macTerminalSequenceForEvent(event);
        if (sequence) {
          void api.writeTerminal(activeSession.id, sequence);
          return false;
        }
      }
      return true;
    });
    terminal.onData((data) => {
      void api.writeTerminal(activeSession.id, data);
    });
    terminal.onTitleChange((title) => {
      void api.setTerminalTitle(activeSession.id, title);
      setPanel((currentPanel) => updateSession(currentPanel, activeSession.id, (session) => ({
        ...session,
        title: title.trim() || session.title,
      })));
    });
    terminal.open(container);
    if (activeSession.replay) {
      terminal.write(activeSession.replay);
    }
    terminal.focus();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    window.requestAnimationFrame(fitAndResize);

    const resizeObserver = new ResizeObserver(() => fitAndResize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      fitAddonRef.current = null;
      terminalRef.current = null;
      activeTerminalIdRef.current = "";
      terminal.dispose();
    };
  }, [activeSession?.id, api, createTerminal, fitAndResize, shortcutBindings.newTerminalTab]);

  const startResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeCleanupRef.current?.();
    const startY = event.clientY;
    const startHeight = containerRef.current?.closest<HTMLElement>(".terminal-panel")?.offsetHeight ?? height;
    const maxHeight = Math.max(MIN_TERMINAL_HEIGHT, window.innerHeight - 140);

    const handleMove = (moveEvent: MouseEvent) => {
      const nextHeight = Math.min(maxHeight, Math.max(MIN_TERMINAL_HEIGHT, startHeight + startY - moveEvent.clientY));
      onHeightChange(nextHeight);
    };
    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      resizeCleanupRef.current = null;
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    resizeCleanupRef.current = handleUp;
  };

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  return (
    <section
      ref={panelRef}
      className={`terminal-panel${isTakeover ? " terminal-panel--takeover" : ""}`}
      data-pi-terminal="true"
      data-testid="integrated-terminal"
      onPasteCapture={handleTerminalPaste}
      style={isTakeover ? undefined : { height: `${height || DEFAULT_TERMINAL_HEIGHT}px` }}
    >
      <div className="terminal-panel__resize-handle" onMouseDown={startResize} />
      <div className="terminal-panel__toolbar">
        <div className="terminal-panel__tabs" role="tablist" aria-label={t("terminal.sessions")}>
          {(panel?.sessions ?? []).map((session) => (
            <div
              key={session.id}
              className={`terminal-panel__tab-item${session.id === panel?.activeSessionId ? " terminal-panel__tab-item--active" : ""}`}
            >
              <button
                className="terminal-panel__tab"
                type="button"
                role="tab"
                aria-selected={session.id === panel?.activeSessionId}
                data-testid="terminal-tab"
                onClick={() => void setActiveTerminal(session.id)}
              >
                <span className={`terminal-panel__status terminal-panel__status--${session.status}`} />
                <span className="terminal-panel__tab-title">{session.title}</span>
              </button>
              <button
                type="button"
                className="terminal-panel__tab-close"
                aria-label={t("terminal.closeSession", { name: session.title })}
                onClick={(event) => {
                  event.stopPropagation();
                  void closeTerminal(session.id);
                }}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
        <div className="terminal-panel__actions">
          <button type="button" className="icon-button terminal-panel__action" title={t("terminal.new")} aria-label={t("terminal.new")} onClick={() => void createTerminal()}>
            <PlusIcon />
          </button>
          <button type="button" className="icon-button terminal-panel__action" title={t("terminal.restart")} aria-label={t("terminal.restart")} onClick={() => void restartTerminal()}>
            <RefreshIcon />
          </button>
          <button
            type="button"
            className="icon-button terminal-panel__action"
            title={isTakeover ? t("terminal.restore") : t("terminal.maximize")}
            aria-label={isTakeover ? t("terminal.restore") : t("terminal.maximize")}
            onClick={onToggleTakeover}
          >
            {isTakeover ? <MinimizeIcon /> : <MaximizeIcon />}
          </button>
          <button type="button" className="icon-button terminal-panel__action" title={t("terminal.hide")} aria-label={t("terminal.hide")} onClick={onHide}>
            <CloseIcon />
          </button>
        </div>
      </div>
      {error ? (
        <div className="terminal-panel__error">{error}</div>
      ) : (
        <div className="terminal-panel__viewport" ref={containerRef} />
      )}
    </section>
  );
}

function updateSession(
  panel: TerminalPanelSnapshot | null,
  terminalId: string,
  update: (session: TerminalSessionSnapshot) => TerminalSessionSnapshot,
): TerminalPanelSnapshot | null {
  if (!panel) {
    return panel;
  }
  return {
    ...panel,
    sessions: panel.sessions.map((session) => session.id === terminalId ? update(session) : session),
  };
}

function macTerminalSequenceForEvent(event: KeyboardEvent): string | undefined {
  switch (event.key) {
    case "ArrowLeft":
    case "ArrowUp":
      return "\x01";
    case "ArrowRight":
    case "ArrowDown":
      return "\x05";
    case "Backspace":
      return "\x15";
    case "Delete":
      return "\x0b";
    default:
      return undefined;
  }
}
