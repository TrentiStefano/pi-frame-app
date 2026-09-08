export interface ParsedThinkingMessage {
  readonly thinking?: string;
  readonly answer: string;
  readonly isThinkingStreaming: boolean;
}

const THINK_TAG_CLOSED_REGEX = /<\s*(think|thinking|thought)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi;
const THINK_TAG_UNCLOSED_REGEX = /<\s*(think|thinking|thought)\b[^>]*>([\s\S]*)$/i;

/**
 * Parses thinking content from assistant message text or structured thinking field.
 * Handles <think>...</think>, <thought>...</thought>, and <thinking>...</thinking> tags,
 * as well as unclosed streaming tags.
 */
export function parseMessageThinking(
  rawText: string = "",
  structuredThinking?: string,
  streaming: boolean = false,
): ParsedThinkingMessage {
  const thinkingParts: string[] = [];

  if (structuredThinking && structuredThinking.trim()) {
    thinkingParts.push(structuredThinking.trim());
  }

  let textWithoutClosedTags = rawText.replace(THINK_TAG_CLOSED_REGEX, (_, _tag: string, content: string) => {
    const trimmed = content.trim();
    if (trimmed) {
      thinkingParts.push(trimmed);
    }
    return "";
  });

  let isThinkingStreaming = false;
  let answer = textWithoutClosedTags;

  if (streaming) {
    const unclosedMatch = answer.match(THINK_TAG_UNCLOSED_REGEX);
    if (unclosedMatch) {
      isThinkingStreaming = true;
      const unclosedContent = (unclosedMatch[2] ?? "").trim();
      if (unclosedContent) {
        thinkingParts.push(unclosedContent);
      }
      answer = answer.slice(0, unclosedMatch.index);
    }
  }

  answer = answer.trim();
  const thinking = thinkingParts.length > 0 ? thinkingParts.join("\n\n") : undefined;

  return {
    thinking,
    answer,
    isThinkingStreaming,
  };
}
