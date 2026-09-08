import { startTransition, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AssistantStreamPatch, SessionMetadataPatch } from "../ipc";
import type { DesktopAppState, SelectedTranscriptRecord } from "../desktop-state";
import {
  ensureRendererTestPerformanceDiagnostics,
  installRendererTestPerformanceDiagnostics,
  recordStreamCursorUpdate,
  recordStreamPatchApplied,
  recordStreamPatchGap,
  recordStreamPatchSkipped,
} from "../test-performance-diagnostics";

export function useDesktopAppState() {
  const [snapshot, setSnapshot] = useState<DesktopAppState | null>(null);
  const [selectedTranscript, setSelectedTranscript] = useState<SelectedTranscriptRecord | null>(null);
  const pendingSnapshotRef = useRef<DesktopAppState | null>(null);
  const pendingTranscriptRef = useRef<SelectedTranscriptRecord | null | undefined>(undefined);
  const pendingTranscriptPatchesRef = useRef<AssistantStreamPatch[]>([]);
  const pendingSessionMetadataPatchesRef = useRef<SessionMetadataPatch[]>([]);
  const selectedTranscriptRef = useRef<SelectedTranscriptRecord | null>(null);
  const transcriptRevisionsRef = useRef(new Map<string, number>());
  const requestTranscriptResyncRef = useRef<((sessionKey: string) => void) | null>(null);
  const streamSequencesRef = useRef(new Map<string, number>());
  const streamMessageRunIdsRef = useRef(new Map<string, string | undefined>());
  const streamResyncInFlightRef = useRef(false);
  const selectedSessionKeyRef = useRef("");
  const publishFrameRef = useRef<number | null>(null);
  const initialStateHydratedRef = useRef(false);
  const metadataRevisionBySessionRef = useRef(new Map<string, number>());

  useEffect(() => installRendererTestPerformanceDiagnostics(), []);

  useEffect(() => {
    let active = true;
    let receivedPushedTranscript = false;
    const api = window.piApp;
    if (!api) {
      return undefined;
    }

    const profiling = ensureRendererTestPerformanceDiagnostics();
    const commitHydratedTranscript = (
      payload: SelectedTranscriptRecord | null,
      expectedSession?: { readonly workspaceId?: string; readonly sessionId?: string },
    ): void => {
      const currentWorkspaceId =
        expectedSession?.workspaceId ??
        pendingSnapshotRef.current?.selectedWorkspaceId ??
        snapshot?.selectedWorkspaceId;
      const currentSessionId =
        expectedSession?.sessionId ??
        pendingSnapshotRef.current?.selectedSessionId ??
        snapshot?.selectedSessionId;
      const targetSession = { workspaceId: currentWorkspaceId, sessionId: currentSessionId };
      if (!shouldCommitHydratedTranscript(payload, targetSession)) {
        return;
      }
      if (!payload) {
        selectedTranscriptRef.current = null;
        setSelectedTranscript(null);
        return;
      }
      if (!acceptTranscriptSnapshot(transcriptRevisionsRef.current, payload)) {
        return;
      }
      const hydrated = hydrateTranscriptWithPendingPatches(
        payload,
        pendingTranscriptPatchesRef.current,
        streamSequencesRef.current,
        streamMessageRunIdsRef.current,
      );
      if (hydrated.resyncSessionKey) {
        selectedTranscriptRef.current = payload;
        setSelectedTranscript(payload);
        requestTranscriptResyncRef.current?.(hydrated.resyncSessionKey);
        return;
      }
      pendingTranscriptPatchesRef.current = pendingTranscriptPatchesRef.current.filter(
        (patch) => `${patch.workspaceId}:${patch.sessionId}` !== transcriptSessionKey(payload),
      );
      selectedTranscriptRef.current = hydrated.transcript;
      setSelectedTranscript(hydrated.transcript);
    };
    const requestTranscriptResync = (sessionKey: string) => {
      if (streamResyncInFlightRef.current) {
        return;
      }
      streamResyncInFlightRef.current = true;
      let followUpSessionKey: string | undefined;
      void api.getSelectedTranscript()
        .then((payload) => {
          if (
            !active ||
            !payload ||
            transcriptSessionKey(payload) !== sessionKey ||
            selectedSessionKeyRef.current !== sessionKey ||
            !acceptTranscriptSnapshot(transcriptRevisionsRef.current, payload)
          ) {
            return;
          }
          clearStreamSequences(streamSequencesRef.current, streamMessageRunIdsRef.current, sessionKey);
          applyStreamCursor(streamSequencesRef.current, streamMessageRunIdsRef.current, payload);
          const payloadSessionKey = transcriptSessionKey(payload);
          const pending = pendingTranscriptPatchesRef.current.filter(
            (patch) => `${patch.workspaceId}:${patch.sessionId}` === payloadSessionKey,
          );
          pendingTranscriptPatchesRef.current = pendingTranscriptPatchesRef.current.filter(
            (patch) => `${patch.workspaceId}:${patch.sessionId}` !== payloadSessionKey,
          );
          const result = applyAssistantStreamPatches(
            payload,
            pending,
            streamSequencesRef.current,
            streamMessageRunIdsRef.current,
          );
          selectedTranscriptRef.current = result.resyncSessionKey ? payload : result.transcript;
          setSelectedTranscript(selectedTranscriptRef.current);
          if (result.resyncSessionKey) {
            followUpSessionKey = result.resyncSessionKey;
          }
        })
        .catch(() => undefined)
        .finally(() => {
          streamResyncInFlightRef.current = false;
          if (active && followUpSessionKey) {
            requestTranscriptResync(followUpSessionKey);
          } else if (active && pendingTranscriptPatchesRef.current.length > 0) {
            schedulePushedState();
          }
        });
    };
    requestTranscriptResyncRef.current = requestTranscriptResync;
    const flushPushedState = () => {
      const flushStartedAt = profiling ? performance.now() : 0;
      publishFrameRef.current = null;
      if (!active) {
        return;
      }
      const state = pendingSnapshotRef.current;
      const transcript = pendingTranscriptRef.current;
      const patches = pendingTranscriptPatchesRef.current.splice(0);
      const metadataPatches = pendingSessionMetadataPatchesRef.current.splice(0);
      if (!state && !initialStateHydratedRef.current && metadataPatches.length > 0) {
        pendingSessionMetadataPatchesRef.current.unshift(...metadataPatches);
      }
      pendingSnapshotRef.current = null;
      pendingTranscriptRef.current = undefined;
      let resyncSessionKey: string | undefined;
      const applyFrame = () => {
        if (state) {
          applySnapshotIfNewer(setSnapshot, state, metadataRevisionBySessionRef.current);
        }
        if (metadataPatches.length > 0) {
          applySessionMetadataPatches(
            setSnapshot,
            metadataPatches,
            metadataRevisionBySessionRef.current,
          );
        }
        let nextTranscript = selectedTranscriptRef.current;
        if (transcript === null) {
          nextTranscript = null;
        } else if (transcript && acceptTranscriptSnapshot(transcriptRevisionsRef.current, transcript)) {
          nextTranscript = transcript;
          applyStreamCursor(streamSequencesRef.current, streamMessageRunIdsRef.current, transcript);
        }
        if (patches.length > 0 && streamResyncInFlightRef.current) {
          pendingTranscriptPatchesRef.current.unshift(...patches);
        } else if (patches.length > 0 && nextTranscript) {
          const currentSessionKey = transcriptSessionKey(nextTranscript);
          const currentPatches = patches.filter(
            (patch) => `${patch.workspaceId}:${patch.sessionId}` === currentSessionKey,
          );
          const foreignPatches = patches.filter(
            (patch) => `${patch.workspaceId}:${patch.sessionId}` !== currentSessionKey,
          );
          if (foreignPatches.length > 0) {
            pendingTranscriptPatchesRef.current.unshift(...foreignPatches);
          }
          if (currentPatches.length > 0) {
            const result = applyAssistantStreamPatches(
              nextTranscript,
              currentPatches,
              streamSequencesRef.current,
              streamMessageRunIdsRef.current,
            );
            nextTranscript = result.transcript;
            resyncSessionKey = result.resyncSessionKey;
          }
        } else if (patches.length > 0 && !nextTranscript) {
          pendingTranscriptPatchesRef.current.unshift(...patches);
        }
        if (nextTranscript !== selectedTranscriptRef.current) {
          selectedTranscriptRef.current = nextTranscript;
          setSelectedTranscript(nextTranscript);
        }
      };
      if (
        state?.composerDraftSyncSource === "extension-editor-text" ||
        state?.composerDraftSyncSource === "remote-persist"
      ) {
        // Host replacements and remote draft updates are direct user-visible
        // input. Do not defer them behind a transition or a busy transcript render.
        applyFrame();
      } else {
        startTransition(applyFrame);
      }
      if (resyncSessionKey) {
        requestTranscriptResync(resyncSessionKey);
      }
      if (profiling) {
        profiling.rafFlushCount += 1;
        profiling.rafFlushElapsedMs += performance.now() - flushStartedAt;
      }
    };

    const schedulePushedState = () => {
      if (publishFrameRef.current == null) {
        if (profiling) profiling.rafScheduledCount += 1;
        publishFrameRef.current = window.requestAnimationFrame(flushPushedState);
      }
    };

    const queueSnapshot = (incoming: DesktopAppState) => {
      const pending = pendingSnapshotRef.current;
      if (!pending || incoming.revision >= pending.revision) {
        pendingSnapshotRef.current = incoming;
      }
      schedulePushedState();
    };

    void Promise.all([api.getState(), api.getSelectedTranscript()]).then(([state, transcript]) => {
      if (!active) {
        return;
      }
      applySnapshotIfNewer(setSnapshot, state, metadataRevisionBySessionRef.current);
      initialStateHydratedRef.current = true;
      if (pendingSessionMetadataPatchesRef.current.length > 0) {
        schedulePushedState();
      }
      // Initial IPC responses can race pushed state/transcript events. Apply only
      // when no newer pushed transcript is already known and the payload matches the expected session.
      if (!receivedPushedTranscript || selectedTranscriptRef.current === null) {
        const expectedWorkspaceId =
          pendingSnapshotRef.current?.selectedWorkspaceId ?? state.selectedWorkspaceId;
        const expectedSessionId =
          pendingSnapshotRef.current?.selectedSessionId ?? state.selectedSessionId;
        commitHydratedTranscript(transcript, {
          workspaceId: expectedWorkspaceId,
          sessionId: expectedSessionId,
        });
      }
    });

    const unsubscribeState = api.onStateChanged((state) => {
      if (active) {
        const receiptStartedAt = profiling ? performance.now() : 0;
        if (
          state.composerDraftSyncSource === "extension-editor-text" ||
          state.composerDraftSyncSource === "remote-persist"
        ) {
          applySnapshotIfNewer(setSnapshot, state, metadataRevisionBySessionRef.current);
        } else {
          queueSnapshot(state);
        }
        if (profiling) {
          profiling.stateReceiptCount += 1;
          profiling.stateReceiptElapsedMs += performance.now() - receiptStartedAt;
        }
      }
    });
    const unsubscribeTranscript = api.onSelectedTranscriptChanged((payload) => {
      if (active) {
        receivedPushedTranscript = true;
        pendingTranscriptRef.current = payload;
        schedulePushedState();
      }
    });
    const unsubscribeAssistantStream = api.onAssistantStreamPatch((patch) => {
      if (active) {
        receivedPushedTranscript = true;
        pendingTranscriptPatchesRef.current.push(patch);
        schedulePushedState();
      }
    });
    const unsubscribeSessionMetadata = api.onSessionMetadataPatch((patch) => {
      if (active) {
        pendingSessionMetadataPatchesRef.current.push(patch);
        schedulePushedState();
      }
    });

    return () => {
      active = false;
      unsubscribeState();
      unsubscribeTranscript();
      unsubscribeAssistantStream();
      unsubscribeSessionMetadata();
      requestTranscriptResyncRef.current = null;
      if (publishFrameRef.current != null) {
        window.cancelAnimationFrame(publishFrameRef.current);
        publishFrameRef.current = null;
      }
      pendingSnapshotRef.current = null;
      pendingTranscriptRef.current = undefined;
      pendingTranscriptPatchesRef.current = [];
      pendingSessionMetadataPatchesRef.current = [];
      initialStateHydratedRef.current = false;
      metadataRevisionBySessionRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const api = window.piApp;
    const workspaceId = snapshot?.selectedWorkspaceId;
    const sessionId = snapshot?.selectedSessionId;
    const nextSessionKey = workspaceId && sessionId ? `${workspaceId}:${sessionId}` : "";
    if (selectedSessionKeyRef.current && selectedSessionKeyRef.current !== nextSessionKey) {
      clearStreamSequences(streamSequencesRef.current, streamMessageRunIdsRef.current, selectedSessionKeyRef.current);
    }
    selectedSessionKeyRef.current = nextSessionKey;
    if (!api || !workspaceId || !sessionId) {
      return undefined;
    }

    let active = true;
    void api.getSelectedTranscript().then((transcript) => {
      if (
        active &&
        transcript?.workspaceId === workspaceId &&
        transcript.sessionId === sessionId
      ) {
        if (!acceptTranscriptSnapshot(transcriptRevisionsRef.current, transcript)) {
          return;
        }
        const hydrated = hydrateTranscriptWithPendingPatches(
          transcript,
          pendingTranscriptPatchesRef.current,
          streamSequencesRef.current,
          streamMessageRunIdsRef.current,
        );
        if (hydrated.resyncSessionKey) {
          selectedTranscriptRef.current = transcript;
          setSelectedTranscript(transcript);
          requestTranscriptResyncRef.current?.(hydrated.resyncSessionKey);
          return;
        }
        pendingTranscriptPatchesRef.current = pendingTranscriptPatchesRef.current.filter(
          (patch) => `${patch.workspaceId}:${patch.sessionId}` !== nextSessionKey,
        );
        selectedTranscriptRef.current = hydrated.transcript;
        setSelectedTranscript(hydrated.transcript);
      }
    }).catch(() => undefined);

    return () => {
      active = false;
    };
  }, [snapshot?.selectedWorkspaceId, snapshot?.selectedSessionId]);

  return [snapshot, setSnapshot, selectedTranscript] as const;
}

function transcriptSessionKey(payload: Pick<SelectedTranscriptRecord, "workspaceId" | "sessionId">): string {
  return `${payload.workspaceId}:${payload.sessionId}`;
}

function streamCursorKey(
  sessionKey: string,
  runId: string | undefined,
  assistantMessageId: string,
): string {
  return `${sessionKey}:${runId ?? ""}:${assistantMessageId}`;
}

function applyStreamCursor(
  sequences: Map<string, number>,
  messageRunIds: Map<string, string | undefined>,
  payload: SelectedTranscriptRecord,
): void {
  const cursors = payload.streamCursors ?? (payload.streamCursor ? [payload.streamCursor] : []);
  const sessionKey = transcriptSessionKey(payload);
  for (const cursor of cursors) {
    const key = streamCursorKey(sessionKey, cursor.runId, cursor.assistantMessageId);
    messageRunIds.set(`${sessionKey}:${cursor.assistantMessageId}`, cursor.runId);
    if ((sequences.get(key) ?? -1) < cursor.sequence) {
      sequences.set(key, cursor.sequence);
      recordStreamCursorUpdate();
    }
  }
}

function clearStreamSequences(
  sequences: Map<string, number>,
  messageRunIds: Map<string, string | undefined>,
  sessionKey: string,
): void {
  const prefix = `${sessionKey}:`;
  for (const key of sequences.keys()) {
    if (key.startsWith(prefix)) {
      sequences.delete(key);
    }
  }
  for (const key of messageRunIds.keys()) {
    if (key.startsWith(prefix)) {
      messageRunIds.delete(key);
    }
  }
}

function hydrateTranscriptWithPendingPatches(
  payload: SelectedTranscriptRecord,
  pendingPatches: readonly AssistantStreamPatch[],
  sequences: Map<string, number>,
  messageRunIds: Map<string, string | undefined>,
): { readonly transcript: SelectedTranscriptRecord; readonly resyncSessionKey?: string } {
  applyStreamCursor(sequences, messageRunIds, payload);
  const sessionKey = transcriptSessionKey(payload);
  const patches = pendingPatches.filter((patch) => `${patch.workspaceId}:${patch.sessionId}` === sessionKey);
  if (patches.length === 0) {
    return { transcript: payload };
  }
  const result = applyAssistantStreamPatches(payload, patches, sequences, messageRunIds);
  if (!result.resyncSessionKey) {
    return { transcript: result.transcript };
  }
  clearStreamSequences(sequences, messageRunIds, sessionKey);
  applyStreamCursor(sequences, messageRunIds, payload);
  return { transcript: payload, resyncSessionKey: sessionKey };
}

function acceptTranscriptSnapshot(
  revisions: Map<string, number>,
  payload: SelectedTranscriptRecord,
): boolean {
  const key = transcriptSessionKey(payload);
  const previous = revisions.get(key);
  if (previous !== undefined && payload.revision <= previous) {
    return false;
  }
  revisions.set(key, payload.revision);
  return true;
}

function applyAssistantStreamPatches(
  current: SelectedTranscriptRecord,
  patches: readonly AssistantStreamPatch[],
  sequences: Map<string, number>,
  messageRunIds: Map<string, string | undefined>,
): { readonly transcript: SelectedTranscriptRecord; readonly resyncSessionKey?: string } {
  let transcript = [...current.transcript];
  let changed = false;
  const sessionKey = transcriptSessionKey(current);
  for (const patch of patches) {
    const patchSessionKey = `${patch.workspaceId}:${patch.sessionId}`;
    if (patchSessionKey !== sessionKey) {
      return { transcript: current, resyncSessionKey: patchSessionKey };
    }
    const messageKey = `${sessionKey}:${patch.assistantMessageId}`;
    if (messageRunIds.has(messageKey) && messageRunIds.get(messageKey) !== patch.runId) {
      recordStreamPatchGap();
      return { transcript: current, resyncSessionKey: sessionKey };
    }
    const sequenceKey = streamCursorKey(sessionKey, patch.runId, patch.assistantMessageId);
    const previousSequence = sequences.get(sequenceKey);
    if (previousSequence !== undefined) {
      if (patch.sequence <= previousSequence) {
        recordStreamPatchSkipped();
        continue;
      }
      if (patch.sequence !== previousSequence + patch.deltaCount) {
        recordStreamPatchGap();
        return { transcript: current, resyncSessionKey: sessionKey };
      }
    }
    const index = transcript.findIndex((item) => item.id === patch.assistantMessageId);
    if (index === -1) {
      if (previousSequence !== undefined) {
        recordStreamPatchGap();
        return { transcript: current, resyncSessionKey: sessionKey };
      }
      transcript.push({
        kind: "message",
        id: patch.assistantMessageId,
        role: "assistant",
        text: patch.text,
        createdAt: patch.assistantMessageCreatedAt,
      });
      changed = true;
    } else {
      const item = transcript[index];
      if (
        item?.kind !== "message" ||
        item.role !== "assistant" ||
        item.createdAt !== patch.assistantMessageCreatedAt
      ) {
        recordStreamPatchGap();
        return { transcript: current, resyncSessionKey: sessionKey };
      }
      transcript[index] = { ...item, text: `${item.text}${patch.text}` };
      changed = true;
    }
    messageRunIds.set(messageKey, patch.runId);
    sequences.set(sequenceKey, patch.sequence);
    recordStreamPatchApplied();
  }
  return changed
    ? { transcript: { ...current, transcript } }
    : { transcript: current };
}

/**
 * Never let a state snapshot with a lower revision overwrite a newer one. IPC
 * responses race the pushed state-changed events: a response is built when the
 * handler returns, but concurrent session events can bump the state (and get
 * pushed) before the response crosses the IPC boundary. Applying the stale
 * response unguarded would silently roll the UI back — e.g. a /name rename
 * right after an aborted run lost its title this way.
 */
function applySessionMetadataPatches(
  setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
  patches: readonly SessionMetadataPatch[],
  metadataRevisionBySession: Map<string, number>,
): void {
  setSnapshot((current) => {
    if (!current) {
      return current;
    }
    let next = current;
    for (const patch of patches) {
      const key = `${patch.workspaceId}:${patch.sessionId}`;
      if (patch.revision <= (metadataRevisionBySession.get(key) ?? -1)) {
        continue;
      }
      let changed = false;
      const workspaces = next.workspaces.map((workspace) => {
        const session = workspace.sessions.find((entry) => entry.id === patch.sessionId);
        if (!session || workspace.id !== patch.workspaceId) {
          return workspace;
        }
        changed = true;
        return {
          ...workspace,
          sessions: workspace.sessions.map((entry) =>
            entry.id === patch.sessionId
              ? {
                  ...entry,
                  title: patch.title,
                  updatedAt: patch.updatedAt,
                  preview: patch.preview,
                  status: patch.status,
                  ...(patch.runningSince ? { runningSince: patch.runningSince } : { runningSince: undefined }),
                  hasUnseenUpdate: patch.hasUnseenUpdate,
                  metadataRevision: patch.revision,
                  activeAssistantMessageId: patch.activeAssistantMessageId,
                }
              : entry,
          ),
        };
      });
      if (changed) {
        metadataRevisionBySession.set(key, patch.revision);
        next = { ...next, workspaces };
      }
    }
    return next;
  });
}

export function applySnapshotIfNewer(
  setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
  incoming: DesktopAppState,
  metadataRevisionBySession?: Map<string, number>,
): void {
  setSnapshot((current) => {
    if (current && incoming.revision < current.revision) {
      return current;
    }
    if (!metadataRevisionBySession) {
      return incoming;
    }
    const workspaces = incoming.workspaces.map((workspace) => ({
      ...workspace,
      sessions: workspace.sessions.map((session) => {
        const key = `${workspace.id}:${session.id}`;
        const metadataRevision = session.metadataRevision ?? incoming.revision;
        const currentSession = current?.workspaces
          .find((entry) => entry.id === workspace.id)
          ?.sessions.find((entry) => entry.id === session.id);
        const knownMetadataRevision = metadataRevisionBySession.get(key) ?? -1;
        if (knownMetadataRevision > metadataRevision && currentSession) {
          return {
            ...session,
            title: currentSession.title,
            updatedAt: currentSession.updatedAt,
            preview: currentSession.preview,
            status: currentSession.status,
            runningSince: currentSession.runningSince,
            hasUnseenUpdate: currentSession.hasUnseenUpdate,
            metadataRevision: currentSession.metadataRevision,
            activeAssistantMessageId: currentSession.activeAssistantMessageId,
          };
        }
        metadataRevisionBySession.set(key, Math.max(knownMetadataRevision, metadataRevision));
        return session;
      }),
    }));
    return { ...incoming, workspaces };
  });
}

export function updateSnapshot(
  api: NonNullable<typeof window.piApp>,
  setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
  action: () => Promise<DesktopAppState>,
) {
  return action().then((state) => {
    setSnapshot((current) => (current && state.revision <= current.revision ? current : state));
    return state;
  });
}

export function shouldCommitHydratedTranscript(
  payload: SelectedTranscriptRecord | null,
  expectedSession: { readonly workspaceId?: string; readonly sessionId?: string } | undefined,
): boolean {
  if (!payload) {
    return !expectedSession?.sessionId;
  }
  return (
    payload.workspaceId === expectedSession?.workspaceId &&
    payload.sessionId === expectedSession?.sessionId
  );
}
