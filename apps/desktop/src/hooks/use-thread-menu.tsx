import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import type { DesktopAppState, WorkspaceSessionTarget } from "../desktop-state";
import type { PiDesktopApi } from "../ipc";
import type { ThreadListEntry } from "../thread-groups";
import { useTranslation } from "react-i18next";

interface UseThreadMenuParams {
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: (
    api: PiDesktopApi,
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
}

export interface ThreadMenuState {
  readonly menuSessionId: string | null;
  readonly renameSessionId: string | null;
  readonly renameDraft: string;
  readonly setRenameDraft: Dispatch<SetStateAction<string>>;
  readonly menuWrapRef: RefObject<HTMLSpanElement | null>;
  readonly renamePanelRef: RefObject<HTMLFormElement | null>;
  readonly renameInputRef: RefObject<HTMLInputElement | null>;
  readonly toggleMenu: (sessionId: string) => void;
  readonly openMenu: (sessionId: string) => void;
  readonly startRename: (thread: ThreadListEntry) => void;
  readonly submitRename: (thread: ThreadListEntry) => void;
  readonly cancelRename: () => void;
  readonly deleteThread: (thread: ThreadListEntry) => void;
  readonly markRead: (thread: ThreadListEntry) => void;
  readonly copySessionId: (thread: ThreadListEntry) => void;
  readonly runMenuAction: (event: ReactMouseEvent<HTMLElement>, action: () => void) => void;
}

export function useThreadMenu({ api, setSnapshot, updateSnapshot }: UseThreadMenuParams): ThreadMenuState {
  const { t } = useTranslation();
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const menuWrapRef = useRef<HTMLSpanElement | null>(null);
  const renamePanelRef = useRef<HTMLFormElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renameSessionId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renameSessionId]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!menuWrapRef.current?.contains(target) && !renamePanelRef.current?.contains(target)) {
        setMenuSessionId(null);
        setRenameSessionId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuSessionId(null);
        setRenameSessionId(null);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const targetFor = (thread: ThreadListEntry): WorkspaceSessionTarget => ({
    workspaceId: thread.workspaceId,
    sessionId: thread.session.id,
  });
  const mutate = (action: () => Promise<DesktopAppState>) => {
    setMenuSessionId(null);
    void updateSnapshot(api, setSnapshot, action);
  };

  return {
    menuSessionId,
    renameSessionId,
    renameDraft,
    setRenameDraft,
    menuWrapRef,
    renamePanelRef,
    renameInputRef,
    toggleMenu: (sessionId) => {
      setRenameSessionId(null);
      setMenuSessionId((current) => (current === sessionId ? null : sessionId));
    },
    openMenu: (sessionId) => {
      setRenameSessionId(null);
      setMenuSessionId(sessionId);
    },
    startRename: (thread) => {
      setMenuSessionId(null);
      setRenameSessionId(thread.session.id);
      setRenameDraft(thread.session.title);
    },
    submitRename: (thread) => {
      const nextTitle = renameDraft.trim();
      setMenuSessionId(null);
      setRenameSessionId(null);
      setRenameDraft("");
      if (!nextTitle || nextTitle === thread.session.title) return;
      mutate(() => api.renameSession(targetFor(thread), nextTitle));
    },
    cancelRename: () => {
      setRenameSessionId(null);
      setRenameDraft("");
    },
    deleteThread: (thread) => {
      setMenuSessionId(null);
      const confirmed = window.confirm(
        t("sidebar.deleteThreadConfirmation", { name: thread.session.title }),
      );
      if (!confirmed) return;
      mutate(() => api.deleteSession(targetFor(thread)));
    },
    markRead: (thread) => mutate(() => api.markSessionRead(targetFor(thread))),
    copySessionId: (thread) => {
      setMenuSessionId(null);
      void navigator.clipboard.writeText(thread.session.id);
    },
    runMenuAction: (event, action) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    },
  };
}
