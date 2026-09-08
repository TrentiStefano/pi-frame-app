import { forwardRef, useEffect, useState, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Blocks, Ellipsis, Search, X } from "lucide-react";
import type { AppView, SessionRecord, WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import { ChevronDownIcon, FolderIcon, PinIcon, PlusIcon, SettingsIcon, WorktreeIcon } from "./icons";
import type { PiDesktopApi } from "./ipc";
import { formatRelativeTime } from "./string-utils";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import { useThreadMenu, type ThreadMenuState } from "./hooks/use-thread-menu";
import { comparePinnedThreads, sessionThreadKey, type ThreadGroup, type ThreadListEntry } from "./thread-groups";
import type { Dispatch, SetStateAction } from "react";
import type { DesktopAppState } from "./desktop-state";
import { useTranslation } from "react-i18next";

interface SidebarProps {
  readonly collapsed: boolean;
  readonly activeView: AppView;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly visibleWorkspaces: readonly WorkspaceRecord[];
  readonly threadGroups: readonly ThreadGroup[];
  readonly pinnedSessionOrder: readonly string[];
  readonly linkedWorktreeByWorkspaceId: ReadonlyMap<string, WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: (
    api: PiDesktopApi,
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
  readonly onNewThread: () => void;
  readonly onSetActiveView: (view: AppView) => void;
  readonly onOpenSettings: (workspaceId?: string) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (target: { workspaceId: string; sessionId: string }, pinned: boolean) => void;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
const RENAME_THREAD_SHORTCUT_HINT = IS_MAC ? "⇧⌘R" : "Ctrl+Shift+R";

export function Sidebar(props: SidebarProps) {
  const { t } = useTranslation();
  const {
    collapsed,
    activeView,
    selectedWorkspace,
    selectedSession,
    visibleWorkspaces,
    threadGroups,
    pinnedSessionOrder,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    api,
    setSnapshot,
    updateSnapshot,
    onNewThread,
    onSetActiveView,
    onOpenSettings,
    onSelectSession,
    onSetSessionPinned,
  } = props;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const threadMenu = useThreadMenu({ api, setSnapshot, updateSnapshot });

  // Cmd+Shift+R renames the currently selected thread (same flow as the
  // "Rename thread" context-menu item).
  useEffect(() => {
    const handleRenameShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if ((event.key.toLowerCase() !== "r" && event.code !== "KeyR")) return;
      if (activeView !== "threads" || !selectedWorkspace || !selectedSession) return;
      const entry = threadGroups
        .flatMap((group) => [...group.pinnedThreads, ...group.threads])
        .find((t) => t.workspaceId === selectedWorkspace.id && t.session.id === selectedSession.id);
      if (!entry) return;
      event.preventDefault();
      threadMenu.startRename(entry);
    };
    window.addEventListener("keydown", handleRenameShortcut);
    return () => window.removeEventListener("keydown", handleRenameShortcut);
  }, [activeView, selectedWorkspace, selectedSession, threadGroups, threadMenu]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const pinnedSortableId = (thread: ThreadListEntry) => `pinned:${sessionThreadKey(thread)}`;
  const pinnedSessionKeyFromSortableId = (id: string) => id.startsWith("pinned:") ? id.slice("pinned:".length) : id;

  // Collision detection based on workspace row headers only (~30px top of each group),
  // not the full group height including all sessions.
  const headerCollision: CollisionDetection = (args) => {
    if (String(args.active.id).startsWith("pinned:")) {
      const pointerY = args.pointerCoordinates?.y;
      if (pointerY == null) return [];
      let closest: { id: string; distance: number } | null = null;
      for (const container of args.droppableContainers) {
        const containerId = String(container.id);
        if (!containerId.startsWith("pinned:") || containerId === String(args.active.id)) {
          continue;
        }
        const rect = container.rect.current;
        if (!rect) continue;
        const rowCenter = rect.top + rect.height / 2;
        const distance = Math.abs(pointerY - rowCenter);
        if (!closest || distance < closest.distance) {
          closest = { id: containerId, distance };
        }
      }
      return closest ? [{ id: closest.id, data: { droppableContainer: args.droppableContainers.find((c) => String(c.id) === closest!.id)! } }] : [];
    }
    const pointerY = args.pointerCoordinates?.y;
    if (pointerY == null) return [];

    let closest: { id: string; distance: number } | null = null;
    for (const container of args.droppableContainers) {
      if (String(container.id).startsWith("pinned:")) {
        continue;
      }
      const rect = container.rect.current;
      if (!rect) continue;
      const headerCenter = rect.top + 15; // center of the ~30px workspace row header
      const distance = Math.abs(pointerY - headerCenter);
      if (!closest || distance < closest.distance) {
        closest = { id: String(container.id), distance };
      }
    }
    return closest ? [{ id: closest.id, data: { droppableContainer: args.droppableContainers.find((c) => String(c.id) === closest!.id)! } }] : [];
  };

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleThreadGroups = normalizedQuery
    ? threadGroups.map((group) => ({
        ...group,
        threads: group.threads.filter((thread) => `${thread.session.title} ${thread.session.preview}`.toLocaleLowerCase().includes(normalizedQuery)),
        pinnedThreads: group.pinnedThreads.filter((thread) => `${thread.session.title} ${thread.session.preview}`.toLocaleLowerCase().includes(normalizedQuery)),
      })).filter((group) => group.threads.length > 0 || group.pinnedThreads.length > 0)
    : threadGroups;
  const rootGroups = visibleThreadGroups.filter((g) => g.rootWorkspace.kind === "primary");
  const orphanGroups = visibleThreadGroups.filter((g) => g.rootWorkspace.kind !== "primary");
  const pinnedThreads = visibleThreadGroups
    .flatMap((group) => group.pinnedThreads)
    .sort((left, right) => comparePinnedThreads(left, right, pinnedSessionOrder));
  const pinnedSortableIds = pinnedThreads.map(pinnedSortableId);
  const rootGroupIds = rootGroups.map((g) => g.rootWorkspace.id);
  const canDrag = rootGroups.length > 1;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    if (String(active.id).startsWith("pinned:")) {
      const oldIndex = pinnedSortableIds.indexOf(String(active.id));
      const newIndex = pinnedSortableIds.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const newOrder = arrayMove(pinnedSortableIds, oldIndex, newIndex).map(pinnedSessionKeyFromSortableId);
      applyOptimisticReorder(
        (prev) => ({ ...prev, pinnedSessionOrder: newOrder }),
        () => api.reorderPinnedSessions(newOrder),
      );
      return;
    }

    const oldIndex = rootGroupIds.indexOf(String(active.id));
    const newIndex = rootGroupIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const newOrder = arrayMove(rootGroupIds, oldIndex, newIndex);
    applyOptimisticReorder(
      (prev) => ({ ...prev, workspaceOrder: newOrder }),
      () => api.reorderWorkspaces(newOrder),
    );
  }

  // Optimistically update local state to avoid snap-back animation, then reconcile with the
  // authoritative state the IPC call returns; roll back to the pre-reorder snapshot on rejection.
  function applyOptimisticReorder(
    optimistic: (prev: DesktopAppState) => DesktopAppState,
    commit: () => Promise<DesktopAppState>,
  ) {
    let previousSnapshot: DesktopAppState | null = null;
    setSnapshot((prev) => {
      previousSnapshot = prev;
      return prev ? optimistic(prev) : prev;
    });
    void commit().then(
      (state) => setSnapshot(state),
      () => setSnapshot(previousSnapshot),
    );
  }

  const activeGroup = activeId ? rootGroups.find((g) => g.rootWorkspace.id === activeId) : undefined;
  const activePinnedThread = activeId?.startsWith("pinned:")
    ? pinnedThreads.find((thread) => pinnedSortableId(thread) === activeId)
    : undefined;

  return (
    <aside
      aria-hidden={collapsed}
      className="sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      inert={collapsed}
    >
      <div className="sidebar__top">
        <button
          className="sidebar__new"
          type="button"
          disabled={!selectedWorkspace}
          onClick={onNewThread}
        >
          <PlusIcon />
          <span>{t("common.newThread")}</span>
        </button>

        <div className="sidebar__nav">
          <button
            className={`sidebar__nav-item ${searchOpen ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => setSearchOpen((value) => !value)}
          >
            <Search aria-hidden="true" />
            <span>{t("sidebar.searchConversations")}</span>
          </button>
          <button
            className={`sidebar__nav-item ${activeView === "skills" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => onSetActiveView("skills")}
          >
            <Blocks aria-hidden="true" />
            <span>{t("sidebar.capabilities")}</span>
          </button>
        </div>
        {searchOpen ? <label className="sidebar__search">
          <Search aria-hidden="true" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); setSearchOpen(false); } }} placeholder={t("sidebar.searchPlaceholder")} />
          {query ? <button type="button" aria-label={t("sidebar.clearSearch")} onClick={() => setQuery("")}><X /></button> : null}
        </label> : null}
      </div>

      <div className="sidebar__section">
        <div className="section__head">
          <span>{t("common.threads")}</span>
          <div className="section__tools">
            <button
              aria-label={t("shell.openFolder")}
              className="icon-button"
              type="button"
              onClick={() => {
                void updateSnapshot(api, setSnapshot, () => api.pickWorkspace());
              }}
            >
              <FolderIcon />
            </button>
          </div>
        </div>

        {visibleWorkspaces.length === 0 ? (
          <div className="empty-state" data-testid="empty-state">
            <h2>{t("sidebar.noFolders")}</h2>
            <p>{t("sidebar.noFoldersDescription")}</p>
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                void updateSnapshot(api, setSnapshot, () => api.pickWorkspace());
              }}
            >
              {t("sidebar.openFirstFolder")}
            </button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={headerCollision} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="workspace-list" data-testid="workspace-list">
              {pinnedThreads.length > 0 ? (
                <PinnedThreadsSection
                  pinnedThreads={pinnedThreads}
                  sortableIds={pinnedSortableIds}
                  sortableIdForThread={pinnedSortableId}
                  selectedWorkspace={selectedWorkspace}
                  selectedSession={selectedSession}
                  threadMenu={threadMenu}
                  onSelectSession={onSelectSession}
                  onSetSessionPinned={onSetSessionPinned}
                />
              ) : null}
              <SortableContext items={rootGroupIds} strategy={verticalListSortingStrategy}>
                {rootGroups.map((group) => (
                  <SortableWorkspaceGroup
                    key={group.rootWorkspace.id}
                    group={group}
                    canDrag={canDrag}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    threadMenu={threadMenu}
                    onSelectSession={onSelectSession}
                    onSetSessionPinned={onSetSessionPinned}
                  />
                ))}
              </SortableContext>
              {orphanGroups.map((group) => (
                <WorkspaceGroupContent
                  key={group.rootWorkspace.id}
                  group={group}
                  canDrag={false}
                  selectedWorkspace={selectedWorkspace}
                  selectedSession={selectedSession}
                  linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                  wsMenu={wsMenu}
                  api={api}
                  threadMenu={threadMenu}
                  onSelectSession={onSelectSession}
                  onSetSessionPinned={onSetSessionPinned}
                />
              ))}
            </div>
            <DragOverlay>
              {activePinnedThread ? (
                <ThreadSessionRow
                  active={activePinnedThread.workspaceId === selectedWorkspace?.id && activePinnedThread.session.id === selectedSession?.id}
                  thread={activePinnedThread}
                  showContext
                  overlay
                  onSelect={() => undefined}
                  onTogglePinned={() => undefined}
                />
              ) : activeGroup ? (
                <div className="workspace-group workspace-group--overlay">
                  <WorkspaceGroupContent
                    group={activeGroup}
                    canDrag={false}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    threadMenu={threadMenu}
                    onSelectSession={onSelectSession}
                    onSetSessionPinned={onSetSessionPinned}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
      <div className="sidebar__footer">
        <button
          className={`sidebar__nav-item ${activeView === "settings" ? "sidebar__nav-item--active" : ""}`}
          type="button"
          onClick={() => onOpenSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
        >
          <SettingsIcon />
          <span>{t("common.settings")}</span>
        </button>
      </div>
    </aside>
  );
}

/* ── Sortable workspace group wrapper ──────────────────── */

interface WorkspaceGroupProps {
  readonly group: ThreadGroup;
  readonly canDrag: boolean;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly linkedWorktreeByWorkspaceId: ReadonlyMap<string, WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly threadMenu: ThreadMenuState;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (target: { workspaceId: string; sessionId: string }, pinned: boolean) => void;
}

function SortableWorkspaceGroup(props: WorkspaceGroupProps) {
  const { group, wsMenu } = props;
  const isRenaming = wsMenu.workspaceRenameId === group.rootWorkspace.id;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.rootWorkspace.id,
    disabled: isRenaming,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : undefined,
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={`workspace-group ${isDragging ? "workspace-group--dragging" : ""}`}
    >
      <WorkspaceGroupContent
        {...props}
        dragHandleProps={props.canDrag && !isRenaming ? { attributes, listeners } : undefined}
      />
    </section>
  );
}

/* ── Workspace group content (used both inline and in overlay) ──── */

interface DragHandleProps {
  readonly attributes: DraggableAttributes;
  readonly listeners: DraggableSyntheticListeners;
}

function WorkspaceGroupContent(
  props: WorkspaceGroupProps & { readonly dragHandleProps?: DragHandleProps },
) {
  const { t } = useTranslation();
  const {
    group: { rootWorkspace, threads },
    selectedWorkspace,
    selectedSession,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    api,
    threadMenu,
    onSelectSession,
    onSetSessionPinned,
    dragHandleProps,
  } = props;

  const workspaceActive =
    rootWorkspace.id === selectedWorkspace?.id ||
    rootWorkspace.id === selectedWorkspace?.rootWorkspaceId;
  const linkedWorktree = linkedWorktreeByWorkspaceId.get(rootWorkspace.id);
  const isCollapsed = wsMenu.collapsedWorkspaces[rootWorkspace.id] ?? false;

  return (
    <>
      <div className={`workspace-row ${workspaceActive ? "workspace-row--active" : ""}`}>
        <button
          className={`workspace-row__select ${dragHandleProps ? "workspace-row__select--draggable" : ""}`}
          onClick={() => {
            if (threads.length === 0) {
              wsMenu.selectWorkspace(rootWorkspace.id);
            }
            wsMenu.toggleWorkspaceCollapsed(rootWorkspace.id);
          }}
          type="button"
          {...(dragHandleProps ? { ...dragHandleProps.attributes, ...dragHandleProps.listeners } : {})}
        >
          <span className="workspace-row__icon" aria-hidden="true" data-collapsed={isCollapsed || undefined}>
            <span className="workspace-row__icon-folder"><FolderIcon /></span>
            <span className="workspace-row__icon-chevron"><ChevronDownIcon /></span>
          </span>
          <span className="workspace-row__name">{rootWorkspace.name}</span>
        </button>
        <span
          className="workspace-row__menu-wrap"
          ref={wsMenu.workspaceMenuId === rootWorkspace.id ? wsMenu.workspaceMenuWrapRef : undefined}
        >
          <button
            aria-label={t("sidebar.workspaceActions", { name: rootWorkspace.name })}
            aria-haspopup="menu"
            className="icon-button workspace-row__menu-button"
            aria-expanded={wsMenu.workspaceMenuId === rootWorkspace.id}
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              wsMenu.openWorkspaceMenu(rootWorkspace.id);
            }}
          >
            …
          </button>
          {wsMenu.workspaceMenuId === rootWorkspace.id ? (
            <div className="workspace-menu">
              <button
                className="workspace-menu__item"
                type="button"
                onClick={(event) =>
                  wsMenu.runWorkspaceMenuAction(event, () => {
                    void api.openWorkspaceInFinder(rootWorkspace.id);
                  })
                }
              >
                {t("sidebar.openFolder")}
              </button>
              {linkedWorktree ? (
                <button
                  className="workspace-menu__item workspace-menu__item--danger"
                  type="button"
                  onClick={(event) =>
                    wsMenu.runWorkspaceMenuAction(event, () =>
                      wsMenu.removeWorktree(linkedWorktree.rootWorkspaceId || rootWorkspace.id, linkedWorktree),
                    )
                  }
                >
                  {t("sidebar.removeWorktree")}
                </button>
              ) : (
                <button
                  className="workspace-menu__item"
                  type="button"
                  onClick={(event) =>
                    wsMenu.runWorkspaceMenuAction(event, () => wsMenu.createWorktree(rootWorkspace.id))
                  }
                >
                  {t("sidebar.createPermanentWorktree")}
                </button>
              )}
              <button
                className="workspace-menu__item"
                type="button"
                onClick={(event) => wsMenu.runWorkspaceMenuAction(event, () => wsMenu.startRename(rootWorkspace))}
              >
                {t("sidebar.editName")}
              </button>
              <button
                className="workspace-menu__item workspace-menu__item--danger"
                type="button"
                onClick={(event) => wsMenu.runWorkspaceMenuAction(event, () => wsMenu.removeWorkspace(rootWorkspace))}
              >
                {t("sidebar.removeWorkspace")}
              </button>
            </div>
          ) : null}
        </span>
      </div>
      {wsMenu.workspaceRenameId === rootWorkspace.id ? (
        <form
          className="workspace-rename"
          ref={wsMenu.workspaceRenamePanelRef}
          onSubmit={(event) => {
            event.preventDefault();
            wsMenu.submitRename(rootWorkspace);
          }}
        >
          <input
            aria-label={t("sidebar.renameWorkspace", { name: rootWorkspace.name })}
            className="workspace-rename__input"
            ref={wsMenu.workspaceRenameInputRef}
            value={wsMenu.workspaceRenameDraft}
            onChange={(event) => {
              wsMenu.setWorkspaceRenameDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                wsMenu.cancelRename();
              }
            }}
          />
          <div className="workspace-rename__actions">
            <button className="workspace-rename__button" type="button" onClick={wsMenu.cancelRename}>
              {t("common.cancel")}
            </button>
            <button className="workspace-rename__button workspace-rename__button--primary" type="submit">
              {t("common.save")}
            </button>
          </div>
        </form>
      ) : null}
      {!isCollapsed ? (
        <>
          <div className="session-list">
            {threads.map((thread) => {
              const active = thread.workspaceId === selectedWorkspace?.id && thread.session.id === selectedSession?.id;
              return (
                <ThreadSessionRow
                  key={`${thread.workspaceId}:${thread.session.id}`}
                  active={active}
                  thread={thread}
                  threadMenu={threadMenu}
                  onSelect={() => onSelectSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })}
                  onTogglePinned={() =>
                    onSetSessionPinned(
                      { workspaceId: thread.workspaceId, sessionId: thread.session.id },
                      !thread.session.pinnedAt,
                    )
                  }
                />
              );
            })}
          </div>
        </>
      ) : null}
    </>
  );
}

function PinnedThreadsSection({
  pinnedThreads,
  sortableIds,
  sortableIdForThread,
  selectedWorkspace,
  selectedSession,
  threadMenu,
  onSelectSession,
  onSetSessionPinned,
}: {
  readonly pinnedThreads: readonly ThreadListEntry[];
  readonly sortableIds: readonly string[];
  readonly sortableIdForThread: (thread: ThreadListEntry) => string;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly threadMenu: ThreadMenuState;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (target: { workspaceId: string; sessionId: string }, pinned: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="pinned-thread-group" aria-label={t("sidebar.pinnedThreads")}>
      <div className="pinned-thread-group__head">
        <PinIcon filled />
        <span>{t("sidebar.pinned")}</span>
      </div>
      <SortableContext items={[...sortableIds]} strategy={verticalListSortingStrategy}>
        <div className="session-list session-list--pinned">
          {pinnedThreads.map((thread) => {
            const active = thread.workspaceId === selectedWorkspace?.id && thread.session.id === selectedSession?.id;
            return (
              <SortablePinnedThreadRow
                key={`${thread.workspaceId}:${thread.session.id}`}
                id={sortableIdForThread(thread)}
                active={active}
                thread={thread}
                threadMenu={threadMenu}
                onSelect={() => onSelectSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })}
                onTogglePinned={() =>
                  onSetSessionPinned(
                    { workspaceId: thread.workspaceId, sessionId: thread.session.id },
                    !thread.session.pinnedAt,
                  )
                }
              />
            );
          })}
        </div>
      </SortableContext>
    </section>
  );
}

/* ── Thread session row ────────────────────────────────── */

function SortablePinnedThreadRow({
  id,
  active,
  thread,
  threadMenu,
  onSelect,
  onTogglePinned,
}: {
  readonly id: string;
  readonly active: boolean;
  readonly thread: ThreadListEntry;
  readonly threadMenu: ThreadMenuState;
  readonly onSelect: () => void;
  readonly onTogglePinned: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : undefined,
  };
  return (
    <ThreadSessionRow
      ref={setNodeRef}
      style={style}
      active={active}
      thread={thread}
      threadMenu={threadMenu}
      showContext
      dragging={isDragging}
      dragAttributes={attributes}
      dragListeners={listeners}
      onSelect={onSelect}
      onTogglePinned={onTogglePinned}
    />
  );
}

function sessionIndicatorVariant(thread: ThreadListEntry): "running" | "failed" | "unseen" | "none" {
  if (thread.session.status === "running") {
    return "running";
  }
  if (thread.session.status === "failed") {
    return "failed";
  }
  if (thread.session.hasUnseenUpdate) {
    return "unseen";
  }
  return "none";
}

interface ThreadSessionRowProps {
  readonly active: boolean;
  readonly showContext?: boolean;
  readonly overlay?: boolean;
  readonly dragging?: boolean;
  readonly style?: CSSProperties;
  readonly dragAttributes?: DraggableAttributes;
  readonly dragListeners?: DraggableSyntheticListeners;
  readonly thread: ThreadListEntry;
  readonly threadMenu?: ThreadMenuState;
  readonly onSelect: () => void;
  readonly onTogglePinned: () => void;
}

const ThreadSessionRow = forwardRef<HTMLDivElement, ThreadSessionRowProps>(function ThreadSessionRow({
  active,
  showContext = false,
  overlay = false,
  dragging = false,
  style,
  dragAttributes,
  dragListeners,
  thread,
  threadMenu,
  onSelect,
  onTogglePinned,
}, ref) {
  const { t } = useTranslation();
  const indicatorVariant = sessionIndicatorVariant(thread);
  const pinned = Boolean(thread.session.pinnedAt);
  const actionContext = showContext ? ` · ${thread.contextLabel}` : "";
  const classes = [
    "session-row",
    active ? "session-row--active" : "",
    pinned ? "session-row--pinned" : "",
    dragging ? "session-row--dragging" : "",
    overlay ? "session-row--overlay" : "",
  ].filter(Boolean).join(" ");
  return (
    <>
    <div
      ref={ref}
      style={style}
      className={classes}
      data-sidebar-indicator={indicatorVariant}
      data-session-pinned={pinned ? "true" : "false"}
      data-session-id={thread.session.id}
      onClick={() => {
        if (!dragging) onSelect();
      }}
      onContextMenu={(event) => {
        if (!threadMenu || overlay) return;
        event.preventDefault();
        event.stopPropagation();
        threadMenu.openMenu(thread.session.id);
      }}
    >
      <button
        className="session-row__select"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        type="button"
        {...dragAttributes}
        {...dragListeners}
      >
        <span className="session-row__leading" aria-hidden="true">
          {indicatorVariant === "running" ? <span className="session-row__status session-row__status--running" /> : null}
          {indicatorVariant === "failed" ? <span className="session-row__status session-row__status--failed" /> : null}
          {indicatorVariant === "unseen" ? <span className="session-row__status session-row__status--unseen" /> : null}
        </span>
        <span className="session-row__body">
          <span className="session-row__title-line">
            <span className="session-row__title">{thread.session.title}</span>
          </span>
          {showContext ? <span className="session-row__context">{thread.contextLabel}</span> : null}
          {thread.session.preview ? <span className="session-row__preview">{thread.session.preview}</span> : null}
        </span>
      </button>
      <span className="session-row__trailing">
        {thread.environment.kind === "worktree" ? (
          <span className="session-row__workspace-icon" aria-hidden="true" title={t("common.worktree")}>
            <WorktreeIcon />
          </span>
        ) : null}
        <span className="session-row__time">{formatRelativeTime(thread.session.updatedAt)}</span>
        <span className="session-row__action-cluster">
          <button
            aria-label={t(pinned ? "sidebar.unpinThread" : "sidebar.pinThread") + ` ${thread.session.title}${actionContext}`}
            aria-pressed={pinned}
            className="icon-button session-row__action session-row__pin-action"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onTogglePinned();
            }}
          >
            <PinIcon filled={pinned} />
          </button>
          {threadMenu && !overlay ? (
          <span
            className="session-row__menu-wrap"
            ref={threadMenu.menuSessionId === thread.session.id ? threadMenu.menuWrapRef : undefined}
          >
            <button
              aria-label={t("sidebar.threadActions", { name: thread.session.title, context: actionContext })}
              aria-haspopup="menu"
              aria-expanded={threadMenu.menuSessionId === thread.session.id}
              className="icon-button session-row__action session-row__menu-button"
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                threadMenu.toggleMenu(thread.session.id);
              }}
            >
              <Ellipsis aria-hidden="true" />
            </button>
            {threadMenu.menuSessionId === thread.session.id ? (
              <div className="workspace-menu session-row__menu" role="menu">
                <button
                  className="workspace-menu__item"
                  type="button"
                  onClick={(event) => threadMenu.runMenuAction(event, () => threadMenu.startRename(thread))}
                >
                  <span>{t("sidebar.renameThread")}</span>
                  <span className="workspace-menu__shortcut" aria-hidden="true">{RENAME_THREAD_SHORTCUT_HINT}</span>
                </button>
                {thread.session.hasUnseenUpdate ? (
                  <button
                    className="workspace-menu__item"
                    type="button"
                    onClick={(event) => threadMenu.runMenuAction(event, () => threadMenu.markRead(thread))}
                  >
                    {t("sidebar.markRead")}
                  </button>
                ) : null}
                <button
                  className="workspace-menu__item"
                  type="button"
                  onClick={(event) => threadMenu.runMenuAction(event, () => threadMenu.copySessionId(thread))}
                >
                  {t("sidebar.copySessionId")}
                </button>
                <button
                  className="workspace-menu__item workspace-menu__item--danger"
                  type="button"
                  onClick={(event) => threadMenu.runMenuAction(event, () => threadMenu.deleteThread(thread))}
                >
                  {t("sidebar.deleteThread")}
                </button>
              </div>
            ) : null}
          </span>
          ) : null}
        </span>
      </span>
    </div>
    {threadMenu?.renameSessionId === thread.session.id ? (
      <form
        className="workspace-rename session-rename"
        ref={threadMenu.renamePanelRef}
        onSubmit={(event) => {
          event.preventDefault();
          threadMenu.submitRename(thread);
        }}
      >
        <input
          aria-label={t("sidebar.renameThreadLabel", { name: thread.session.title })}
          className="workspace-rename__input"
          ref={threadMenu.renameInputRef}
          value={threadMenu.renameDraft}
          onChange={(event) => threadMenu.setRenameDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              threadMenu.cancelRename();
            }
          }}
        />
        <div className="workspace-rename__actions">
          <button className="workspace-rename__button" type="button" onClick={threadMenu.cancelRename}>{t("common.cancel")}</button>
          <button className="workspace-rename__button workspace-rename__button--primary" type="submit">{t("common.save")}</button>
        </div>
      </form>
    ) : null}
  </>
  );
});
