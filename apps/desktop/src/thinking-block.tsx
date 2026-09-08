import { useState, useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon, ReasoningIcon } from "./icons";
import { MessageMarkdown } from "./message-markdown";

interface ThinkingBlockProps {
  readonly thinking: string;
  readonly defaultMinimized: boolean;
  readonly streaming?: boolean;
}

export function ThinkingBlock({
  thinking,
  defaultMinimized,
  streaming = false,
}: ThinkingBlockProps) {
  const { t } = useTranslation();
  const [isMinimized, setIsMinimized] = useState(defaultMinimized);
  const contentId = useId();

  // Sync with defaultMinimized when user toggles the global stats bar toggle
  useEffect(() => {
    setIsMinimized(defaultMinimized);
  }, [defaultMinimized]);

  return (
    <div
      className={`thinking-block ${isMinimized ? "thinking-block--minimized" : "thinking-block--expanded"} ${streaming ? "thinking-block--streaming" : ""}`}
      data-testid="thinking-block"
      data-minimized={isMinimized}
    >
      <button
        type="button"
        className="thinking-block__header"
        onClick={() => setIsMinimized((prev) => !prev)}
        aria-expanded={!isMinimized}
        aria-controls={contentId}
        aria-label={
          isMinimized
            ? t("timeline.expandThinking", "Expand thought process")
            : t("timeline.minimizeThinking", "Minimize thought process")
        }
        title={
          isMinimized
            ? t("timeline.expandThinking", "Expand thought process")
            : t("timeline.minimizeThinking", "Minimize thought process")
        }
      >
        <span
          className={`thinking-block__chevron ${!isMinimized ? "thinking-block__chevron--expanded" : ""}`}
          aria-hidden="true"
        >
          <ChevronRightIcon />
        </span>
        <span className="thinking-block__icon" aria-hidden="true">
          <ReasoningIcon />
        </span>
        <span className="thinking-block__title">
          {streaming
            ? t("timeline.thinkingStreaming", "Thinking…")
            : t("timeline.thoughtProcess", "Thought process")}
        </span>
        {streaming ? (
          <span className="thinking-block__pulsing-dot" aria-hidden="true" />
        ) : null}
        <span className="thinking-block__state">
          {isMinimized
            ? t("timeline.minimizedState", "Minimized")
            : t("timeline.expandedState", "Expanded")}
        </span>
      </button>
      {!isMinimized ? (
        <div className="thinking-block__body" id={contentId} data-testid="thinking-block-content">
          <MessageMarkdown text={thinking} streaming={streaming} />
        </div>
      ) : null}
    </div>
  );
}
