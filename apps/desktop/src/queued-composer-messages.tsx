import type { ComposerAttachment, QueuedComposerMessage } from "./desktop-state";
import { BrowserPreviewIcon, FileIcon } from "./icons";
import { useTranslation } from "react-i18next";

interface QueuedComposerMessagesProps {
  readonly messages: readonly QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly onEditMessage: (messageId: string) => void;
  readonly onRemoveMessage: (messageId: string) => void;
  readonly onSteerMessage: (messageId: string) => void;
  readonly onCancelEdit: () => void;
}

export function QueuedComposerMessages({
  messages,
  editingQueuedMessageId,
  onEditMessage,
  onRemoveMessage,
  onSteerMessage,
  onCancelEdit,
}: QueuedComposerMessagesProps) {
  const { t } = useTranslation();
  if (messages.length === 0 && !editingQueuedMessageId) {
    return null;
  }

  return (
    <div className="queued-composer-messages" data-testid="queued-composer-messages">
      {editingQueuedMessageId ? (
        <div className="queued-composer-messages__editing" data-testid="queued-composer-editing">
          <span>{t("queue.editing")}</span>
          <button type="button" onClick={onCancelEdit}>
            {t("common.cancel")}
          </button>
        </div>
      ) : null}
      {messages.map((message) => (
        <div
          className={`queued-composer-message ${message.id === editingQueuedMessageId ? "queued-composer-message--editing" : ""}`}
          data-testid="queued-composer-message"
          key={message.id}
        >
          <div className="queued-composer-message__header">
            {message.text ? <div className="queued-composer-message__text">{message.text}</div> : null}
            <div className="queued-composer-message__actions">
              {message.mode !== "steer" ? (
                <button type="button" onClick={() => onSteerMessage(message.id)}>
                  {t("composer.steer")}
                </button>
              ) : null}
              <button type="button" onClick={() => onEditMessage(message.id)}>
                {t("common.edit")}
              </button>
              <button aria-label={t("queue.deleteMessage", { name: message.text || message.id })} type="button" onClick={() => onRemoveMessage(message.id)}>
                {t("common.delete")}
              </button>
            </div>
          </div>
          {message.attachments.length > 0 ? (
            <div className="queued-composer-message__attachments">
              {message.attachments.map((attachment, index) => (
                <QueuedAttachmentPreview attachment={attachment} key={`${message.id}:${attachment.name}:${index}`} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function QueuedAttachmentPreview({ attachment }: { readonly attachment: ComposerAttachment }) {
  return (
    <div className={`queued-composer-attachment queued-composer-attachment--${attachment.kind}`}>
      {attachment.kind === "image" ? (
        <img
          alt={attachment.name}
          className="queued-composer-attachment__preview"
          src={`data:${attachment.mimeType};base64,${attachment.data}`}
        />
      ) : attachment.kind === "browser-element" ? (
        <span className="queued-composer-attachment__icon" aria-hidden="true">
          <BrowserPreviewIcon />
        </span>
      ) : (
        <span className="queued-composer-attachment__icon" aria-hidden="true">
          <FileIcon />
        </span>
      )}
      <span className="queued-composer-attachment__name">{attachment.name}</span>
    </div>
  );
}
