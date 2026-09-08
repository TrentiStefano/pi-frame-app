import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { AppView, SessionRecord, WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import { BrowserPreviewIcon, ChevronDownIcon, DiffIcon, FileIcon, FolderIcon, TerminalIcon, WorktreeIcon } from "./icons";
import { Check, Ellipsis, ListChecks } from "lucide-react";
import { getDesktopShortcutLabel, type PiDesktopApi } from "./ipc";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import { useTranslation } from "react-i18next";
import { formatShortcut, type ShortcutBindings } from "./keyboard-shortcuts";

interface TopbarProps {
  readonly sidebarToggle: ReactNode;
  readonly activeView: AppView;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionTitle: string | undefined;
  readonly selectedWorktree: WorktreeRecord | undefined;
  readonly activeWorktrees: readonly WorktreeRecord[];
  readonly workspaces: readonly WorkspaceRecord[];
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly shortcutBindings: ShortcutBindings;
  readonly terminalAvailable: boolean;
  readonly terminalVisible: boolean;
  readonly onToggleTerminal: () => void;
  readonly panelAvailable: boolean;
  readonly changesVisible: boolean;
  readonly onToggleChanges: () => void;
  readonly filesVisible: boolean;
  readonly onToggleFiles: () => void;
  readonly planAvailable: boolean;
  readonly planVisible: boolean;
  readonly onTogglePlan: () => void;
  readonly browserVisible: boolean;
  readonly onToggleBrowser: () => void;
}

export function Topbar(props: TopbarProps) {
  const { t } = useTranslation();
  const {
    sidebarToggle,
    activeView,
    rootWorkspace,
    selectedWorkspace,
    selectedSession,
    selectedSessionTitle,
    selectedWorktree,
    activeWorktrees,
    workspaces,
    wsMenu,
    api,
    shortcutBindings,
    terminalAvailable,
    terminalVisible,
    onToggleTerminal,
    panelAvailable,
    changesVisible,
    onToggleChanges,
    filesVisible,
    onToggleFiles,
    planAvailable,
    planVisible,
    onTogglePlan,
    browserVisible,
    onToggleBrowser,
  } = props;
  const terminalShortcut = formatShortcut(shortcutBindings.toggleTerminal, api.platform);
  const browserShortcut = formatShortcut(shortcutBindings.toggleBrowser, api.platform);
  const diffShortcut = getDesktopShortcutLabel(api.platform, "D");

  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest(".topbar__actions")) {
      return;
    }

    void api.toggleWindowMaximize();
  };

  return (
    <header className="topbar" data-testid="topbar" onDoubleClick={handleDoubleClick}>
      <div className="topbar__title">
        <span className="topbar__workspace">
          {rootWorkspace ? rootWorkspace.name : t("settings.openFolderToBegin")}
        </span>
        {selectedWorkspace && activeView === "threads" ? (
          <>
            <span className="topbar__separator">/</span>
            <div className="environment-picker" ref={wsMenu.environmentMenuRef}>
              <button
                aria-expanded={wsMenu.environmentMenuOpen}
                aria-haspopup="menu"
                className="environment-picker__button composer-select__trigger"
                type="button"
                onClick={() => wsMenu.setEnvironmentMenuOpen((current) => !current)}
              >
                <span className="composer-select__icon" aria-hidden="true">
                  {selectedWorkspace.kind === "worktree" ? <WorktreeIcon /> : <FolderIcon />}
                </span>
                <span className="composer-select__label">
                  {selectedWorkspace.kind === "worktree" ? selectedWorktree?.name ?? selectedWorkspace.name : t("common.local")}
                </span>
                <span className="composer-select__chevron" aria-hidden="true"><ChevronDownIcon /></span>
              </button>
              {wsMenu.environmentMenuOpen && rootWorkspace ? (
                <div className="workspace-menu environment-picker__menu" role="menu">
                  <button
                    aria-checked={selectedWorkspace.id === rootWorkspace.id}
                    className="workspace-menu__item environment-picker__item"
                    role="menuitemradio"
                    type="button"
                    onClick={() => wsMenu.selectWorkspace(rootWorkspace.id)}
                  >
                    <span className="composer-select__option-icon" aria-hidden="true"><FolderIcon /></span>
                    <span>{t("common.local")}</span>
                    <span className="composer-select__check" aria-hidden="true">
                      {selectedWorkspace.id === rootWorkspace.id ? <Check /> : null}
                    </span>
                  </button>
                  {activeWorktrees.map((worktree) => {
                    const linkedWorkspace = workspaces.find(
                      (workspace) => workspace.id === worktree.linkedWorkspaceId,
                    );
                    const worktreeSelectable = Boolean(linkedWorkspace) && worktree.status === "ready";
                    return (
                      <button
                        aria-checked={linkedWorkspace?.id === selectedWorkspace.id}
                        className="workspace-menu__item environment-picker__item"
                        key={worktree.id}
                        role="menuitemradio"
                        type="button"
                        disabled={!worktreeSelectable}
                        onClick={() => {
                          if (worktreeSelectable && linkedWorkspace) {
                            wsMenu.selectWorkspace(linkedWorkspace.id);
                          }
                        }}
                      >
                        <span className="composer-select__option-icon" aria-hidden="true"><WorktreeIcon /></span>
                        <span>
                          {worktree.name}
                          {!worktreeSelectable ? ` (${worktree.status !== "ready" ? worktree.status : "unavailable"})` : ""}
                        </span>
                        <span className="composer-select__check" aria-hidden="true">
                          {linkedWorkspace?.id === selectedWorkspace.id ? <Check /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {selectedWorkspace && activeView === "threads" && selectedSession ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">{selectedSessionTitle ?? selectedSession.title}</span>
          </>
        ) : activeView === "new-thread" && rootWorkspace ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">{t("common.newThread")}</span>
          </>
        ) : null}
      </div>

      <div className="topbar__actions">
        <WorkspaceToolsMenu
          terminalAvailable={terminalAvailable}
          terminalVisible={terminalVisible}
          onToggleTerminal={onToggleTerminal}
          panelAvailable={panelAvailable}
          changesVisible={changesVisible}
          onToggleChanges={onToggleChanges}
          filesVisible={filesVisible}
          onToggleFiles={onToggleFiles}
          planAvailable={planAvailable}
          planVisible={planVisible}
          onTogglePlan={onTogglePlan}
          browserVisible={browserVisible}
          onToggleBrowser={onToggleBrowser}
          terminalShortcut={terminalShortcut}
          diffShortcut={diffShortcut}
          browserShortcut={browserShortcut}
        />
        {sidebarToggle}
      </div>
    </header>
  );
}

function WorkspaceToolsMenu({
  terminalAvailable,
  terminalVisible,
  onToggleTerminal,
  panelAvailable,
  changesVisible,
  onToggleChanges,
  filesVisible,
  onToggleFiles,
  planAvailable,
  planVisible,
  onTogglePlan,
  browserVisible,
  onToggleBrowser,
  terminalShortcut,
  diffShortcut,
  browserShortcut,
}: {
  readonly terminalAvailable: boolean;
  readonly terminalVisible: boolean;
  readonly onToggleTerminal: () => void;
  readonly panelAvailable: boolean;
  readonly changesVisible: boolean;
  readonly onToggleChanges: () => void;
  readonly filesVisible: boolean;
  readonly onToggleFiles: () => void;
  readonly planAvailable: boolean;
  readonly planVisible: boolean;
  readonly onTogglePlan: () => void;
  readonly browserVisible: boolean;
  readonly onToggleBrowser: () => void;
  readonly terminalShortcut: string;
  readonly diffShortcut: string;
  readonly browserShortcut: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="workspace-tools" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("shell.workspaceTools")}
        className={`icon-button topbar__icon workspace-tools__button${open ? " icon-button--active" : ""}`}
        data-testid="workspace-tools"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <Ellipsis aria-hidden="true" />
      </button>
      {open ? (
        <div className="workspace-tools__menu" role="menu">
          <WorkspaceToolItem
            icon={<TerminalIcon />}
            label={t("settings.toggleTerminal")}
            shortcut={terminalShortcut}
            active={terminalVisible}
            disabled={!terminalAvailable}
            onClick={() => { onToggleTerminal(); setOpen(false); }}
          />
          <WorkspaceToolItem
            icon={<DiffIcon />}
            label={t("shell.toggleChanges")}
            shortcut={diffShortcut}
            active={changesVisible}
            disabled={!panelAvailable}
            onClick={() => { onToggleChanges(); setOpen(false); }}
          />
          <WorkspaceToolItem
            icon={<FileIcon />}
            label={t("shell.toggleFiles")}
            active={filesVisible}
            disabled={!panelAvailable}
            onClick={() => { onToggleFiles(); setOpen(false); }}
          />
          <WorkspaceToolItem
            icon={<ListChecks />}
            label={t("shell.togglePlan")}
            active={planVisible}
            disabled={!planAvailable}
            onClick={() => { onTogglePlan(); setOpen(false); }}
          />
          <WorkspaceToolItem
            icon={<BrowserPreviewIcon />}
            label={t("shell.browser")}
            shortcut={browserShortcut}
            active={browserVisible}
            disabled={!panelAvailable}
            onClick={() => { onToggleBrowser(); setOpen(false); }}
          />
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceToolItem({ icon, label, shortcut, active, disabled, onClick }: TopbarActionButtonProps) {
  return (
    <button
      className={`workspace-tools__item${active ? " workspace-tools__item--active" : ""}`}
      disabled={disabled}
      role="menuitem"
      type="button"
      onClick={onClick}
    >
      <span className="workspace-tools__item-icon">{icon}</span>
      <span>{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </button>
  );
}

interface TopbarActionButtonProps {
  readonly label: string;
  readonly icon: ReactNode;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly shortcut?: string;
  readonly onClick: () => void;
}
