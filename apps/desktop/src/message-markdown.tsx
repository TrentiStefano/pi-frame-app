import { memo, useLayoutEffect, useRef } from "react";
import { recordRendererCommit } from "./test-performance-diagnostics";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];

const MARKDOWN_COMPONENTS = {
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const code = String(children).replace(/\n$/, "");
    return <code className={className}>{code}</code>;
  },
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  ),
} as const;

export const MessageMarkdown = memo(function MessageMarkdown({
  text,
  streaming = false,
}: {
  readonly text: string;
  readonly streaming?: boolean;
}) {
  const renderStartedAtRef = useRef<number | null>(null);
  renderStartedAtRef.current = window.__piAppTestMode && !streaming ? performance.now() : null;
  useLayoutEffect(() => {
    const startedAt = renderStartedAtRef.current;
    if (startedAt === null) {
      return;
    }
    recordRendererCommit("markdown", performance.now() - startedAt);
    renderStartedAtRef.current = null;
  });

  if (streaming) {
    return (
      <div className="message__content message__content--streaming" data-streaming-text="true">
        {text}
      </div>
    );
  }

  return (
    <div className="message__content">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={MARKDOWN_COMPONENTS}
        // Conversation content is markdown, not an HTML document. Skipping
        // raw HTML avoids building unused nodes and keeps rendering predictable.
        skipHtml
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
