import test from "node:test";
import assert from "node:assert/strict";
import { parseMessageThinking } from "./thinking-parser";

test("parseMessageThinking returns rawText when no thinking blocks exist", () => {
  const result = parseMessageThinking("Hello, world!");
  assert.strictEqual(result.thinking, undefined);
  assert.strictEqual(result.answer, "Hello, world!");
  assert.strictEqual(result.isThinkingStreaming, false);
});

test("parseMessageThinking parses <think>...</think> tags", () => {
  const input = "<think>\nLet me calculate 2+2.\nIt is 4.\n</think>\nThe answer is 4.";
  const result = parseMessageThinking(input);
  assert.strictEqual(result.thinking, "Let me calculate 2+2.\nIt is 4.");
  assert.strictEqual(result.answer, "The answer is 4.");
  assert.strictEqual(result.isThinkingStreaming, false);
});

test("parseMessageThinking parses <thought>...</thought> and <thinking>...</thinking> tags", () => {
  const input1 = "<thought>Thinking carefully...</thought>Final result";
  const result1 = parseMessageThinking(input1);
  assert.strictEqual(result1.thinking, "Thinking carefully...");
  assert.strictEqual(result1.answer, "Final result");

  const input2 = "<thinking>Another thought</thinking>Done";
  const result2 = parseMessageThinking(input2);
  assert.strictEqual(result2.thinking, "Another thought");
  assert.strictEqual(result2.answer, "Done");
});

test("parseMessageThinking parses multiple thinking tags", () => {
  const input = "<think>Part 1</think>Intermediate text.<think>Part 2</think>Conclusion.";
  const result = parseMessageThinking(input);
  assert.strictEqual(result.thinking, "Part 1\n\nPart 2");
  assert.strictEqual(result.answer, "Intermediate text.Conclusion.");
});

test("parseMessageThinking handles structured thinking input", () => {
  const result = parseMessageThinking("Here is the answer.", "Internal chain of thought");
  assert.strictEqual(result.thinking, "Internal chain of thought");
  assert.strictEqual(result.answer, "Here is the answer.");
  assert.strictEqual(result.isThinkingStreaming, false);
});

test("parseMessageThinking handles combined structured thinking and tag thinking", () => {
  const input = "<think>Tag thought</think>Answer";
  const result = parseMessageThinking(input, "Structured thought");
  assert.strictEqual(result.thinking, "Structured thought\n\nTag thought");
  assert.strictEqual(result.answer, "Answer");
});

test("parseMessageThinking detects unclosed think tag during streaming", () => {
  const input = "<think>Still working on step 1...";
  const result = parseMessageThinking(input, undefined, true);
  assert.strictEqual(result.thinking, "Still working on step 1...");
  assert.strictEqual(result.answer, "");
  assert.strictEqual(result.isThinkingStreaming, true);
});

test("parseMessageThinking handles answer after closed think tag during streaming", () => {
  const input = "<think>Step 1 done.</think>Here is the start of the answer...";
  const result = parseMessageThinking(input, undefined, true);
  assert.strictEqual(result.thinking, "Step 1 done.");
  assert.strictEqual(result.answer, "Here is the start of the answer...");
  assert.strictEqual(result.isThinkingStreaming, false);
});
