import test from "node:test";
import assert from "node:assert/strict";
import { injectFileAttachmentPreamble, messageText, normalizeToolUpdate, transcriptFromMessages } from "../dist/session-supervisor-utils.js";

const markdownParts = [
  "## Verification report",
  [
    "### Tests",
    "",
    "- Driver regression: passed",
    "- Electron projection: passed",
  ].join("\n"),
  [
    "```text",
    "user prompt -> worker response",
    "```",
  ].join("\n"),
];
const markdownReport = markdownParts.join("\n\n");

test("messageText preserves Markdown newlines in array-shaped assistant content", () => {
  const message = {
    role: "assistant",
    content: [
      { type: "text", text: markdownParts[0] },
      { type: "thinking", thinking: "Internal reasoning must not create a Markdown block." },
      { type: "text", text: markdownParts[1] },
      { type: "text", text: "" },
      { type: "text", text: markdownParts[2] },
    ],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5.4",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  assert.equal(messageText(message), markdownReport);
});

test("normalizeToolUpdate projects AgentToolResult content, details, and progress", () => {
  const details = { phase: "tessellating", progress: 0.42 };

  assert.deepEqual(
    normalizeToolUpdate({
      content: [
        { type: "text", text: "Building mesh" },
        { type: "image", data: "ignored", mimeType: "image/png" },
        { type: "text", text: "42%" },
      ],
      details,
    }),
    {
      text: "Building mesh\n42%",
      progress: 0.42,
      details,
    },
  );
});

test("normalizeToolUpdate retains legacy scalar updates and details text fallback", () => {
  assert.deepEqual(normalizeToolUpdate("working"), { text: "working" });
  assert.deepEqual(normalizeToolUpdate(0.5), { progress: 0.5 });
  assert.deepEqual(normalizeToolUpdate({ content: [], details: { text: "Preparing", progress: 2 } }), {
    text: "Preparing",
    progress: 2,
    details: { text: "Preparing", progress: 2 },
  });
});

test("browser element attachments round-trip through the hidden prompt preamble", () => {
  const attachment = {
    kind: "browser-element",
    id: "browser-element-1",
    name: "button: Save <draft>",
    tabId: "tab-1",
    capturedAt: "2026-07-23T00:00:00.000Z",
    page: { url: "https://example.com/editor", title: "Editor", revision: 3 },
    frameUrl: "https://example.com/editor",
    element: {
      tag: "button",
      role: "button",
      accessibleName: "Save <draft>",
      text: "Save",
      attributes: { "data-testid": "save" },
      locator: { kind: "test-id", value: "data-testid=\"save\"", unique: true },
      cssFallback: "[data-testid=\"save\"]",
      ancestors: [{ tag: "form", role: "form", name: "Editor" }],
    },
  };
  const prompt = injectFileAttachmentPreamble("Update this element", [attachment]);
  assert.match(prompt, /^<pi-gui-browser-elements>/);
  assert.doesNotMatch(prompt, /Save <draft>/);

  const transcript = transcriptFromMessages([{ role: "user", content: prompt, id: "message-1" }]);
  assert.equal(transcript.length, 1);
  assert.equal(transcript[0]?.kind, "message");
  assert.equal(transcript[0]?.kind === "message" ? transcript[0].text : "", "Update this element");
  assert.deepEqual(transcript[0]?.kind === "message" ? transcript[0].attachments : [], [attachment]);
});
