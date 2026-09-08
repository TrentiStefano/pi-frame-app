import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { HostUiResponse } from "@pi-frame/session-driver";
import { trapDialogFocus } from "./dialog-focus";
import type { SessionExtensionDialogRecord } from "./desktop-state";
import { useTranslation } from "react-i18next";

export function ExtensionDialog({
  dialog,
  onRespond,
}: {
  readonly dialog: SessionExtensionDialogRecord;
  readonly onRespond: (response: HostUiResponse) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstOptionButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (dialog.kind === "input") {
      setDraft(dialog.initialValue ?? "");
      return;
    }
    if (dialog.kind === "editor") {
      setDraft(dialog.initialValue ?? "");
      return;
    }
    setDraft("");
  }, [dialog]);

  useEffect(() => {
    if (dialog.kind === "confirm") {
      cancelButtonRef.current?.focus();
      return;
    }
    if (dialog.kind === "select") {
      firstOptionButtonRef.current?.focus();
    }
  }, [dialog]);

  const respondWithCancel = () => onRespond({ requestId: dialog.requestId, cancelled: true });
  const respondWithSubmit = () => {
    if (dialog.kind === "confirm") {
      onRespond({ requestId: dialog.requestId, confirmed: true });
      return;
    }
    if (dialog.kind === "input" || dialog.kind === "editor") {
      onRespond({ requestId: dialog.requestId, value: draft });
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      trapDialogFocus(event, dialogRef.current);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      respondWithCancel();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      if (dialog.kind === "confirm" || dialog.kind === "input" || dialog.kind === "editor") {
        event.preventDefault();
        respondWithSubmit();
      }
    }
  };

  return (
    <div className="extension-dialog-backdrop">
      <div
        aria-describedby={dialog.kind === "confirm" ? bodyId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="extension-dialog"
        data-testid="extension-dialog"
        ref={dialogRef}
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <div className="extension-dialog__title" id={titleId}>
          {dialog.title}
        </div>
        {dialog.kind === "confirm" ? (
          <p className="extension-dialog__body" id={bodyId}>
            {dialog.message}
          </p>
        ) : null}

        {dialog.kind === "select" ? (
          <div className="extension-dialog__options">
            {dialog.options.map((option, index) => (
              <button
                className="extension-dialog__option"
                key={option}
                ref={index === 0 ? firstOptionButtonRef : undefined}
                type="button"
                onClick={() => onRespond({ requestId: dialog.requestId, value: option })}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}

        {dialog.kind === "input" ? (
          <input
            autoFocus
            className="skills-search"
            placeholder={dialog.placeholder ?? t("dialog.enterValue")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : null}

        {dialog.kind === "editor" ? (
          <textarea
            autoFocus
            className="extension-dialog__editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : null}

        <div className="extension-dialog__actions">
          <button
            ref={cancelButtonRef}
            className="button button--secondary"
            data-testid="extension-dialog-cancel"
            type="button"
            onClick={respondWithCancel}
          >
            {t("common.cancel")}
          </button>
          {dialog.kind === "confirm" ? (
            <button
              className="button button--primary"
              data-testid="extension-dialog-confirm"
              type="button"
              onClick={respondWithSubmit}
            >
              {t("common.confirm")}
            </button>
          ) : null}
          {dialog.kind === "input" || dialog.kind === "editor" ? (
            <button
              className="button button--primary"
              data-testid="extension-dialog-submit"
              type="button"
              onClick={respondWithSubmit}
            >
              {t("common.submit")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
