import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// scripts/computer-use-pi-shim.mjs
import os from "node:os";
import path from "node:path";
function defineTool(tool) {
  return tool;
}
function getAgentDir() {
  const override = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!override) {
    return path.join(os.homedir(), ".pi", "agent");
  }
  if (override === "~") {
    return os.homedir();
  }
  if (override.startsWith("~/") || override.startsWith("~\\")) {
    return path.join(os.homedir(), override.slice(2));
  }
  return override;
}

// ../../node_modules/@injaneity/pi-computer-use/extensions/computer-use.ts
import { Type } from "typebox";

// ../../node_modules/@injaneity/pi-computer-use/src/bridge.ts
import { spawn as spawn4 } from "node:child_process";
import { randomUUID as randomUUID5 } from "node:crypto";
import { constants as fsConstants5 } from "node:fs";
import { access as access4 } from "node:fs/promises";
import net2 from "node:net";
import os7 from "node:os";
import path9 from "node:path";

// ../../node_modules/@injaneity/pi-computer-use/src/platform/coerce.ts
function toBoolean(value) {
  return value === true || value === "true" || value === 1;
}
function toFiniteNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
function toOptionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}

// ../../node_modules/@injaneity/pi-computer-use/src/actions.ts
function mouseButton(value) {
  return value === "right" || value === "middle" ? value : "left";
}
function clickCount(value, fallback = 1) {
  return Math.max(1, Math.min(3, Math.round(toFiniteNumber(value, fallback))));
}
function scrollDelta(value) {
  return Math.max(-1e4, Math.min(1e4, Math.round(toFiniteNumber(value, 0))));
}
function keys(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("keypress.keys must contain at least one key.");
  return value.map((key) => String(key));
}
function path2(value, env) {
  if (!Array.isArray(value) || value.length < 2) throw new Error("drag.path must contain at least two points.");
  return value.map((point2, index) => {
    const x = Array.isArray(point2) ? toFiniteNumber(point2[0], NaN) : toFiniteNumber(point2?.x, NaN);
    const y = Array.isArray(point2) ? toFiniteNumber(point2[1], NaN) : toFiniteNumber(point2?.y, NaN);
    env.validatePoint(x, y, `Drag point ${index + 1}`);
    return { x, y };
  });
}
function nativeTarget(action, operation, env) {
  if (action.ref?.trim()) {
    const node = env.node(action.ref.trim());
    const semanticClick = operation === "click" || operation === "press";
    if (semanticClick && node.isTextInput) {
      const point3 = env.center(node);
      env.validatePoint(point3.x, point3.y);
      return point3;
    }
    const onlyIncidentalActions = node.actions.every((candidate) => candidate === "AXShowMenu" || candidate === "AXScrollToVisible");
    if (node.wireRef && !node.pictureOnly && (!semanticClick || node.canPress || node.canFocus || node.canSetValue || !onlyIncidentalActions)) {
      return { ref: node.wireRef };
    }
    const point2 = env.center(node);
    env.validatePoint(point2.x, point2.y);
    return point2;
  }
  const x = toFiniteNumber(action.x, NaN);
  const y = toFiniteNumber(action.y, NaN);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    env.validatePoint(x, y);
    return { x, y };
  }
  if (operation === "drag" && action.path?.length) return path2(action.path, env)[0];
  throw new Error(`${operation} requires either ref or both x and y.`);
}
function focusedTarget(env) {
  if (!env.image) throw new Error("Focused keyboard input requires an image-bearing state.");
  return { focus: { x: Math.floor(env.image.width / 2), y: Math.floor(env.image.height / 2) } };
}
function containsEditable(node) {
  if (node.canSetValue || node.role.toLowerCase().includes("text")) return true;
  return node.children.some(containsEditable);
}
function prepareAction(action, state, env) {
  const operation = action.action;
  const usesCurrentFocus = !env.headless && state.currentFocus && !action.ref && (operation === "typeText" || operation === "keypress");
  const target = usesCurrentFocus ? focusedTarget(env) : nativeTarget(action, operation, env);
  const establishesFocus = !env.headless && Boolean(action.ref) && (operation === "click" || operation === "press") && containsEditable(env.node(action.ref));
  const needsForeground = !env.headless && (operation === "click" || operation === "press") && "x" in target;
  switch (operation) {
    case "press":
    case "click":
      return { action: operation, target, params: { button: mouseButton(action.button), clickCount: clickCount(action.clickCount) }, establishesFocus, usesCurrentFocus: false, needsForeground };
    case "setText":
      return { action: operation, target, params: { text: action.text ?? "" }, establishesFocus: false, usesCurrentFocus: false, needsForeground: false };
    case "typeText":
      return { action: operation, target, params: { text: action.text ?? "" }, establishesFocus: false, usesCurrentFocus, needsForeground: false };
    case "keypress":
      return { action: operation, target, params: { keys: keys(action.keys) }, establishesFocus: false, usesCurrentFocus, needsForeground: false };
    case "scroll":
      return { action: operation, target, params: { scrollX: scrollDelta(action.scrollX), scrollY: scrollDelta(action.scrollY) }, establishesFocus: false, usesCurrentFocus: false, needsForeground: false };
    case "drag":
      return { action: operation, target, params: { path: path2(action.path, env) }, establishesFocus: false, usesCurrentFocus: false, needsForeground: false };
    case "moveMouse":
      return { action: operation, target, params: {}, establishesFocus: false, usesCurrentFocus: false, needsForeground: false };
  }
}
function canRetryInForeground(action, outcome, headless) {
  return !headless && outcome === "didnt" && (action.action === "typeText" || action.action === "keypress");
}
function outcomeAfterCheck(current, check) {
  if (check === "verified") return "worked";
  if (check === "failed") return "didnt";
  return current;
}
function outcomeAfterObservedValues(current, actions, valueForRef) {
  if (actions.length === 0 || actions.some((action) => action.action !== "setText" || !action.ref)) return current;
  const matches = actions.every((action) => valueForRef(action.ref) === (action.text ?? ""));
  return matches ? "worked" : current;
}

// ../../node_modules/@injaneity/pi-computer-use/src/cdp.ts
import { randomUUID } from "node:crypto";

// ../../node_modules/@injaneity/pi-computer-use/src/outline.ts
var DEFAULT_BUDGET = { maxDepth: 2, maxNodes: 150 };
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function toString(value) {
  return typeof value === "string" ? value : "";
}
function toNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
function toBoolean2(value) {
  return value === true;
}
function parseRect(raw) {
  const rect = isRecord(raw) ? raw : {};
  return {
    x: toNumber(rect.x),
    y: toNumber(rect.y),
    w: Math.max(0, toNumber(rect.w)),
    h: Math.max(0, toNumber(rect.h))
  };
}
function parseText(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (!isRecord(item)) return void 0;
    const string = toString(item.string);
    if (!string) return void 0;
    return {
      string,
      confidence: Math.max(0, Math.min(1, toNumber(item.confidence))),
      rect: parseRect(item.rect)
    };
  }).filter((item) => Boolean(item));
}
function parseNode(raw, parent) {
  const record = isRecord(raw) ? raw : {};
  const wireRef = toString(record.ref) || void 0;
  const node = {
    ref: "",
    wireRef,
    role: toString(record.role),
    subrole: toString(record.subrole),
    identifier: toString(record.identifier),
    title: toString(record.title),
    description: toString(record.description),
    value: toString(record.value),
    actions: Array.isArray(record.actions) ? record.actions.filter((value) => typeof value === "string") : [],
    canPress: toBoolean2(record.canPress),
    canFocus: toBoolean2(record.canFocus),
    canSetValue: toBoolean2(record.canSetValue),
    canScroll: toBoolean2(record.canScroll),
    canIncrement: toBoolean2(record.canIncrement),
    canDecrement: toBoolean2(record.canDecrement),
    isTextInput: toBoolean2(record.isTextInput),
    rect: parseRect(record.rect),
    focused: toBoolean2(record.focused),
    offscreen: toBoolean2(record.offscreen),
    pictureOnly: toBoolean2(record.pictureOnly),
    truncated: toBoolean2(record.truncated),
    scrollExtent: isRecord(record.scrollExtent) ? { seen: Math.max(0, Math.trunc(toNumber(record.scrollExtent.seen))), total: Math.max(0, Math.trunc(toNumber(record.scrollExtent.total))) } : void 0,
    text: parseText(record.text),
    children: [],
    parent
  };
  node.children = (Array.isArray(record.children) ? record.children : []).map((child) => parseNode(child, node));
  return node;
}
function parseLookResponse(raw) {
  const record = isRecord(raw) ? raw : {};
  const image = isRecord(record.image) ? record.image : void 0;
  const window = isRecord(record.window) ? record.window : {};
  const metadata = isRecord(window.metadata) ? window.metadata : void 0;
  const outline = buildOutline(toString(record.lookId), parseNode(record.outline));
  const readText = isRecord(record.readText) ? record.readText : void 0;
  const requestedReadText = readText?.requested === "auto" || readText?.requested === "always" || readText?.requested === "never" ? readText.requested : void 0;
  const look = {
    lookId: toString(record.lookId),
    capturedAt: toNumber(record.capturedAt, Date.now() / 1e3),
    window: {
      windowId: Math.trunc(toNumber(window.windowId)),
      rootRef: toString(window.rootRef) || void 0,
      kind: toString(window.kind) || void 0,
      framePoints: parseRect(window.framePoints),
      scaleFactor: Math.max(1, toNumber(window.scaleFactor, 1)),
      isModal: toBoolean2(window.isModal),
      metadata,
      role: toString(window.role),
      subrole: toString(window.subrole)
    },
    image: image ? {
      jpegBase64: toString(image.jpegBase64),
      mimeType: image.mimeType === "image/png" ? "image/png" : "image/jpeg",
      width: Math.max(1, Math.trunc(toNumber(image.width, 1))),
      height: Math.max(1, Math.trunc(toNumber(image.height, 1)))
    } : void 0,
    outline: outline.root,
    timings: isRecord(record.timings) ? Object.fromEntries(Object.entries(record.timings).map(([key, value]) => [key, toNumber(value)])) : {},
    readText: readText ? { requested: requestedReadText, executed: toBoolean2(readText.executed) } : void 0,
    parsedOutline: outline
  };
  if (!look.lookId) throw new Error("Helper returned a look without lookId.");
  return look;
}
function buildOutline(lookId, root) {
  const nodes = [];
  const refToWireRef = /* @__PURE__ */ new Map();
  const wireRefToRef = /* @__PURE__ */ new Map();
  const queue = [root];
  let index = 0;
  while (index < queue.length) {
    const node = queue[index++];
    node.ref = `@e${nodes.length + 1}`;
    nodes.push(node);
    if (node.wireRef) {
      refToWireRef.set(node.ref, node.wireRef);
      wireRefToRef.set(node.wireRef, node.ref);
    }
    queue.push(...node.children);
  }
  return { lookId, root, nodes, refToWireRef, wireRefToRef };
}
function nodeByRef(outline, ref) {
  return outline.nodes.find((node) => node.ref === ref || node.wireRef === ref);
}
function outlineNodeLabel(node) {
  return node.title || node.description || node.value || node.identifier || node.text.map((item) => item.string).join(" ").trim();
}
function displayName(node) {
  const label2 = outlineNodeLabel(node);
  return `${node.role || "AXUnknown"}${node.subrole ? `/${node.subrole}` : ""}${label2 ? ` ${JSON.stringify(label2)}` : ""}`;
}
function outlineNodePath(node) {
  const parts = [];
  let current = node;
  while (current) {
    parts.unshift(displayName(current));
    current = current.parent;
  }
  return parts.join(" \u25B8 ");
}
function countDescendants(node) {
  const roles = /* @__PURE__ */ new Map();
  let total = 0;
  let pictureOnly = 0;
  const visit = (current) => {
    for (const child of current.children) {
      total += 1;
      if (child.pictureOnly) pictureOnly += 1;
      const role = child.pictureOnly ? "picture-only" : roleName(child.role);
      roles.set(role, (roles.get(role) ?? 0) + 1);
      visit(child);
    }
  };
  visit(node);
  return { total, roles, pictureOnly };
}
function roleName(role) {
  const stripped = role.replace(/^AX/, "").toLowerCase();
  return stripped || "nodes";
}
function plural(count, singular) {
  if (singular === "picture-only") return "picture-only";
  return `${singular}${count === 1 ? "" : "s"}`;
}
function foldedSummary(node) {
  const counts = countDescendants(node);
  const roleCounts = [...counts.roles.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4).map(([role, count]) => `${count} ${plural(count, role)}`);
  const countText = `${counts.total}: ${roleCounts.join(", ") || "0 children"}`;
  const scroll = node.scrollExtent ? ` [scrollable ${node.scrollExtent.seen}/${node.scrollExtent.total}]` : "";
  return ` \u25B8 (${countText})${scroll}`;
}
function annotationText(node) {
  const annotations = [
    node.offscreen ? "offscreen" : void 0,
    node.pictureOnly ? "pictureOnly" : void 0,
    node.truncated ? "truncated" : void 0,
    node.scrollExtent ? `scrollable ${node.scrollExtent.seen}/${node.scrollExtent.total}` : void 0
  ].filter((item) => Boolean(item));
  return annotations.length ? ` [${annotations.join(", ")}]` : "";
}
function lineForNode(node, depth, folded) {
  const actions = node.actions.length ? ` {${node.actions.join(",")}}` : "";
  return `${"  ".repeat(depth)}${node.ref} ${displayName(node)}${actions}${annotationText(node)}${folded ? foldedSummary(node) : ""}`;
}
function pathRefs(node) {
  const refs = [];
  let current = node;
  while (current) {
    refs.unshift(current.ref);
    current = current.parent;
  }
  return refs;
}
function defaultUnfoldRefs(outline) {
  const refs = /* @__PURE__ */ new Set([outline.root.ref]);
  for (const node of outline.nodes) {
    if (node.truncated || node.parent?.role === "AXSheet" || node.role === "AXSheet" || node.role === "AXDialog") {
      for (const ref of pathRefs(node)) refs.add(ref);
    }
    if (node.focused) {
      for (const ref of pathRefs(node)) refs.add(ref);
      for (const child of node.children) refs.add(child.ref);
    }
  }
  return refs;
}
function foldToBudget(outline, budget = {}, unfoldPaths = []) {
  const maxDepth = Math.max(0, Math.trunc(budget.maxDepth ?? DEFAULT_BUDGET.maxDepth));
  const maxNodes = Math.max(1, Math.trunc(budget.maxNodes ?? DEFAULT_BUDGET.maxNodes));
  const unfolded = defaultUnfoldRefs(outline);
  for (const ref of unfoldPaths) {
    const node = nodeByRef(outline, ref);
    if (!node) continue;
    for (const pathRef of pathRefs(node)) unfolded.add(pathRef);
    for (const child of node.children) unfolded.add(child.ref);
  }
  const lines = [];
  const renderedRefs = [];
  let truncated = false;
  const render = (node, depth) => {
    if (lines.length >= maxNodes) {
      truncated = true;
      return;
    }
    const shouldUnfold = depth < maxDepth || unfolded.has(node.ref);
    const folded = node.children.length > 0 && !shouldUnfold;
    lines.push(lineForNode(node, depth, folded));
    renderedRefs.push(node.ref);
    if (folded) return;
    for (const child of node.children) render(child, depth + 1);
  };
  render(outline.root, 0);
  if (truncated) {
    const remaining = Math.max(0, outline.nodes.length - renderedRefs.length);
    lines.push(`\u2026 render budget reached: ${remaining} more nodes not shown; use search_ui or expand_ui(@eN)`);
  }
  return {
    text: lines.join("\n"),
    renderedRefs,
    nodeCount: outline.nodes.length,
    fullUnfoldLineCount: outline.nodes.length,
    truncated
  };
}
function actionMatches(node, action) {
  const query = action.toLowerCase();
  if (query === "press" && node.canPress) return true;
  if (query === "focus" && node.canFocus) return true;
  if ((query === "setvalue" || query === "set_text" || query === "settext") && node.canSetValue) return true;
  if (query === "scroll" && node.canScroll) return true;
  if (query === "increment" && node.canIncrement) return true;
  if (query === "decrement" && node.canDecrement) return true;
  return node.actions.some((candidate) => candidate.toLowerCase().includes(query));
}
function normalizedSearchRole(value) {
  return value.trim().toLowerCase().replace(/^ax/, "").replace(/[ _-]+/g, "");
}
function damerauLevenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_2, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
    }
  }
  return matrix[a.length][b.length];
}
function rankedTextMatch(values, text) {
  const query = text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 256);
  if (!query) return void 0;
  const candidates = values.map((value) => value.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 512)).filter(Boolean);
  if (candidates.some((value) => value === query)) return { reason: "exact", score: 1 };
  if (candidates.some((value) => value.startsWith(query) || value.split(/\W+/).some((token) => token.startsWith(query)))) return { reason: "prefix", score: 0.95 };
  if (candidates.some((value) => value.includes(query))) return { reason: "substring", score: 0.9 };
  let score = 0;
  for (const value of candidates) {
    for (const candidate of [value, ...value.split(/\W+/)]) {
      if (!candidate || candidate.length > 256) continue;
      score = Math.max(score, 1 - damerauLevenshtein(query, candidate) / Math.max(query.length, candidate.length));
    }
  }
  return score >= 0.72 ? { reason: "fuzzy", score } : void 0;
}
function searchOutlineRanked(outline, text, role, capability, limit = 12) {
  const query = text?.trim();
  const roleQuery = role ? normalizedSearchRole(role) : void 0;
  const actionQuery = capability?.trim();
  const strong = [];
  const fuzzy = [];
  for (const [order, node] of outline.nodes.entries()) {
    if (roleQuery && normalizedSearchRole(node.role) !== roleQuery) continue;
    if (actionQuery && !actionMatches(node, actionQuery)) continue;
    const label2 = outlineNodeLabel(node);
    const match = query ? rankedTextMatch([label2, node.identifier, node.title, node.description, node.value, ...node.text.map((item) => item.string)], query) : void 0;
    if (query && !match) continue;
    const result = { ref: node.ref, role: node.role, label: label2, actions: node.actions, path: outlineNodePath(node), matchReason: match?.reason ?? "filter", score: match?.score ?? 1, node, order };
    (match?.reason === "fuzzy" ? fuzzy : strong).push(result);
  }
  const rank = { exact: 0, prefix: 1, substring: 2, filter: 3, fuzzy: 4 };
  const sorted = [...strong.sort((a, b) => rank[a.matchReason] - rank[b.matchReason] || b.score - a.score || a.order - b.order)];
  const useFuzzy = sorted.length < limit;
  if (useFuzzy) sorted.push(...fuzzy.sort((a, b) => b.score - a.score || a.order - b.order));
  return { matches: sorted.slice(0, limit).map(({ order: _order, ...match }) => match), totalMatches: strong.length + (useFuzzy ? fuzzy.length : 0) };
}
function searchOutline(outline, text, role, action, limit = 50) {
  const query = text?.trim().toLowerCase();
  const roleQuery = role?.trim();
  const actionQuery = action?.trim();
  const matches = [];
  for (const node of outline.nodes) {
    const label2 = outlineNodeLabel(node);
    const haystack = [label2, node.role, node.subrole, node.identifier, node.title, node.description, node.value, ...node.text.map((item) => item.string)].join(" ").toLowerCase();
    if (query && !haystack.includes(query)) continue;
    if (roleQuery && node.role !== roleQuery) continue;
    if (actionQuery && !actionMatches(node, actionQuery)) continue;
    matches.push({ ref: node.ref, role: node.role, label: label2, actions: node.actions, path: outlineNodePath(node), node });
    if (matches.length >= limit) break;
  }
  return matches;
}
function serializeOutlineSearchMatch(match) {
  const { node: _node, ...serialized } = match;
  return serialized;
}
function serializeOutline(outline) {
  return { lookId: outline.lookId, root: serializeOutlineNode(outline.root) };
}
function serializeOutlineNode(node) {
  const { parent: _parent, children, ...rest } = node;
  return { ...rest, children: children.map(serializeOutlineNode) };
}
function serializeOutlineNodeShallow(node) {
  const { parent: _parent, children: _children, ...rest } = node;
  return { ...rest, children: [] };
}
function restoreOutline(serialized) {
  const nodes = [];
  const refToWireRef = /* @__PURE__ */ new Map();
  const wireRefToRef = /* @__PURE__ */ new Map();
  const restoreNode = (raw, parent) => {
    const node = { ...raw, children: [], parent };
    nodes.push(node);
    if (node.wireRef) {
      refToWireRef.set(node.ref, node.wireRef);
      wireRefToRef.set(node.wireRef, node.ref);
    }
    node.children = raw.children.map((child) => restoreNode(child, node));
    return node;
  };
  const root = restoreNode(serialized.root);
  return { lookId: serialized.lookId, root, nodes, refToWireRef, wireRefToRef };
}
function outlineRefNumber(ref) {
  const match = /^@e(\d+)$/.exec(ref);
  return match ? Number(match[1]) : 0;
}
function clearScopedRects(node) {
  node.rect = void 0;
  for (const text of node.text) text.rect = void 0;
  for (const child of node.children) clearScopedRects(child);
}
function rebuildIndexes(outline) {
  outline.nodes = [];
  outline.refToWireRef = /* @__PURE__ */ new Map();
  outline.wireRefToRef = /* @__PURE__ */ new Map();
  const queue = [outline.root];
  let index = 0;
  while (index < queue.length) {
    const node = queue[index++];
    outline.nodes.push(node);
    if (node.wireRef) {
      outline.refToWireRef.set(node.ref, node.wireRef);
      outline.wireRefToRef.set(node.wireRef, node.ref);
    }
    queue.push(...node.children);
  }
}
function copyNodeFields(target, source, preserveWireRef = false) {
  if (!preserveWireRef) target.wireRef = source.wireRef;
  target.role = source.role;
  target.subrole = source.subrole;
  target.identifier = source.identifier;
  target.title = source.title;
  target.description = source.description;
  target.value = source.value;
  target.actions = [...source.actions];
  target.canPress = source.canPress;
  target.canFocus = source.canFocus;
  target.canSetValue = source.canSetValue;
  target.canScroll = source.canScroll;
  target.canIncrement = source.canIncrement;
  target.canDecrement = source.canDecrement;
  target.isTextInput = source.isTextInput;
  target.rect = source.rect;
  target.focused = source.focused;
  target.offscreen = source.offscreen;
  target.pictureOnly = source.pictureOnly;
  target.truncated = false;
  target.scrollExtent = source.scrollExtent ? { ...source.scrollExtent } : void 0;
  target.text = source.text.map((text) => ({ ...text, rect: text.rect ? { ...text.rect } : void 0 }));
}
function preserveUnreused(node, parent, used) {
  if (used.has(node)) return void 0;
  node.parent = parent;
  node.children = node.children.map((child) => preserveUnreused(child, node, used)).filter((child) => Boolean(child));
  return node;
}
function cloneForGraft(source, parent, nextRef, reusableByWireRef, used) {
  const existing = source.wireRef ? reusableByWireRef.get(source.wireRef) : void 0;
  if (existing) used.add(existing);
  const oldChildren = existing?.children ?? [];
  const node = existing ?? {
    ...source,
    ref: nextRef(),
    children: [],
    parent,
    text: [],
    actions: [],
    scrollExtent: void 0
  };
  copyNodeFields(node, source, Boolean(existing));
  node.parent = parent;
  const graftedChildren = source.children.map((child) => cloneForGraft(child, node, nextRef, reusableByWireRef, used));
  const preservedChildren = oldChildren.map((child) => preserveUnreused(child, node, used)).filter((child) => Boolean(child));
  node.children = [...graftedChildren, ...preservedChildren];
  return node;
}
function graftScopedOutline(outline, targetRef, scoped) {
  const target = nodeByRef(outline, targetRef);
  if (!target) throw new Error(`Cannot graft scoped outline: target ${targetRef} is not in the current outline.`);
  const targetRect = target.rect ? { ...target.rect } : void 0;
  const reusableByWireRef = /* @__PURE__ */ new Map();
  const collect = (node) => {
    if (node.wireRef) reusableByWireRef.set(node.wireRef, node);
    for (const child of node.children) collect(child);
  };
  collect(target);
  let nextNumber = Math.max(...outline.nodes.map((node) => outlineRefNumber(node.ref)), 0) + 1;
  const nextRef = () => `@e${nextNumber++}`;
  const oldChildren = target.children;
  const used = /* @__PURE__ */ new Set([target]);
  copyNodeFields(target, scoped.root, true);
  target.ref = targetRef;
  target.rect = targetRect;
  const graftedChildren = scoped.root.children.map((child) => cloneForGraft(child, target, nextRef, reusableByWireRef, used));
  const preservedChildren = oldChildren.map((child) => preserveUnreused(child, target, used)).filter((child) => Boolean(child));
  target.children = [...graftedChildren, ...preservedChildren];
  for (const child of target.children) clearScopedRects(child);
  rebuildIndexes(outline);
  return target;
}

// ../../node_modules/@injaneity/pi-computer-use/src/cdp.ts
var COMMAND_TIMEOUT_MS = 5e3;
var CDP_CONTEXT_PREFIX = "browser:";
var NAVIGATE_LOAD_TIMEOUT_MS = 1e4;
var CONNECT_FAILURE_RETRY_MS = 5e3;
var CONSOLE_BUFFER_LIMIT = 20;
var CdpTab = class _CdpTab {
  constructor(ws, targetId, title) {
    this.ws = ws;
    this.targetId = targetId;
    this.title = title;
  }
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  consoleBuffer = [];
  loadFired;
  static async connect(wsUrl, targetId, title) {
    const ws = new WebSocket(wsUrl);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out connecting to CDP target at ${wsUrl}`)), COMMAND_TIMEOUT_MS);
        ws.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error(`Failed to connect to CDP target at ${wsUrl}`));
        };
      });
      const tab = new _CdpTab(ws, targetId, title);
      ws.onmessage = (event) => tab.handleMessage(String(event.data));
      ws.onclose = () => tab.rejectAllPending(new Error("CDP connection closed."));
      ws.onerror = () => tab.rejectAllPending(new Error("CDP connection error."));
      await tab.send("Runtime.enable");
      await tab.send("Page.enable");
      return tab;
    } catch (error) {
      try {
        ws.close();
      } catch {
      }
      throw error;
    }
  }
  get isOpen() {
    return this.ws.readyState === WebSocket.OPEN;
  }
  close() {
    this.loadFired?.();
    this.loadFired = void 0;
    this.rejectAllPending(new Error("CDP connection closed."));
    try {
      this.ws.close();
    } catch {
    }
  }
  /** Evaluates a JS expression in the page and returns its primitive value. */
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, timeout: COMMAND_TIMEOUT_MS, awaitPromise: true });
    return result?.result?.value;
  }
  async accessibilityTree() {
    const result = await this.send("Accessibility.getFullAXTree");
    return Array.isArray(result?.nodes) ? result.nodes : [];
  }
  async navigate(url) {
    const loaded = new Promise((resolve) => {
      this.loadFired = resolve;
    });
    try {
      await this.send("Page.navigate", { url });
      await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, NAVIGATE_LOAD_TIMEOUT_MS))]);
    } finally {
      this.loadFired = void 0;
    }
  }
  async clickBackendNode(backendNodeId) {
    await this.withBackendNode(backendNodeId, "function(){ this.scrollIntoView({block:'center', inline:'center'}); this.click(); }");
  }
  async typeIntoBackendNode(backendNodeId, text, replace) {
    await this.withBackendNode(backendNodeId, "function(text, replace){ this.scrollIntoView({block:'center', inline:'center'}); this.focus(); if (replace) { if ('value' in this) this.value = ''; else this.textContent = ''; } if ('value' in this) this.value += text; else this.textContent = (this.textContent || '') + text; this.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:text})); this.dispatchEvent(new Event('change', {bubbles:true})); }", [text, replace]);
  }
  async scrollBy(deltaX, deltaY, backendNodeId) {
    if (backendNodeId) {
      await this.withBackendNode(backendNodeId, "function(dx, dy){ this.scrollIntoView({block:'center', inline:'center'}); this.scrollBy(dx, dy); }", [deltaX, deltaY]);
      return;
    }
    await this.send("Runtime.evaluate", { expression: `window.scrollBy(${JSON.stringify(deltaX)}, ${JSON.stringify(deltaY)})` });
  }
  async typeIntoFocused(text) {
    await this.send("Input.insertText", { text });
  }
  async keypress(keys2) {
    const modifierBits = { alt: 1, option: 1, control: 2, ctrl: 2, meta: 4, command: 4, cmd: 4, shift: 8 };
    const modifiers = keys2.reduce((bits, key) => bits | (modifierBits[key.toLowerCase()] ?? 0), 0);
    for (const key of keys2.filter((candidate) => modifierBits[candidate.toLowerCase()] === void 0)) {
      await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, text: key.length === 1 && modifiers === 0 ? key : void 0, modifiers });
      await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, modifiers });
    }
  }
  async mouseAt(x, y, type, button = "left", clickCount2 = 1) {
    await this.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : button, clickCount: clickCount2 });
  }
  async dragPath(path10) {
    if (path10.length < 2) throw new Error("CDP drag requires at least two points.");
    await this.mouseAt(path10[0].x, path10[0].y, "mousePressed");
    for (const point2 of path10.slice(1)) await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point2.x, y: point2.y, button: "left", buttons: 1 });
    const end = path10[path10.length - 1];
    await this.mouseAt(end.x, end.y, "mouseReleased");
  }
  async withBackendNode(backendNodeId, functionDeclaration, args = []) {
    const resolved = await this.send("DOM.resolveNode", { backendNodeId });
    const objectId = resolved?.object?.objectId;
    if (typeof objectId !== "string") throw new Error(`CDP could not resolve backend node ${backendNodeId}.`);
    await this.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value }))
    });
  }
  /** Screen bounds of the browser window containing this tab. */
  async windowBounds() {
    const result = await this.send("Browser.getWindowForTarget", { targetId: this.targetId });
    const bounds = result?.bounds;
    if (typeof bounds?.left !== "number" || typeof bounds?.width !== "number") return void 0;
    return { x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height };
  }
  /** Returns buffered console messages/exceptions and clears the buffer. */
  drainConsole() {
    const entries = this.consoleBuffer;
    this.consoleBuffer = [];
    return entries;
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command '${method}' timed out after ${COMMAND_TIMEOUT_MS}ms.`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`CDP error: ${message.error.message ?? "unknown"}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    switch (message.method) {
      case "Page.loadEventFired":
        this.loadFired?.();
        break;
      case "Runtime.consoleAPICalled": {
        const args = Array.isArray(message.params?.args) ? message.params.args : [];
        const text = args.map((arg) => arg?.value !== void 0 ? String(arg.value) : arg?.description ?? "").filter(Boolean).join(" ");
        this.pushConsole({ level: String(message.params?.type ?? "log"), text });
        break;
      }
      case "Runtime.exceptionThrown": {
        const details = message.params?.exceptionDetails;
        const text = details?.exception?.description ?? details?.text ?? "Uncaught exception";
        this.pushConsole({ level: "exception", text: String(text) });
        break;
      }
    }
  }
  pushConsole(entry) {
    if (!entry.text) return;
    this.consoleBuffer.push(entry);
    if (this.consoleBuffer.length > CONSOLE_BUFFER_LIMIT) {
      this.consoleBuffer.shift();
    }
  }
  rejectAllPending(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
};
var connectedTabs = /* @__PURE__ */ new Map();
var connectingTabs = /* @__PURE__ */ new Map();
var lastConnectFailureAt = 0;
function disconnectCdp() {
  for (const tab of connectedTabs.values()) tab.close();
  connectedTabs.clear();
  connectingTabs.clear();
  lastConnectFailureAt = 0;
}
function cdpEnabled() {
  const rawPort = process.env.PI_COMPUTER_USE_CDP_PORT ?? "";
  if (!/^\d+$/.test(rawPort)) return false;
  const port = Number(rawPort);
  return Number.isInteger(port) && port > 0 && port <= 65535 && typeof WebSocket !== "undefined";
}
async function cdpTabForWindow(windowTitle, frame) {
  if (!cdpEnabled()) return void 0;
  if (Date.now() - lastConnectFailureAt < CONNECT_FAILURE_RETRY_MS) return void 0;
  for (const tab of connectedTabs.values()) {
    if (tab.isOpen && titlesMatch(tab.title, windowTitle) && await tabMatchesFrame(tab, frame)) return tab;
  }
  try {
    const pages = await cdpPages();
    const match = await pickTab(pages, windowTitle, frame);
    if (!match) return void 0;
    const existing = connectedTabs.get(match.id);
    if (existing?.isOpen) {
      existing.title = match.title;
      return existing;
    }
    let connecting = connectingTabs.get(match.id);
    if (!connecting) {
      connecting = CdpTab.connect(match.webSocketDebuggerUrl, match.id, match.title);
      connectingTabs.set(match.id, connecting);
    }
    let connected;
    try {
      connected = await connecting;
    } finally {
      connectingTabs.delete(match.id);
    }
    connectedTabs.set(match.id, connected);
    return connected;
  } catch {
    lastConnectFailureAt = Date.now();
    return void 0;
  }
}
async function listCdpPageContexts() {
  const pages = await cdpPages();
  return pages.map((page) => ({
    contextId: cdpContextId(page.id),
    targetId: page.id,
    title: page.title,
    url: page.url ?? ""
  }));
}
async function cdpClickForContext(contextId, backendNodeId) {
  return await withCdpContextTab(contextId, async (tab) => {
    await tab.clickBackendNode(backendNodeId);
    return true;
  }) === true;
}
async function cdpTypeForContext(contextId, backendNodeId, text, replace) {
  return await withCdpContextTab(contextId, async (tab) => {
    await tab.typeIntoBackendNode(backendNodeId, text, replace);
    return true;
  }) === true;
}
async function cdpScrollForContext(contextId, deltaX, deltaY, backendNodeId) {
  return await withCdpContextTab(contextId, async (tab) => {
    await tab.scrollBy(deltaX, deltaY, backendNodeId);
    return true;
  }) === true;
}
async function cdpTypeFocusedForContext(contextId, text) {
  return await withCdpContextTab(contextId, async (tab) => {
    await tab.typeIntoFocused(text);
    return true;
  }) === true;
}
async function cdpKeypressForContext(contextId, keys2) {
  return await withCdpContextTab(contextId, async (tab) => {
    await tab.keypress(keys2);
    return true;
  }) === true;
}
async function cdpMouseForContext(contextId, x, y, type, button = "left", clickCount2 = 1) {
  return await withCdpContextTab(contextId, async (tab) => {
    await tab.mouseAt(x, y, type, button, clickCount2);
    return true;
  }) === true;
}
async function cdpDragForContext(contextId, path10) {
  return await withCdpContextTab(contextId, async (tab) => {
    await tab.dragPath(path10);
    return true;
  }) === true;
}
async function cdpNavigateContext(contextId, url) {
  return await withCdpContextTab(contextId, async (tab) => {
    await tab.navigate(url);
    return true;
  }) === true;
}
async function cdpEvaluateForContext(contextId, expression) {
  const page = await cdpPageForContext(contextId);
  if (!page?.webSocketDebuggerUrl) return void 0;
  const tab = await CdpTab.connect(page.webSocketDebuggerUrl, page.id, page.title);
  try {
    return { contextId, value: await tab.evaluate(expression) };
  } finally {
    tab.close();
  }
}
async function cdpSnapshotForContext(contextId) {
  const page = await cdpPageForContext(contextId);
  if (!page?.webSocketDebuggerUrl) return void 0;
  const tab = await CdpTab.connect(page.webSocketDebuggerUrl, page.id, page.title);
  try {
    const [textValue, nodes] = await Promise.all([
      tab.evaluate("document.body ? document.body.innerText : ''").catch(() => ""),
      tab.accessibilityTree().catch(() => [])
    ]);
    const snapshotId = randomUUID();
    const { targets, outline } = cdpSnapshotOutline(snapshotId, nodes);
    return {
      contextId,
      snapshotId,
      targetId: page.id,
      title: page.title,
      url: page.url ?? "",
      capturedAt: Date.now(),
      text: typeof textValue === "string" ? textValue : String(textValue ?? ""),
      targets,
      outline,
      diagnostics: { cdp: "connected", targetCount: targets.length }
    };
  } finally {
    tab.close();
  }
}
async function withCdpContextTab(contextId, run) {
  const page = await cdpPageForContext(contextId);
  if (!page?.webSocketDebuggerUrl) return void 0;
  const tab = await CdpTab.connect(page.webSocketDebuggerUrl, page.id, page.title);
  try {
    return await run(tab);
  } finally {
    tab.close();
  }
}
async function cdpPageForContext(contextId) {
  if (!contextId.startsWith(CDP_CONTEXT_PREFIX)) return void 0;
  const targetId = contextId.slice(CDP_CONTEXT_PREFIX.length);
  const pages = await cdpPages();
  return pages.find((candidate) => candidate.id === targetId);
}
async function cdpPages() {
  if (!cdpEnabled()) return [];
  const port = process.env.PI_COMPUTER_USE_CDP_PORT;
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2e3) });
  const targets = await response.json();
  return targets.filter(
    (target) => target.type === "page" && target.webSocketDebuggerUrl && isLocalDebuggerWebSocket(target.webSocketDebuggerUrl, port)
  );
}
function cdpContextId(targetId) {
  return `${CDP_CONTEXT_PREFIX}${targetId}`;
}
function axString(raw) {
  const value = raw?.value ?? raw;
  return typeof value === "string" ? value.trim() : "";
}
function cdpSnapshotOutline(snapshotId, nodes) {
  const records = /* @__PURE__ */ new Map();
  for (const raw of nodes) {
    const nodeId = String(raw?.nodeId ?? "");
    if (nodeId) records.set(nodeId, raw);
  }
  const targets = [];
  const build = (raw, seen) => {
    const nodeId = String(raw?.nodeId ?? randomUUID());
    if (seen.has(nodeId)) return void 0;
    seen.add(nodeId);
    const role = axString(raw?.role);
    const name = axString(raw?.name);
    const actions = browserActionsForAxRole(role);
    const backendNodeId = Number.isFinite(raw?.backendDOMNodeId) ? Math.trunc(raw.backendDOMNodeId) : void 0;
    const wireRef = `cdp:${nodeId}`;
    if (actions.length > 0 && name && (!actions.includes("click") || backendNodeId)) {
      targets.push({ ref: wireRef, source: "browser_ax", role, name, value: axString(raw?.value) || void 0, actions, backendNodeId });
    }
    const childIds = Array.isArray(raw?.childIds) ? raw.childIds.map(String) : [];
    return {
      ref: wireRef,
      role,
      subrole: "",
      identifier: "",
      title: name,
      description: axString(raw?.description),
      value: axString(raw?.value),
      actions,
      canPress: actions.includes("click"),
      canFocus: actions.length > 0,
      canSetValue: actions.includes("set_text"),
      canScroll: false,
      canIncrement: false,
      canDecrement: false,
      isTextInput: actions.includes("set_text"),
      rect: { x: 0, y: 0, w: 0, h: 0 },
      children: childIds.map((id) => records.get(id)).filter(Boolean).map((child) => build(child, seen)).filter(Boolean)
    };
  };
  const roots = nodes.filter((raw) => !raw?.parentId || !records.has(String(raw.parentId)));
  const children = roots.map((root) => build(root, /* @__PURE__ */ new Set())).filter(Boolean);
  const rawOutline = children.length === 1 ? children[0] : {
    ref: `cdp:root:${snapshotId}`,
    role: "document",
    subrole: "",
    identifier: "",
    title: "Browser page",
    description: "",
    value: "",
    actions: [],
    canPress: false,
    canFocus: false,
    canSetValue: false,
    canScroll: false,
    canIncrement: false,
    canDecrement: false,
    isTextInput: false,
    rect: { x: 0, y: 0, w: 0, h: 0 },
    children
  };
  const parsed = parseLookResponse({
    lookId: snapshotId,
    capturedAt: Date.now() / 1e3,
    window: { windowId: 0, framePoints: { x: 0, y: 0, w: 1, h: 1 }, scaleFactor: 1, isModal: false, role: "document", subrole: "" },
    outline: rawOutline,
    timings: {}
  }).parsedOutline;
  const modelRefByWire = parsed.wireRefToRef;
  for (const target of targets) target.ref = modelRefByWire.get(target.ref) ?? target.ref;
  return { targets, outline: serializeOutline(parsed) };
}
function browserActionsForAxRole(role) {
  const normalized = role.toLowerCase();
  if (["button", "link", "checkbox", "radio", "menuitem", "tab"].includes(normalized)) return ["click"];
  if (["textbox", "searchbox", "combobox"].includes(normalized)) return ["click", "set_text"];
  if (["listbox", "slider", "spinbutton"].includes(normalized)) return ["click"];
  return [];
}
function isLocalDebuggerWebSocket(wsUrl, expectedPort) {
  try {
    const parsed = new URL(wsUrl);
    const localHosts = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "[::1]"]);
    return (parsed.protocol === "ws:" || parsed.protocol === "wss:") && localHosts.has(parsed.hostname) && parsed.port === expectedPort;
  } catch {
    return false;
  }
}
async function pickTab(pages, windowTitle, frame) {
  const matches = pages.filter((target) => titlesMatch(target.title, windowTitle));
  if (matches.length === 0) return pages.length === 1 ? pages[0] : void 0;
  if (matches.length === 1) return matches[0];
  const wanted = windowTitle.trim().toLowerCase();
  const exact = matches.filter((target) => target.title.trim().toLowerCase() === wanted);
  const pool = exact.length > 0 ? exact : matches;
  if (pool.length === 1) return pool[0];
  let visibleFallback;
  for (const candidate of pool) {
    try {
      const tab = await CdpTab.connect(candidate.webSocketDebuggerUrl, candidate.id, candidate.title);
      const inFrame = await tabMatchesFrame(tab, frame, false);
      const visibility = await tab.evaluate("document.visibilityState").catch(() => void 0);
      tab.close();
      if (frame && inFrame && visibility === "visible") return candidate;
      if (frame && inFrame && !visibleFallback) visibleFallback = candidate;
      if (!frame && visibility === "visible") return candidate;
    } catch {
    }
  }
  return visibleFallback ?? pool[0];
}
async function tabMatchesFrame(tab, frame, trustOnUnknown = true) {
  if (!frame) return true;
  const bounds = await tab.windowBounds().catch(() => void 0);
  if (!bounds) return trustOnUnknown;
  const tolerance = 50;
  return Math.abs(bounds.x + bounds.w / 2 - (frame.x + frame.w / 2)) <= tolerance && Math.abs(bounds.y + bounds.h / 2 - (frame.y + frame.h / 2)) <= tolerance;
}
function titlesMatch(tabTitle, windowTitle) {
  const tab = tabTitle.trim().toLowerCase();
  const win = windowTitle.trim().toLowerCase();
  if (!tab || !win) return false;
  return tab === win || win.startsWith(tab) || tab.startsWith(win);
}

// ../../node_modules/@injaneity/pi-computer-use/src/config.ts
import { existsSync, readFileSync } from "node:fs";
import path3 from "node:path";
var DEFAULT_CONFIG = {
  browser_use: true,
  headless: false,
  cursor_overlay: true,
  managed_browser: "chrome"
};
var activeConfig = { ...DEFAULT_CONFIG };
var activeLoadedConfig = { config: activeConfig, sources: [], env: {} };
function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : void 0;
  if (typeof value !== "string") return void 0;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return void 0;
}
function normalizePartial(raw) {
  if (!raw || typeof raw !== "object") return {};
  const source = raw.computer_use && typeof raw.computer_use === "object" ? raw.computer_use : raw;
  const out = {};
  const browserUse = parseBoolean(source.browser_use);
  const headless = parseBoolean(source.headless);
  const cursorOverlay = parseBoolean(source.cursor_overlay);
  if (browserUse !== void 0) out.browser_use = browserUse;
  if (headless !== void 0) out.headless = headless;
  if (cursorOverlay !== void 0) out.cursor_overlay = cursorOverlay;
  const managedBrowser = source.managed_browser;
  if (managedBrowser === "helium" || managedBrowser === "chrome") out.managed_browser = managedBrowser;
  return out;
}
function readConfigFile(filePath) {
  if (!existsSync(filePath)) return { path: filePath, exists: false };
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    return { path: filePath, exists: true, values: normalizePartial(parsed) };
  } catch (error) {
    return { path: filePath, exists: true, error: error instanceof Error ? error.message : String(error) };
  }
}
function readEnv() {
  const out = {};
  const browserUse = parseBoolean(process.env.PI_COMPUTER_USE_BROWSER_USE);
  const headless = parseBoolean(process.env.PI_COMPUTER_USE_HEADLESS);
  const cursorOverlay = parseBoolean(process.env.PI_COMPUTER_USE_CURSOR_OVERLAY);
  if (browserUse !== void 0) out.browser_use = browserUse;
  if (headless !== void 0) out.headless = headless;
  if (cursorOverlay !== void 0) out.cursor_overlay = cursorOverlay;
  const managedBrowser = process.env.PI_COMPUTER_USE_MANAGED_BROWSER;
  if (managedBrowser === "helium" || managedBrowser === "chrome") out.managed_browser = managedBrowser;
  return out;
}
function loadComputerUseConfig(cwd) {
  const sources = [
    readConfigFile(path3.join(getAgentDir(), "extensions", "pi-computer-use.json")),
    readConfigFile(path3.join(cwd, ".pi", "computer-use.json"))
  ];
  const env = readEnv();
  const config = { ...DEFAULT_CONFIG };
  for (const source of sources) {
    if (source.values) Object.assign(config, source.values);
  }
  Object.assign(config, env);
  activeConfig = config;
  activeLoadedConfig = { config, sources, env };
  return activeLoadedConfig;
}
function getComputerUseConfig() {
  return activeConfig;
}
function getLoadedComputerUseConfig() {
  return activeLoadedConfig;
}
function isHeadlessMode() {
  return activeConfig.headless;
}
function isBrowserUseEnabled() {
  return activeConfig.browser_use;
}

// ../../node_modules/@injaneity/pi-computer-use/src/note.ts
function normalizedLabel(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
function nodeLabel(node) {
  return outlineNodeLabel(node) || node.role || node.ref;
}
function regionKey(node) {
  return `${node.role || "AXUnknown"}:${node.identifier || normalizedLabel(nodeLabel(node)) || node.ref}`;
}
function regionLabel(node) {
  const label2 = nodeLabel(node);
  return normalizedLabel(label2) || normalizedLabel(node.role) || node.ref;
}
function topLevelRegions(outline) {
  const nodes = outline.root.children.length ? outline.root.children : [outline.root];
  return nodes.map((node) => ({ node, key: regionKey(node), label: regionLabel(node) }));
}
function topLevelAncestor(node, outline) {
  let current = node;
  while (current.parent && current.parent !== outline.root) current = current.parent;
  return current;
}
function uniqueRegions(regions) {
  const seen = /* @__PURE__ */ new Set();
  const output = [];
  for (const region of regions) {
    const dedupeKey = `${region.key}:${region.status}:${region.detail ?? ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    output.push(region);
  }
  return output;
}
function frontierRegions(outline, topLevels) {
  const output = [];
  for (const node of outline.nodes) {
    if (node.scrollExtent && node.scrollExtent.seen < node.scrollExtent.total) {
      const ancestor = topLevelAncestor(node, outline);
      const top = topLevels.find((candidate) => candidate.node === ancestor);
      output.push({
        key: `${top?.key ?? regionKey(ancestor)}:scroll:${node.ref}`,
        label: top?.label ?? regionLabel(ancestor),
        status: "never-looked",
        detail: `${node.scrollExtent.total} rows, ${node.scrollExtent.seen} seen`
      });
    }
    if (node.truncated) {
      const ancestor = topLevelAncestor(node, outline);
      const top = topLevels.find((candidate) => candidate.node === ancestor);
      output.push({
        key: `${top?.key ?? regionKey(ancestor)}:truncated:${node.ref}`,
        label: top?.label ?? regionLabel(ancestor),
        status: "never-looked",
        detail: "subtree not walked"
      });
    }
  }
  return output;
}
function noteFromLook(prev, outline, window) {
  const topLevels = topLevelRegions(outline);
  const currentKeys = new Set(topLevels.map((region) => region.key));
  const regions = topLevels.map((region) => ({
    key: region.key,
    label: region.label,
    status: "seen"
  }));
  if (prev) {
    for (const old of prev.regions) {
      if (old.status === "never-looked") continue;
      if (!currentKeys.has(old.key)) {
        regions.push({ ...old, status: "changed", detail: "not matched in latest look" });
      }
    }
  }
  if (!window.windowRef || window.pairingScore === Number.NEGATIVE_INFINITY) {
    regions.push({
      key: "window:unpaired",
      label: "window capture",
      status: "never-looked",
      detail: "AX window without capture pairing"
    });
  }
  regions.push(...frontierRegions(outline, topLevels));
  return {
    windowRef: window.windowRef ?? "(unpaired)",
    title: window.title,
    pairing: window.pairing ?? "low",
    lastLookId: outline.lookId,
    regions: uniqueRegions(regions)
  };
}
function noteAfterAct(prev, targetRef, outline, refreshOutcome) {
  const note = noteFromLook(prev, outline, refreshOutcome.window);
  if (targetRef) {
    const target = nodeByRef(outline, targetRef);
    if (target) {
      const ancestor = topLevelAncestor(target, outline);
      const key = regionKey(ancestor);
      const region = note.regions.find((candidate) => candidate.key === key);
      if (region) {
        region.status = "changed";
        region.detail = "acted here";
      } else {
        note.regions.unshift({ key, label: regionLabel(ancestor), status: "changed", detail: "acted here" });
      }
    }
  }
  for (const delta of refreshOutcome.rootDelta ?? []) {
    note.regions.unshift({
      key: `root:${delta.change}:${delta.ref ?? delta.kind}:${delta.title ?? ""}`,
      label: `${delta.kind}${delta.title ? ` ${delta.title}` : ""}`,
      status: delta.change === "closed" ? "changed" : "never-looked",
      detail: `root ${delta.change}`
    });
  }
  if (refreshOutcome.windowChanged) {
    for (const region of note.regions) {
      if (region.status === "seen") region.status = "changed";
    }
    note.regions.push({
      key: `window:changed:${note.lastLookId ?? "unknown"}`,
      label: refreshOutcome.newWindowLabel ?? "new sheet/window",
      status: "never-looked",
      detail: "appeared after act"
    });
  }
  return { ...note, regions: uniqueRegions(note.regions) };
}
function noteRegionKeyForRef(outline, ref) {
  const node = nodeByRef(outline, ref);
  return node ? regionKey(topLevelAncestor(node, outline)) : void 0;
}
function renderNote(note) {
  if (!note) return "";
  const looked = note.lastLookId ? "looked just now" : "not looked";
  const lines = [`note ${note.windowRef} ${JSON.stringify(note.title.slice(0, 512))} (pairing ${note.pairing}, ${looked})`];
  const visible = note.regions.slice(0, 64);
  for (const region of visible) {
    const detail = region.detail ? `   (${region.detail.slice(0, 256)})` : "";
    lines.push(`  ${region.label.slice(0, 512).padEnd(14, " ")} ${region.status}${detail}`);
  }
  if (note.regions.length > visible.length) lines.push(`  \u2026 ${note.regions.length - visible.length} more note regions; use search_ui or expand_ui`);
  const encoded = new TextEncoder().encode(lines.join("\n"));
  if (encoded.byteLength <= 8 * 1024) return new TextDecoder().decode(encoded);
  let end = 8 * 1024;
  while (end > 0 && (encoded[end] & 192) === 128) end -= 1;
  return `${new TextDecoder().decode(encoded.subarray(0, end))}
\u2026 note byte budget reached`;
}

// ../../node_modules/@injaneity/pi-computer-use/src/output.ts
import { closeSync, mkdtempSync, openSync, readSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os2 from "node:os";
import path4 from "node:path";
var MODEL_TEXT_MAX_BYTES = 48 * 1024;
var MODEL_TEXT_MAX_LINES = 2e3;
var OUTPUT_PAGE_BYTES = 16 * 1024;
var UI_TEXT_PAGE_CHARS = 12 * 1024;
var MODEL_PREVIEW_BYTES = 16 * 1024;
var OUTPUT_ENTRY_MAX_BYTES = 16 * 1024 * 1024;
var OUTPUT_STORE_MAX_BYTES = 64 * 1024 * 1024;
var outputs = /* @__PURE__ */ new Map();
var outputDirectory;
var outputBytes = 0;
var nextOutputId = 1;
function utf8Prefix(bytes, maxBytes) {
  if (bytes.byteLength <= maxBytes) return bytes;
  let end = Math.max(0, maxBytes);
  while (end > 0 && (bytes[end] & 192) === 128) end -= 1;
  return bytes.subarray(0, end);
}
function boundedPrefix(value, maxBytes, maxLines) {
  const lines = value.split("\n", maxLines + 1);
  const lineBounded = lines.length > maxLines ? lines.slice(0, maxLines).join("\n") : value;
  return new TextDecoder().decode(utf8Prefix(new TextEncoder().encode(lineBounded), maxBytes));
}
function storeOutput(value) {
  const encoded = new TextEncoder().encode(value);
  const stored = encoded.byteLength > OUTPUT_ENTRY_MAX_BYTES ? utf8Prefix(encoded, OUTPUT_ENTRY_MAX_BYTES) : encoded;
  outputDirectory ??= mkdtempSync(path4.join(os2.tmpdir(), "pi-computer-use-output-"));
  const ref = `@o${nextOutputId++}`;
  const filePath = path4.join(outputDirectory, `${ref.slice(2)}.txt`);
  writeFileSync(filePath, stored, { mode: 384 });
  const entry = { ref, filePath, storedBytes: stored.byteLength, totalBytes: encoded.byteLength, complete: stored.byteLength === encoded.byteLength };
  outputs.set(entry.ref, entry);
  outputBytes += entry.storedBytes;
  while (outputBytes > OUTPUT_STORE_MAX_BYTES && outputs.size > 1) {
    const oldestRef = outputs.keys().next().value;
    if (!oldestRef) break;
    const oldest = outputs.get(oldestRef);
    outputs.delete(oldestRef);
    outputBytes -= oldest.storedBytes;
    try {
      unlinkSync(oldest.filePath);
    } catch {
    }
  }
  return entry;
}
function refinementFor(tool) {
  if (tool === "search_ui") return "use a more selective text, role, or capability predicate";
  if (tool === "find_roots") return "use a more selective text, app, bundleId, pid, or kind filter";
  if (tool === "evaluate_browser") return "return selected fields, an aggregate, or a smaller slice";
  if (tool === "observe_ui" || tool === "expand_ui") return "use search_ui or expand a more specific ref";
  return "request a smaller or more focused result";
}
function applyOutputEnvelope(tool, result) {
  const textParts = result.content.filter((part) => part.type === "text");
  const combined = textParts.map((part) => part.text).join("\n");
  const bytes = new TextEncoder().encode(combined).byteLength;
  const lines = combined === "" ? 0 : combined.split("\n").length;
  if (bytes <= MODEL_TEXT_MAX_BYTES && lines <= MODEL_TEXT_MAX_LINES) return result;
  const entry = storeOutput(combined);
  const preview = boundedPrefix(combined, MODEL_PREVIEW_BYTES, MODEL_TEXT_MAX_LINES - 4);
  const returnedBytes = new TextEncoder().encode(preview).byteLength;
  const availability = entry.complete ? `continue: read_text({ ref: "${entry.ref}", offset: ${returnedBytes} })` : `continue: read_text({ ref: "${entry.ref}", offset: ${returnedBytes} }); only the first ${entry.storedBytes} bytes were stored, so refine for the remainder`;
  const trailer = [
    `output truncated: returned ${returnedBytes} of ${entry.totalBytes} utf-8 bytes`,
    `refine: ${refinementFor(tool)}`,
    availability
  ].join("\n");
  const images = result.content.filter((part) => part.type === "image");
  return { ...result, content: [{ type: "text", text: `${preview}

${trailer}` }, ...images] };
}
function boundToolError(tool, error) {
  const message = error instanceof Error ? error.message : String(error);
  const bytes = new TextEncoder().encode(message).byteLength;
  const lines = message.split("\n").length;
  if (bytes <= MODEL_TEXT_MAX_BYTES && lines <= MODEL_TEXT_MAX_LINES) return error instanceof Error ? error : new Error(message);
  const entry = storeOutput(message);
  const preview = boundedPrefix(message, MODEL_PREVIEW_BYTES, MODEL_TEXT_MAX_LINES - 4);
  const returnedBytes = new TextEncoder().encode(preview).byteLength;
  const storageNote = entry.complete ? "" : `; only the first ${entry.storedBytes} bytes were stored`;
  return new Error(`${preview}

error truncated: returned ${returnedBytes} of ${entry.totalBytes} utf-8 bytes
refine: ${refinementFor(tool)}
continue: read_text({ ref: "${entry.ref}", offset: ${returnedBytes} })${storageNote}`);
}
function readStoredOutput(ref, offsetValue) {
  const entry = outputs.get(ref);
  if (!entry) return void 0;
  let offset = Math.min(entry.storedBytes, Math.max(0, Math.trunc(typeof offsetValue === "number" && Number.isFinite(offsetValue) ? offsetValue : 0)));
  const requestedBytes = Math.min(entry.storedBytes - offset, OUTPUT_PAGE_BYTES + 4);
  const buffer = new Uint8Array(Math.max(0, requestedBytes));
  const fd = openSync(entry.filePath, "r");
  try {
    if (buffer.byteLength > 0) readSync(fd, buffer, 0, buffer.byteLength, offset);
  } finally {
    closeSync(fd);
  }
  let start = 0;
  while (start < buffer.byteLength && (buffer[start] & 192) === 128) start += 1;
  offset += start;
  const slice = utf8Prefix(buffer.subarray(start), OUTPUT_PAGE_BYTES);
  const actualEnd = offset + slice.byteLength;
  return {
    text: new TextDecoder().decode(slice),
    offset,
    limit: slice.byteLength,
    totalBytes: entry.totalBytes,
    hasMore: actualEnd < entry.storedBytes,
    complete: entry.complete
  };
}
function clearStoredOutputs() {
  outputs.clear();
  if (outputDirectory) {
    try {
      rmSync(outputDirectory, { recursive: true, force: true });
    } catch {
    }
  }
  outputDirectory = void 0;
  outputBytes = 0;
  nextOutputId = 1;
}

// ../../node_modules/@injaneity/pi-computer-use/src/contract.ts
var AGENT_TOOL_NAMES = /* @__PURE__ */ new Set([
  "find_roots",
  "read_text",
  "wait_for",
  "observe_ui",
  "search_ui",
  "expand_ui",
  "inspect_ui",
  "act_ui",
  "navigate_browser",
  "evaluate_browser",
  "launch_browser"
]);

// ../../node_modules/@injaneity/pi-computer-use/src/platform/macos/helper.ts
import { spawn } from "node:child_process";
import { constants as fsConstants2 } from "node:fs";
import { access, mkdir, realpath } from "node:fs/promises";
import net from "node:net";
import os4 from "node:os";
import path6 from "node:path";

// ../../node_modules/@injaneity/pi-computer-use/src/platform/macos/helper-path.mjs
import { accessSync, constants as fsConstants, existsSync as existsSync2 } from "node:fs";
import os3 from "node:os";
import path5 from "node:path";
var HELPER_APP_NAME = "pi-computer-use.app";
var SYSTEM_HELPER_APP_PATH = path5.join("/Applications", HELPER_APP_NAME);
function resolveMacosHelperAppPath(options = {}) {
  const env = options.env ?? process.env;
  const explicitPath = env.PI_COMPUTER_USE_HELPER_APP_PATH?.trim();
  if (explicitPath) return path5.resolve(explicitPath);
  const homeDir = options.homeDir ?? os3.homedir();
  const systemHelperAppPath = options.systemHelperAppPath ?? SYSTEM_HELPER_APP_PATH;
  const fileExists = options.fileExists ?? existsSync2;
  const directoryIsWritable = options.directoryIsWritable ?? ((directoryPath) => {
    try {
      accessSync(directoryPath, fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (fileExists(systemHelperAppPath) && directoryIsWritable(path5.dirname(systemHelperAppPath))) {
    return systemHelperAppPath;
  }
  return path5.join(homeDir, "Applications", HELPER_APP_NAME);
}

// ../../node_modules/@injaneity/pi-computer-use/src/platform/macos/helper.ts
var COMMAND_TIMEOUT_MS2 = 15e3;
var HELPER_PROTOCOL_VERSION = 6;
var HELPER_SETUP_TIMEOUT_MS = 6e4;
var HELPER_APP_PATH = resolveMacosHelperAppPath();
var HELPER_APP_EXECUTABLE_PATH = path6.join(HELPER_APP_PATH, "Contents", "MacOS", "bridge");
var DEFAULT_HELPER_SOCKET_PATH = path6.join(os4.homedir(), "Library", "Caches", "pi-computer-use", "bridge.sock");
var HELPER_SOCKET_PATH = process.env.PI_CU_SOCKET_PATH ?? DEFAULT_HELPER_SOCKET_PATH;
var usingExternalHelperSocket = HELPER_SOCKET_PATH !== DEFAULT_HELPER_SOCKET_PATH;
var PACKAGE_ROOT = path6.dirname(require.resolve("@injaneity/pi-computer-use/package.json"));
var SETUP_HELPER_SCRIPT = path6.join(PACKAGE_ROOT, "scripts", "setup-helper.mjs");
var HelperTransportError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "HelperTransportError";
  }
};
var HelperCommandError = class extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.name = "HelperCommandError";
    this.code = code;
  }
};
function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error("Operation aborted.");
}
async function sleep(ms, signal) {
  throwIfAborted(signal);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Operation aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  }).finally(() => signal?.throwIfAborted?.());
}
async function isExecutable(filePath) {
  try {
    await access(filePath, fsConstants2.X_OK);
    return true;
  } catch {
    return false;
  }
}
async function isResolvedHelperExecutable(filePath) {
  if (!filePath) return true;
  const [actualPath, expectedPath] = await Promise.all([
    realpath(filePath).catch(() => path6.resolve(filePath)),
    realpath(HELPER_APP_EXECUTABLE_PATH).catch(() => path6.resolve(HELPER_APP_EXECUTABLE_PATH))
  ]);
  return actualPath === expectedPath;
}
async function runProcess(command, args, timeoutMs, signal, env) {
  throwIfAborted(signal);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env
    });
    let stderr = "";
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      cleanup();
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`));
    }, timeoutMs);
    const onAbort = () => {
      child.kill("SIGTERM");
      cleanup();
      reject(new Error("Operation aborted."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      if (code === 0) {
        resolve();
        return;
      }
      const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
      reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}
${output}`.trim()));
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
var MacosHelperClient = class {
  daemonAvailable = false;
  requestSequence = 0;
  diagnosticsCache;
  get diagnostics() {
    return this.diagnosticsCache;
  }
  async ensureInstalled(signal) {
    if (usingExternalHelperSocket) return;
    if (await isExecutable(HELPER_APP_EXECUTABLE_PATH)) {
      return;
    }
    await runProcess(process.execPath, [SETUP_HELPER_SCRIPT, "--runtime"], HELPER_SETUP_TIMEOUT_MS, signal, {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      BUN_BE_BUN: "1"
    });
    if (!await isExecutable(HELPER_APP_EXECUTABLE_PATH)) {
      throw new Error(`Failed to install pi-computer-use helper app at ${HELPER_APP_PATH}.`);
    }
  }
  async launchDaemon(signal) {
    if (usingExternalHelperSocket) throw new HelperTransportError(`External helper socket is unavailable at ${HELPER_SOCKET_PATH}.`);
    await mkdir(path6.dirname(HELPER_SOCKET_PATH), { recursive: true });
    await runProcess("open", ["-n", "-g", HELPER_APP_PATH, "--args", "serve", "--socket", HELPER_SOCKET_PATH], COMMAND_TIMEOUT_MS2, signal);
  }
  async daemonCommand(cmd, args, timeoutMs, signal) {
    return await new Promise((resolve, reject) => {
      const id = `req_${++this.requestSequence}`;
      const socket = net.createConnection(HELPER_SOCKET_PATH);
      let buffer = "";
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new HelperTransportError(`Daemon command '${cmd}' timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        socket.destroy();
        cleanup();
        reject(new Error("Operation aborted."));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      socket.setEncoding("utf8");
      socket.on("connect", () => socket.write(`${JSON.stringify({ id, cmd, ...args })}
`));
      socket.on("data", (chunk) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        cleanup();
        socket.end();
        try {
          const parsed = JSON.parse(buffer.slice(0, newline));
          if (parsed.ok === true) resolve(parsed.result);
          else reject(new HelperCommandError(parsed?.error?.message ?? `Daemon command '${cmd}' failed.`, parsed?.error?.code));
        } catch (error) {
          reject(error);
        }
      });
      socket.on("error", (error) => {
        cleanup();
        reject(new HelperTransportError(error.message));
      });
    });
  }
  async ensureDaemon(signal) {
    if (this.daemonAvailable) return true;
    try {
      await this.daemonCommand("diagnostics", {}, 1e3, signal);
      this.daemonAvailable = true;
      return true;
    } catch {
    }
    await this.launchDaemon(signal).catch(() => void 0);
    for (let index = 0; index < 30; index += 1) {
      try {
        await this.daemonCommand("diagnostics", {}, 1e3, signal);
        this.daemonAvailable = true;
        return true;
      } catch {
        await sleep(100, signal);
      }
    }
    return false;
  }
  async command(cmd, args = {}, options) {
    const timeoutMs = options?.timeoutMs ?? COMMAND_TIMEOUT_MS2;
    if (!await this.ensureDaemon(options?.signal)) {
      throw new HelperTransportError(`pi-computer-use helper app daemon is unavailable at ${HELPER_APP_PATH}.`);
    }
    try {
      return await this.daemonCommand(cmd, args, timeoutMs, options?.signal);
    } catch (error) {
      this.daemonAvailable = false;
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
  async restart(signal) {
    await this.command("shutdown", {}, { signal, timeoutMs: 2e3 }).catch(() => void 0);
    this.daemonAvailable = false;
    await sleep(400, signal);
    if (!await this.ensureDaemon(signal)) {
      throw new Error(`pi-computer-use helper did not come back after restart. Helper app: ${HELPER_APP_PATH}`);
    }
  }
  async diagnosticsCommand(signal) {
    const result = await this.command("diagnostics", {}, { signal });
    const diagnostics = {
      protocolVersion: Math.trunc(toFiniteNumber(result?.protocolVersion, 0)),
      architectureVersion: Math.trunc(toFiniteNumber(result?.architectureVersion, 0)),
      invariants: Array.isArray(result?.invariants) ? result.invariants.filter((value) => typeof value === "string") : [],
      pid: Math.trunc(toFiniteNumber(result?.pid, 0)),
      parentPid: Math.trunc(toFiniteNumber(result?.parentPid, 0)) || void 0,
      parentAppName: toOptionalString(result?.parentAppName),
      parentBundleId: toOptionalString(result?.parentBundleId),
      parentPath: toOptionalString(result?.parentPath),
      executablePath: toOptionalString(result?.executablePath),
      os: toOptionalString(result?.macOS),
      arch: toOptionalString(result?.arch),
      accessibility: toBoolean(result?.accessibility),
      screenRecording: toBoolean(result?.screenRecording)
    };
    this.diagnosticsCache = diagnostics;
    return diagnostics;
  }
  async ensureProtocol(signal) {
    let diagnostics = await this.diagnosticsCommand(signal);
    const executableMatches = await isResolvedHelperExecutable(diagnostics.executablePath);
    if (diagnostics.protocolVersion === HELPER_PROTOCOL_VERSION && executableMatches) return diagnostics;
    await this.restart(signal);
    diagnostics = await this.diagnosticsCommand(signal);
    const relaunchedExecutableMatches = await isResolvedHelperExecutable(diagnostics.executablePath);
    if (diagnostics.protocolVersion !== HELPER_PROTOCOL_VERSION || !relaunchedExecutableMatches) {
      this.daemonAvailable = false;
      throw new Error(
        `pi-computer-use helper mismatch after relaunch: expected protocol ${HELPER_PROTOCOL_VERSION} and executable ${HELPER_APP_EXECUTABLE_PATH}; got protocol ${diagnostics.protocolVersion} and executable ${diagnostics.executablePath ?? "unknown"}. Reinstall or rebuild the helper app at ${HELPER_APP_PATH}.`
      );
    }
    return diagnostics;
  }
};
var macosHelper = new MacosHelperClient();

// ../../node_modules/@injaneity/pi-computer-use/src/platform/macos/backend.ts
function parseApps(result) {
  const array = Array.isArray(result) ? result : result?.apps;
  if (!Array.isArray(array)) return [];
  return array.map((raw) => {
    const pid = Math.trunc(toFiniteNumber(raw?.pid, NaN));
    if (!Number.isFinite(pid) || pid <= 0) return void 0;
    const appName = toOptionalString(raw?.appName) ?? "Unknown App";
    return {
      appName,
      bundleId: toOptionalString(raw?.bundleId),
      pid,
      isFrontmost: toBoolean(raw?.isFrontmost)
    };
  }).filter((item) => Boolean(item));
}
function parseFramePoints(raw) {
  const frame = raw?.framePoints ?? {};
  return {
    x: toFiniteNumber(frame.x, 0),
    y: toFiniteNumber(frame.y, 0),
    w: Math.max(1, toFiniteNumber(frame.w, 1)),
    h: Math.max(1, toFiniteNumber(frame.h, 1))
  };
}
function parseRoots(result) {
  const array = Array.isArray(result) ? result : result?.roots;
  if (!Array.isArray(array)) return [];
  return array.map((raw) => {
    const metadata = typeof raw?.metadata === "object" && raw.metadata !== null ? raw.metadata : {};
    const kind = ["window", "menu", "sheet", "popover", "dialog"].includes(raw?.kind) ? raw.kind : "window";
    return {
      kind,
      rootRef: toOptionalString(raw?.rootRef ?? raw?.windowRef),
      windowRef: toOptionalString(raw?.windowRef ?? raw?.rootRef),
      windowId: Number.isFinite(raw?.windowId) ? Math.trunc(raw.windowId) : void 0,
      pid: Number.isFinite(raw?.pid) ? Math.trunc(raw.pid) : void 0,
      appName: toOptionalString(raw?.appName),
      bundleId: toOptionalString(raw?.bundleId),
      title: toOptionalString(raw?.title) ?? "",
      role: toOptionalString(raw?.role),
      subrole: toOptionalString(raw?.subrole),
      framePoints: parseFramePoints(raw),
      scaleFactor: Math.max(1, toFiniteNumber(raw?.scaleFactor, 1)),
      zOrder: Math.trunc(toFiniteNumber(raw?.zOrder, 0)),
      isMinimized: toBoolean(raw?.isMinimized),
      isOnscreen: toBoolean(raw?.isOnscreen),
      isMain: toBoolean(raw?.isMain),
      isFocused: toBoolean(raw?.isFocused),
      isModal: toBoolean(raw?.isModal),
      metadata
    };
  });
}
function helperAction(request) {
  if (!("focus" in request.target)) return { ...request };
  return { ...request, target: request.target.focus, params: { ...request.params, preserveFocus: true } };
}
var macosBackend = {
  async listApps(signal) {
    return parseApps(await macosHelper.command("listApps", {}, { signal }));
  },
  async listRoots(query, signal) {
    return parseRoots(await macosHelper.command("listRoots", {
      ...Number.isFinite(query.pid) ? { pid: Math.trunc(query.pid) } : {},
      ...query.title?.trim() ? { title: query.title.trim() } : {}
    }, { signal }));
  },
  async getFrontmost(signal) {
    const result = await macosHelper.command("getFrontmost", {}, { signal });
    const pid = Math.trunc(toFiniteNumber(result?.pid, NaN));
    if (!Number.isFinite(pid) || pid <= 0) {
      throw new Error("No frontmost app was available for screenshot targeting.");
    }
    return {
      appName: toOptionalString(result?.appName) ?? "Unknown App",
      bundleId: toOptionalString(result?.bundleId),
      pid,
      windowTitle: toOptionalString(result?.windowTitle),
      windowId: Number.isFinite(result?.windowId) ? Math.trunc(result.windowId) : void 0
    };
  },
  async focusWindow(target, signal) {
    return await macosHelper.command("focusWindow", { ...target }, { signal });
  },
  async observe(request, options) {
    return parseLookResponse(await macosHelper.command("look", {
      baseLookId: request.baseLookId,
      windowId: request.target.windowId,
      windowRef: request.target.rootRef,
      maxDimension: request.maxDimension,
      readText: request.readText,
      scopeRef: request.scopeRef,
      includeImage: request.includeImage
    }, options));
  },
  async act(request, options) {
    return await macosHelper.command("act", { ...helperAction(request), cursorOverlay: getComputerUseConfig().cursor_overlay }, options);
  },
  async actBatch(requests, options) {
    const cursorOverlay = getComputerUseConfig().cursor_overlay;
    return await macosHelper.command("actBatch", { actions: requests.map((request) => ({ ...helperAction(request), cursorOverlay })) }, options);
  },
  async readText(args, options) {
    return await macosHelper.command("axReadText", { ...args }, options);
  },
  async waitFor(args, options) {
    return await macosHelper.command("axWaitFor", { ...args }, options);
  }
};

// ../../node_modules/@injaneity/pi-computer-use/src/platform/macos/browser.ts
var BROWSER_WINDOW_OPEN_TIMEOUT_MS = 1e4;
var BROWSER_BUNDLE_IDS = /* @__PURE__ */ new Set([
  "com.apple.Safari",
  "com.google.Chrome",
  "org.chromium.Chromium",
  "company.thebrowser.Browser",
  "com.brave.Browser",
  "com.microsoft.edgemac",
  "com.vivaldi.Vivaldi",
  "net.imput.helium",
  "org.mozilla.firefox"
]);
var BROWSER_APP_NAMES = /* @__PURE__ */ new Set([
  "safari",
  "google chrome",
  "chrome",
  "chromium",
  "arc",
  "brave browser",
  "brave",
  "microsoft edge",
  "edge",
  "vivaldi",
  "helium",
  "firefox"
]);
var CHROME_FAMILY_BUNDLE_IDS = /* @__PURE__ */ new Set([
  "com.google.Chrome",
  "org.chromium.Chromium",
  "company.thebrowser.Browser",
  "com.brave.Browser",
  "com.microsoft.edgemac",
  "com.vivaldi.Vivaldi",
  "net.imput.helium"
]);
var CHROME_FAMILY_APP_NAMES = /* @__PURE__ */ new Set([
  "google chrome",
  "chrome",
  "chromium",
  "arc",
  "brave browser",
  "brave",
  "microsoft edge",
  "edge",
  "vivaldi",
  "helium"
]);
function normalizeText(value) {
  return value.trim().toLowerCase();
}
function escapeAppleScriptString(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
function appendBrowserJavaScriptAppleEventsHint(error) {
  const hint = [
    "Browser JavaScript Apple Events are disabled for the target browser.",
    `Ask the user to enable "Allow JavaScript from Apple Events" in the browser's developer menu, then retry the browser action.`
  ].join(" ");
  if (!/not allowed to send javascript commands|executing javascript through applescript is turned off|allow javascript from apple events|enable javascript from apple events/i.test(error.message) || error.message.includes(hint)) {
    return error;
  }
  const enhanced = new Error(`${error.message}

${hint}`);
  enhanced.name = error.name;
  return enhanced;
}
function isBrowserApp(appName, bundleId) {
  return BROWSER_BUNDLE_IDS.has(bundleId ?? "") || BROWSER_APP_NAMES.has(normalizeText(appName));
}
function isChromeFamilyApp(appName, bundleId) {
  return CHROME_FAMILY_BUNDLE_IDS.has(bundleId ?? "") || CHROME_FAMILY_APP_NAMES.has(normalizeText(appName));
}
function scriptForBrowserOpenLocation(target, url) {
  const appTarget = target.bundleId ? `application id "${escapeAppleScriptString(target.bundleId)}"` : `application "${escapeAppleScriptString(target.appName)}"`;
  const escapedUrl = escapeAppleScriptString(url);
  const normalizedName = normalizeText(target.appName);
  if (target.bundleId === "com.apple.Safari" || normalizedName === "safari") {
    return [`tell ${appTarget} to set URL of front document to "${escapedUrl}"`];
  }
  if (isChromeFamilyApp(target.appName, target.bundleId)) {
    return [`tell ${appTarget} to set URL of active tab of front window to "${escapedUrl}"`];
  }
  return void 0;
}
async function openBrowserLocationWithAppleScript(target, url, signal) {
  const script = scriptForBrowserOpenLocation(target, url);
  if (!script) return false;
  const args = script.flatMap((line) => ["-e", line]);
  try {
    await runProcess("osascript", args, BROWSER_WINDOW_OPEN_TIMEOUT_MS, signal);
    return true;
  } catch (error) {
    throw appendBrowserJavaScriptAppleEventsHint(error instanceof Error ? error : new Error(String(error)));
  }
}

// ../../node_modules/@injaneity/pi-computer-use/src/permissions.ts
function throwIfAborted2(signal) {
  if (signal?.aborted) throw new Error("Operation aborted.");
}
function granted(status, kind) {
  return status[kind] === true;
}
function allGranted(status, kinds) {
  return kinds.every(({ kind }) => granted(status, kind));
}
function missingKinds(status, kinds) {
  return kinds.flatMap(({ kind }) => granted(status, kind) ? [] : [kind]);
}
async function ensurePermissions(ctx, bridge, helperPath, signal) {
  let status = await bridge.checkPermissions(signal);
  if (allGranted(status, bridge.kinds)) return status;
  if (!ctx.hasUI) throw new Error(bridge.copy.nonInteractiveError(helperPath));
  await bridge.registerPermissions(signal).catch(() => void 0);
  while (!allGranted(status, bridge.kinds)) {
    throwIfAborted2(signal);
    const missing = missingKinds(status, bridge.kinds);
    const options = bridge.kinds.filter(({ kind }) => missing.includes(kind)).map(({ openOption }) => openOption);
    options.push("Recheck (restarts helper)", "Cancel");
    const choice = await ctx.ui.select(bridge.copy.prompt(status, helperPath, bridge.permissionHint), options, { signal });
    if (!choice || choice === "Cancel") throw new Error(bridge.copy.incompleteError(helperPath));
    const selected = bridge.kinds.find(({ openOption }) => choice === openOption);
    if (selected) await bridge.openPermissionPane(selected.kind, signal);
    if (choice.startsWith("Recheck")) {
      await bridge.restartHelper(signal);
      status = await bridge.checkPermissions(signal);
      if (allGranted(status, bridge.kinds)) {
        ctx.ui.notify(bridge.copy.readyMessage, "info");
      } else {
        ctx.ui.notify(bridge.copy.stillMissing(missingKinds(status, bridge.kinds)), "warning");
      }
    }
  }
  return status;
}

// ../../node_modules/@injaneity/pi-computer-use/src/platform/architecture.ts
var PLATFORM_ARCHITECTURE_VERSION = 1;
var REQUIRED_PLATFORM_INVARIANTS = [
  "state-scoped-observations",
  "bounded-observation-history",
  "multi-root-forest",
  "progressive-disclosure",
  "atomic-physical-input",
  "concurrent-requests",
  "transactional-batching"
];
function assertPlatformArchitecture(platform, diagnostics) {
  if (diagnostics.architectureVersion !== PLATFORM_ARCHITECTURE_VERSION) {
    throw new Error(`${platform} helper architecture mismatch: expected ${PLATFORM_ARCHITECTURE_VERSION}, got ${diagnostics.architectureVersion ?? "unknown"}. Rebuild and restart the helper.`);
  }
  const reported = new Set(diagnostics.invariants ?? []);
  const missing = REQUIRED_PLATFORM_INVARIANTS.filter((invariant) => !reported.has(invariant));
  if (missing.length > 0) {
    throw new Error(`${platform} helper does not satisfy the shared computer-use contract: ${missing.join(", ")}.`);
  }
}

// ../../node_modules/@injaneity/pi-computer-use/src/platform/macos/permissions.ts
var GRANT_INSTRUCTIONS = "Grant Accessibility and Screen Recording to pi-computer-use.app in System Settings \u2192 Privacy & Security. Screen Recording lets the agent see the window; Accessibility lets it interact with the window.";
var SIGNING_MIGRATION_WARNING = "If these permissions were enabled before this install/update, macOS invalidated the old grants because pi-computer-use.app was re-signed. Re-enable both toggles for the newly signed helper. If a toggle is already on, switch it off and on again.";
var macosPermissionKinds = [
  { kind: "accessibility", openOption: "Open Accessibility Settings (missing)" },
  { kind: "screenRecording", openOption: "Open Screen Recording Settings (missing)" }
];
function permissionStatusSummary(status) {
  const lines = [
    `Accessibility: ${status.accessibility ? "granted" : "missing"}`,
    `Screen Recording: ${status.screenRecording ? "granted" : "missing"}`
  ];
  if (status.screenRecordingPreflight && !status.screenRecording) {
    lines.push(
      "(Screen Recording reads granted in the TCC database but a live capture probe failed \u2014 the grant likely belongs to a different app identity, or the helper needs a restart.)"
    );
  }
  return lines.join("; ");
}
function permissionPrompt(status, helperPath, hint) {
  return [
    "pi-computer-use needs macOS permissions for its helper app.",
    permissionStatusSummary(status),
    "",
    `Helper: pi-computer-use.app (${helperPath})`,
    hint,
    "",
    `Important: ${SIGNING_MIGRATION_WARNING}`,
    "",
    "pi-computer-use.app is already listed in the pane(s) \u2014 enable its toggle, then choose Recheck."
  ].filter(Boolean).join("\n");
}
function missingPermissionMessage(kinds) {
  return `Still missing after restart: ${kinds.join(" and ")}. ${SIGNING_MIGRATION_WARNING} Then choose Recheck again.`;
}
async function checkPermissions(signal) {
  const result = await macosHelper.command("checkPermissions", {}, { signal });
  const rawSource = result?.source;
  return {
    accessibility: toBoolean(result?.accessibility),
    // Authoritative: the helper's live ScreenCaptureKit probe.
    screenRecording: toBoolean(result?.screenRecordingCapturable),
    // Keep the preflight value separate: disagreement means stale per-process
    // TCC cache or a grant row belonging to another app identity.
    screenRecordingPreflight: toBoolean(result?.screenRecordingPreflight),
    source: rawSource && typeof rawSource === "object" ? {
      // macOS attributes Accessibility / Screen Recording grants to the
      // responsible process at the top of the launch chain. "helper-app"
      // is the canonical installed app via LaunchServices; "caller" means
      // grants would attach to the launching app instead.
      attribution: rawSource.attribution === "helper-app" ? "helper-app" : "caller",
      pid: Math.trunc(toFiniteNumber(rawSource.pid, 0)) || void 0,
      parentPid: Math.trunc(toFiniteNumber(rawSource.parentPid, 0)) || void 0,
      executablePath: toOptionalString(rawSource.executablePath),
      parentPath: toOptionalString(rawSource.parentPath),
      parentBundleId: toOptionalString(rawSource.parentBundleId),
      os: toOptionalString(rawSource.macOS)
    } : void 0
  };
}
async function registerPermissions(signal) {
  await macosHelper.command("registerPermissions", {}, { signal, timeoutMs: 15e3 });
}
async function ensureMacosReady(ctx, state, signal) {
  await macosHelper.ensureInstalled(signal);
  if (!await macosHelper.ensureDaemon(signal)) {
    throw new Error(`pi-computer-use helper app daemon did not start. Helper app: ${HELPER_APP_PATH}`);
  }
  const helperDiagnostics = await macosHelper.ensureProtocol(signal);
  assertPlatformArchitecture("macOS", helperDiagnostics);
  const now = Date.now();
  const cachedStatus = state.permissionStatus;
  const canUseCachedPermissions = cachedStatus?.accessibility && cachedStatus.screenRecording && now - state.lastPermissionCheckAt < 2e3;
  if (canUseCachedPermissions) {
    return { ...state, helperDiagnostics };
  }
  let permissionStatus = await checkPermissions(signal);
  let lastPermissionCheckAt = now;
  if (!permissionStatus.accessibility || !permissionStatus.screenRecording) {
    const attributionHint = permissionStatus.source?.attribution === "caller" ? `Warning: the helper is not running as the installed pi-computer-use.app (executable: ${permissionStatus.source?.executablePath ?? "unknown"}). Grants made now would attach to the launching app instead. Restart Pi so the canonical helper is used.` : void 0;
    permissionStatus = await ensurePermissions(
      ctx,
      {
        kinds: macosPermissionKinds,
        copy: {
          nonInteractiveError: (helperPath) => `pi-computer-use setup requires an interactive session. Start pi in interactive mode. ${GRANT_INSTRUCTIONS}
Helper path: ${helperPath}`,
          prompt: permissionPrompt,
          incompleteError: (helperPath) => `pi-computer-use setup is incomplete. ${GRANT_INSTRUCTIONS} Helper path: ${helperPath}`,
          readyMessage: "pi-computer-use is ready.",
          stillMissing: missingPermissionMessage
        },
        checkPermissions: (permissionSignal) => checkPermissions(permissionSignal ?? signal),
        registerPermissions: (permissionSignal) => registerPermissions(permissionSignal ?? signal),
        openPermissionPane: async (kind, permissionSignal) => {
          await macosHelper.command("openPermissionPane", { kind }, { signal: permissionSignal ?? signal });
        },
        restartHelper: (permissionSignal) => macosHelper.restart(permissionSignal ?? signal),
        permissionHint: attributionHint
      },
      HELPER_APP_PATH,
      signal
    );
    lastPermissionCheckAt = Date.now();
  }
  return { permissionStatus, lastPermissionCheckAt, helperDiagnostics };
}

// ../../node_modules/@injaneity/pi-computer-use/src/platform/linux/helper.ts
import { spawn as spawn2 } from "node:child_process";
import { randomUUID as randomUUID2 } from "node:crypto";
import { constants as fsConstants3 } from "node:fs";
import { access as access2 } from "node:fs/promises";
import os5 from "node:os";
import path7 from "node:path";
var PACKAGE_ROOT2 = path7.dirname(require.resolve("@injaneity/pi-computer-use/package.json"));
var SETUP_HELPER_SCRIPT2 = path7.join(PACKAGE_ROOT2, "scripts", "setup-helper.mjs");
var HELPER_SETUP_TIMEOUT_MS2 = 6e4;
var COMMAND_TIMEOUT_MS3 = 15e3;
var LINUX_HELPER_PROTOCOL_VERSION = 4;
var LINUX_HELPER_PATH = process.env.PI_COMPUTER_USE_LINUX_HELPER_PATH || path7.join(os5.homedir(), ".pi", "agent", "helpers", "pi-computer-use", "linux-bridge");
async function isExecutable2(filePath) {
  try {
    await access2(filePath, fsConstants3.X_OK);
    return true;
  } catch {
    return false;
  }
}
async function runProcess2(command, args, timeoutMs, signal, env) {
  if (signal?.aborted) throw new Error("Operation aborted.");
  await new Promise((resolve, reject) => {
    const child = spawn2(command, args, { stdio: ["ignore", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`));
    }, timeoutMs);
    const onAbort = () => {
      child.kill("SIGTERM");
      finish(new Error("Operation aborted."));
    };
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) return finish();
      const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
      finish(new Error(`Command failed (${code}): ${command} ${args.join(" ")}
${output}`.trim()));
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function waitForShared(promise, signal) {
  if (!signal) return await promise;
  if (signal.aborted) throw new Error("Operation aborted.");
  return await new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("Operation aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}
var LinuxHelperClient = class {
  installChecked = false;
  installPromise;
  child;
  processPromise;
  buffer = "";
  pending = /* @__PURE__ */ new Map();
  helperPath;
  setupHelperScript;
  constructor(options = {}) {
    this.helperPath = options.helperPath ?? LINUX_HELPER_PATH;
    this.setupHelperScript = options.setupHelperScript ?? SETUP_HELPER_SCRIPT2;
  }
  dispose() {
    this.rejectPending(new Error("Linux helper closed because the Pi session ended."));
    const child = this.child;
    this.child = void 0;
    if (!child) return;
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.kill("SIGTERM");
    child.unref();
  }
  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.buffer = "";
  }
  async ensureInstalled(signal) {
    if (await isExecutable2(this.helperPath) && this.installChecked) return;
    if (!this.installPromise) {
      const installPromise = (async () => {
        await runProcess2(process.execPath, [this.setupHelperScript, "--platform", "linux", "--runtime"], HELPER_SETUP_TIMEOUT_MS2, void 0, {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          BUN_BE_BUN: "1",
          PI_COMPUTER_USE_LINUX_HELPER_PATH: this.helperPath
        });
        if (!await isExecutable2(this.helperPath)) throw new Error(`Failed to install Linux helper at ${this.helperPath}.`);
        this.installChecked = true;
      })();
      this.installPromise = installPromise;
      installPromise.then(
        () => {
          if (this.installPromise === installPromise) this.installPromise = void 0;
        },
        () => {
          if (this.installPromise === installPromise) this.installPromise = void 0;
        }
      );
    }
    await waitForShared(this.installPromise, signal);
  }
  async process(signal) {
    await this.ensureInstalled(signal);
    if (this.processPromise) return await waitForShared(this.processPromise, signal);
    if (this.child && this.child.exitCode === null && !this.child.killed) return this.child;
    if (!this.processPromise) {
      const processPromise = this.startProcess();
      this.processPromise = processPromise;
      processPromise.then(
        () => {
          if (this.processPromise === processPromise) this.processPromise = void 0;
        },
        () => {
          if (this.processPromise === processPromise) this.processPromise = void 0;
        }
      );
    }
    return await waitForShared(this.processPromise, signal);
  }
  async startProcess() {
    const child = spawn2(this.helperPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdin.setDefaultEncoding("utf8");
    child.stdout.on("data", (chunk) => this.onStdout(chunk));
    child.on("exit", (code, signalName) => {
      if (this.child !== child) return;
      this.child = void 0;
      this.rejectPending(new Error(`Linux helper exited${signalName ? ` on ${signalName}` : ` with code ${code ?? "unknown"}`}.`));
    });
    child.on("error", (error) => {
      if (this.child !== child) return;
      this.child = void 0;
      this.rejectPending(error);
    });
    this.child = child;
    this.buffer = "";
    return await new Promise((resolve, reject) => {
      child.once("spawn", () => resolve(child));
      child.once("error", reject);
    });
  }
  onStdout(chunk) {
    this.buffer += chunk;
    for (; ; ) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = this.pending.get(parsed.id);
      if (!pending) continue;
      this.pending.delete(parsed.id);
      clearTimeout(pending.timer);
      if (parsed.protocolVersion !== LINUX_HELPER_PROTOCOL_VERSION) {
        pending.reject(new Error(`Linux helper protocol mismatch: expected ${LINUX_HELPER_PROTOCOL_VERSION}, got ${parsed.protocolVersion ?? "unknown"}. Restart Pi to use the installed helper.`));
      } else if (parsed.ok === true) {
        pending.resolve(parsed.result);
      } else {
        const error = new Error(parsed.error?.message ?? "Linux helper command failed.");
        error.code = parsed.error?.code;
        pending.reject(error);
      }
    }
  }
  async command(cmd, args = {}, options) {
    const child = await this.process(options?.signal);
    const id = randomUUID2();
    const timeoutMs = options?.timeoutMs ?? COMMAND_TIMEOUT_MS3;
    return await new Promise((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error("Operation aborted."));
      };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener("abort", onAbort);
        this.pending.delete(id);
        reject(new Error(`Helper command '${cmd}' timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          options?.signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          options?.signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
        timer
      });
      options?.signal?.addEventListener("abort", onAbort, { once: true });
      child.stdin.write(`${JSON.stringify({ protocolVersion: LINUX_HELPER_PROTOCOL_VERSION, id, cmd, args })}
`, (error) => {
        if (!error) return;
        options?.signal?.removeEventListener("abort", onAbort);
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }
};
var linuxHelper = new LinuxHelperClient();

// ../../node_modules/@injaneity/pi-computer-use/src/platform/linux/backend.ts
function normalizedProcessName(appName) {
  return appName.toLowerCase().split("/").pop().replace(/\.desktop$/i, "");
}
function classifyBrowser(appName) {
  switch (normalizedProcessName(appName)) {
    case "chrome":
    case "google-chrome":
    case "google-chrome-stable":
    case "chromium":
    case "chromium-browser":
    case "microsoft-edge":
    case "microsoft-edge-stable":
    case "brave":
    case "brave-browser":
    case "vivaldi":
    case "vivaldi-stable":
    case "opera":
      return "chromium";
    case "firefox":
    case "firefox-esr":
      return "firefox";
    default:
      return false;
  }
}
function parseFramePoints2(raw) {
  const frame = raw?.framePoints ?? raw?.bounds ?? {};
  return {
    x: toFiniteNumber(frame.x, 0),
    y: toFiniteNumber(frame.y, 0),
    w: Math.max(1, toFiniteNumber(frame.w ?? frame.width, 1)),
    h: Math.max(1, toFiniteNumber(frame.h ?? frame.height, 1))
  };
}
function parseRootKind(raw) {
  return raw === "menu" || raw === "sheet" || raw === "dialog" || raw === "popover" || raw === "window" ? raw : "window";
}
function parseRoots2(result) {
  const roots = Array.isArray(result) ? result : result?.roots;
  if (!Array.isArray(roots)) return [];
  return roots.map((raw, index) => ({
    kind: parseRootKind(raw?.kind),
    rootRef: toOptionalString(raw?.rootRef ?? raw?.windowRef ?? raw?.ref),
    windowRef: toOptionalString(raw?.windowRef ?? raw?.rootRef ?? raw?.ref),
    windowId: Number.isFinite(raw?.windowId) ? Math.trunc(raw.windowId) : void 0,
    pid: Number.isFinite(raw?.pid) ? Math.trunc(raw.pid) : void 0,
    appName: toOptionalString(raw?.appName ?? raw?.processName),
    bundleId: toOptionalString(raw?.bundleId ?? raw?.desktopId),
    title: toOptionalString(raw?.title) ?? "",
    role: toOptionalString(raw?.role),
    subrole: toOptionalString(raw?.subrole),
    zOrder: Math.trunc(toFiniteNumber(raw?.zOrder, index)),
    framePoints: parseFramePoints2(raw),
    scaleFactor: Math.max(1, toFiniteNumber(raw?.scaleFactor, 1)),
    isOnscreen: raw?.isOnscreen === void 0 ? true : toBoolean(raw.isOnscreen),
    isFocused: toBoolean(raw?.isFocused),
    isMinimized: toBoolean(raw?.isMinimized),
    isMain: toBoolean(raw?.isMain ?? raw?.isFocused),
    isModal: toBoolean(raw?.isModal),
    metadata: raw?.metadata
  }));
}
function appsFromRoots(roots) {
  const seen = /* @__PURE__ */ new Set();
  return roots.flatMap((root) => {
    if (!root.pid || seen.has(root.pid)) return [];
    seen.add(root.pid);
    return [{
      appName: root.appName ?? "Unknown",
      bundleId: root.bundleId,
      pid: root.pid,
      isFrontmost: root.isFocused
    }];
  });
}
function helperAction2(request) {
  if (!("focus" in request.target)) return { ...request };
  return { ...request, target: request.target.focus, params: { ...request.params, preserveFocus: true } };
}
async function ensureReady(_ctx, state, signal) {
  await linuxHelper.ensureInstalled(signal);
  const diagnostics = await linuxHelper.command("diagnostics", {}, { signal, timeoutMs: 5e3 });
  if (diagnostics?.protocolVersion !== LINUX_HELPER_PROTOCOL_VERSION) {
    throw new Error(`Linux helper protocol mismatch: expected ${LINUX_HELPER_PROTOCOL_VERSION}, got ${diagnostics?.protocolVersion ?? "unknown"}. Restart Pi to use the installed helper.`);
  }
  assertPlatformArchitecture("Linux", diagnostics);
  if (diagnostics?.accessibility === false) {
    throw new Error("Linux accessibility is unavailable. Ensure AT-SPI is enabled and a D-Bus desktop accessibility bus is running.");
  }
  return { ...state, lastPermissionCheckAt: Date.now(), helperDiagnostics: diagnostics };
}
var linuxBackend = {
  name: "linux",
  shutdown() {
    linuxHelper.dispose();
  },
  ensureReady,
  async listApps(signal) {
    return appsFromRoots(parseRoots2(await linuxHelper.command("listRoots", {}, { signal })));
  },
  async listRoots(query, signal) {
    const roots = parseRoots2(await linuxHelper.command("listRoots", Number.isFinite(query.pid) ? { pid: Math.trunc(query.pid) } : {}, { signal }));
    const title = query.title?.trim().toLowerCase();
    return title ? roots.filter((root) => root.title.trim().toLowerCase().includes(title)) : roots;
  },
  async getFrontmost(signal) {
    const roots = parseRoots2(await linuxHelper.command("listRoots", {}, { signal }));
    const focused = roots.find((root) => root.isFocused) ?? roots[0];
    if (!focused?.pid) throw new Error("No frontmost window was available.");
    return {
      appName: focused.appName ?? "Unknown",
      bundleId: focused.bundleId,
      pid: focused.pid,
      windowTitle: focused.title,
      windowId: focused.windowId,
      rootRef: focused.rootRef
    };
  },
  async focusWindow(target, signal) {
    return await linuxHelper.command("focusWindow", { ...target }, { signal });
  },
  async observe(request, options) {
    return parseLookResponse(await linuxHelper.command("look", {
      ...request.target,
      baseLookId: request.baseLookId,
      maxDimension: request.maxDimension,
      readText: request.readText,
      scopeRef: request.scopeRef,
      includeImage: request.includeImage
    }, options));
  },
  async act(request, options) {
    return await linuxHelper.command("act", helperAction2(request), options);
  },
  async actBatch(requests, options) {
    return await linuxHelper.command("actBatch", { actions: requests.map(helperAction2) }, options);
  },
  async readText(args, options) {
    return await linuxHelper.command("atspiReadText", { ...args }, options);
  },
  async waitFor(args, options) {
    return await linuxHelper.command("atspiWaitFor", { ...args }, options);
  },
  isBrowserApp(appName) {
    return classifyBrowser(appName) !== false;
  },
  isChromeFamilyApp(appName) {
    return classifyBrowser(appName) === "chromium";
  },
  async openBrowserLocation(target, url, signal) {
    await linuxHelper.command("openBrowserLocation", { ...target, url }, { signal, timeoutMs: 1e4 });
    return true;
  }
};

// ../../node_modules/@injaneity/pi-computer-use/src/platform/windows/helper.ts
import { spawn as spawn3 } from "node:child_process";
import { randomUUID as randomUUID3 } from "node:crypto";
import { constants as fsConstants4 } from "node:fs";
import { access as access3 } from "node:fs/promises";
import os6 from "node:os";
import path8 from "node:path";
var PACKAGE_ROOT3 = path8.dirname(require.resolve("@injaneity/pi-computer-use/package.json"));
var SETUP_HELPER_SCRIPT3 = path8.join(PACKAGE_ROOT3, "scripts", "setup-helper.mjs");
var HELPER_SETUP_TIMEOUT_MS3 = 6e4;
var COMMAND_TIMEOUT_MS4 = 15e3;
var WINDOWS_HELPER_PROTOCOL_VERSION = 4;
var PACKAGED_WINDOWS_HELPER_PATH = path8.join(process.resourcesPath ?? "", "computer-use", "windows-bridge.exe");
var WINDOWS_HELPER_PATH = process.env.PI_COMPUTER_USE_WINDOWS_HELPER_PATH || (require("node:fs").existsSync(PACKAGED_WINDOWS_HELPER_PATH) ? PACKAGED_WINDOWS_HELPER_PATH : path8.join(os6.homedir(), ".pi", "agent", "helpers", "pi-computer-use", "windows-bridge.exe"));
async function isExecutable3(filePath) {
  try {
    await access3(filePath, fsConstants4.X_OK);
    return true;
  } catch {
    return false;
  }
}
async function runProcess3(command, args, timeoutMs, signal, env) {
  if (signal?.aborted) throw new Error("Operation aborted.");
  await new Promise((resolve, reject) => {
    const child = spawn3(command, args, { stdio: ["ignore", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      cleanup();
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`));
    }, timeoutMs);
    const onAbort = () => {
      child.kill("SIGTERM");
      cleanup();
      reject(new Error("Operation aborted."));
    };
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      if (code === 0) return resolve();
      const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
      reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}
${output}`.trim()));
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
var WindowsHelperClient = class {
  installChecked = false;
  child;
  buffer = "";
  pending = /* @__PURE__ */ new Map();
  dispose() {
    const error = new Error("Windows helper closed because the Pi session ended.");
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.buffer = "";
    const child = this.child;
    this.child = void 0;
    if (!child) return;
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.kill("SIGTERM");
    child.unref();
  }
  async ensureInstalled(signal) {
    if (await isExecutable3(WINDOWS_HELPER_PATH) && (this.installChecked || WINDOWS_HELPER_PATH === PACKAGED_WINDOWS_HELPER_PATH)) {
      this.installChecked = true;
      return;
    }
    await runProcess3(process.execPath, [SETUP_HELPER_SCRIPT3, "--platform", "windows", "--runtime"], HELPER_SETUP_TIMEOUT_MS3, signal, { ...process.env, ELECTRON_RUN_AS_NODE: "1", BUN_BE_BUN: "1" });
    this.installChecked = true;
    if (!await isExecutable3(WINDOWS_HELPER_PATH)) throw new Error(`Failed to install Windows helper at ${WINDOWS_HELPER_PATH}.`);
  }
  async process(signal) {
    await this.ensureInstalled(signal);
    if (this.child && this.child.exitCode === null && !this.child.killed) return this.child;
    const child = spawn3(WINDOWS_HELPER_PATH, [], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdin.setDefaultEncoding("utf8");
    child.stdout.on("data", (chunk) => this.onStdout(chunk));
    child.on("exit", () => {
      if (this.child === child) this.child = void 0;
    });
    child.on("error", () => {
      if (this.child === child) this.child = void 0;
    });
    this.child = child;
    this.buffer = "";
    return child;
  }
  onStdout(chunk) {
    this.buffer += chunk;
    for (; ; ) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = this.pending.get(parsed.id);
      if (!pending) continue;
      this.pending.delete(parsed.id);
      clearTimeout(pending.timer);
      if (parsed.protocolVersion !== WINDOWS_HELPER_PROTOCOL_VERSION) {
        pending.reject(new Error(`Windows helper protocol mismatch: expected ${WINDOWS_HELPER_PROTOCOL_VERSION}, got ${parsed.protocolVersion ?? "unknown"}. Restart Pi to use the installed helper.`));
      } else if (parsed.ok === true) {
        pending.resolve(parsed.result);
      } else {
        const error = new Error(parsed.error?.message ?? "Windows helper command failed.");
        error.code = parsed.error?.code;
        pending.reject(error);
      }
    }
  }
  async command(cmd, args = {}, options) {
    const child = await this.process(options?.signal);
    const id = randomUUID3();
    const timeoutMs = options?.timeoutMs ?? COMMAND_TIMEOUT_MS4;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Helper command '${cmd}' timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ protocolVersion: WINDOWS_HELPER_PROTOCOL_VERSION, id, cmd, args })}
`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }
};
var windowsHelper = new WindowsHelperClient();

// ../../node_modules/@injaneity/pi-computer-use/src/platform/windows/backend.ts
function normalizedProcessName2(appName) {
  return appName.toLowerCase().replace(/\.exe$/i, "");
}
function classifyBrowser2(appName) {
  switch (normalizedProcessName2(appName)) {
    case "chrome":
    case "chromium":
      return "chrome";
    case "msedge":
    case "edge":
      return "edge";
    case "brave":
    case "brave-browser":
      return "brave";
    case "firefox":
      return "firefox";
    case "vivaldi":
      return "vivaldi";
    case "opera":
    case "opera_gx":
      return "opera";
    default:
      return false;
  }
}
function parseFramePoints3(raw) {
  const frame = raw?.framePoints ?? raw?.bounds ?? {};
  return {
    x: toFiniteNumber(frame.x, 0),
    y: toFiniteNumber(frame.y, 0),
    w: Math.max(1, toFiniteNumber(frame.w ?? frame.width, 1)),
    h: Math.max(1, toFiniteNumber(frame.h ?? frame.height, 1))
  };
}
function parseRootKind2(raw) {
  return raw === "menu" || raw === "dialog" || raw === "popover" || raw === "window" ? raw : "window";
}
function parseRoots3(result) {
  const array = Array.isArray(result) ? result : result?.roots;
  if (!Array.isArray(array)) return [];
  return array.map((raw, index) => {
    return {
      kind: parseRootKind2(raw?.kind),
      rootRef: toOptionalString(raw?.rootRef ?? raw?.windowRef ?? raw?.ref),
      windowRef: toOptionalString(raw?.windowRef ?? raw?.rootRef ?? raw?.ref),
      windowId: Number.isFinite(raw?.windowId) ? Math.trunc(raw.windowId) : void 0,
      pid: Number.isFinite(raw?.pid) ? Math.trunc(raw.pid) : void 0,
      appName: toOptionalString(raw?.appName ?? raw?.processName),
      bundleId: toOptionalString(raw?.bundleId),
      title: toOptionalString(raw?.title) ?? "",
      role: toOptionalString(raw?.role),
      subrole: toOptionalString(raw?.subrole),
      zOrder: Math.trunc(toFiniteNumber(raw?.zOrder, index)),
      framePoints: parseFramePoints3(raw),
      scaleFactor: Math.max(1, toFiniteNumber(raw?.scaleFactor, 1)),
      isOnscreen: raw?.isOnscreen === void 0 ? true : toBoolean(raw?.isOnscreen),
      isFocused: toBoolean(raw?.isFocused),
      isMinimized: toBoolean(raw?.isMinimized),
      isMain: toBoolean(raw?.isMain ?? raw?.isFocused),
      isModal: toBoolean(raw?.isModal),
      metadata: raw?.metadata
    };
  });
}
function appsFromRoots2(roots) {
  const seen = /* @__PURE__ */ new Set();
  return roots.flatMap((root) => {
    if (!root.pid || seen.has(root.pid)) return [];
    seen.add(root.pid);
    return [{ appName: root.appName ?? "Unknown", bundleId: root.bundleId, pid: root.pid, isFrontmost: root.isFocused }];
  });
}
function helperAction3(request) {
  if (!("focus" in request.target)) return { ...request };
  return { ...request, target: request.target.focus, params: { ...request.params, preserveFocus: true } };
}
async function ensureReady2(_ctx, state, signal) {
  await windowsHelper.ensureInstalled(signal);
  const diagnostics = await windowsHelper.command("diagnostics", {}, { signal, timeoutMs: 5e3 });
  if (diagnostics?.protocolVersion !== WINDOWS_HELPER_PROTOCOL_VERSION) {
    throw new Error(`Windows helper protocol mismatch: expected ${WINDOWS_HELPER_PROTOCOL_VERSION}, got ${diagnostics?.protocolVersion ?? "unknown"}. Restart Pi to use the installed helper.`);
  }
  assertPlatformArchitecture("Windows", diagnostics);
  return { ...state, lastPermissionCheckAt: Date.now(), helperDiagnostics: diagnostics };
}
var windowsBackend = {
  name: "windows",
  shutdown() {
    windowsHelper.dispose();
  },
  ensureReady: ensureReady2,
  async listApps(signal) {
    return appsFromRoots2(parseRoots3(await windowsHelper.command("listRoots", {}, { signal })));
  },
  async listRoots(query, signal) {
    const roots = parseRoots3(await windowsHelper.command("listRoots", Number.isFinite(query.pid) ? { pid: Math.trunc(query.pid) } : {}, { signal }));
    const title = query.title?.trim().toLowerCase();
    return title ? roots.filter((root) => root.title.trim().toLowerCase().includes(title)) : roots;
  },
  async getFrontmost(signal) {
    const roots = parseRoots3(await windowsHelper.command("listRoots", {}, { signal }));
    const focused = roots.find((root) => root.isFocused) ?? roots[0];
    if (!focused?.pid) throw new Error("No frontmost window was available.");
    return { appName: focused.appName ?? "Unknown", bundleId: focused.bundleId, pid: focused.pid, windowTitle: focused.title, windowId: focused.windowId, rootRef: focused.rootRef };
  },
  async focusWindow(target, signal) {
    return await windowsHelper.command("focusWindow", { ...target }, { signal });
  },
  async observe(request, options) {
    return parseLookResponse(await windowsHelper.command("look", { ...request.target, baseLookId: request.baseLookId, maxDimension: request.maxDimension, readText: request.readText, scopeRef: request.scopeRef, includeImage: request.includeImage }, options));
  },
  async act(request, options) {
    return await windowsHelper.command("act", helperAction3(request), options);
  },
  async actBatch(requests, options) {
    return await windowsHelper.command("actBatch", { actions: requests.map(helperAction3) }, options);
  },
  async readText(args, options) {
    return await windowsHelper.command("uiaReadText", { ...args }, options);
  },
  async waitFor(args, options) {
    return await windowsHelper.command("uiaWaitFor", { ...args }, options);
  },
  isBrowserApp(appName) {
    return classifyBrowser2(appName) !== false;
  },
  isChromeFamilyApp(appName) {
    return classifyBrowser2(appName) === "chrome" || classifyBrowser2(appName) === "edge" || classifyBrowser2(appName) === "brave";
  },
  async openBrowserLocation(target, url, signal) {
    await windowsHelper.command("openBrowserLocation", { ...target, url }, { signal, timeoutMs: 1e4 });
    return true;
  }
};

// ../../node_modules/@injaneity/pi-computer-use/src/platform/index.ts
var macosPlatformBackend = {
  name: "macos",
  ensureReady: ensureMacosReady,
  listApps: macosBackend.listApps,
  listRoots: macosBackend.listRoots,
  getFrontmost: macosBackend.getFrontmost,
  focusWindow: macosBackend.focusWindow,
  observe: macosBackend.observe,
  act: macosBackend.act,
  actBatch: macosBackend.actBatch,
  readText: macosBackend.readText,
  waitFor: macosBackend.waitFor,
  isBrowserApp,
  isChromeFamilyApp,
  openBrowserLocation: openBrowserLocationWithAppleScript
};
var UnsupportedPlatformBackend = class {
  name;
  platform;
  constructor(platform) {
    this.platform = platform;
    this.name = platform === "win32" ? "windows" : "linux";
  }
  unsupported() {
    throw new Error(`pi-computer-use does not support platform '${this.platform}' yet.`);
  }
  async ensureReady() {
    this.unsupported();
  }
  async listApps() {
    this.unsupported();
  }
  async listRoots() {
    this.unsupported();
  }
  async getFrontmost() {
    this.unsupported();
  }
  async focusWindow() {
    this.unsupported();
  }
  async observe() {
    this.unsupported();
  }
  async act() {
    this.unsupported();
  }
  async readText() {
    this.unsupported();
  }
  async waitFor() {
    this.unsupported();
  }
  isBrowserApp() {
    this.unsupported();
  }
  isChromeFamilyApp() {
    this.unsupported();
  }
  async openBrowserLocation() {
    this.unsupported();
  }
};
function platformBackendForRuntime(platform = process.platform) {
  if (platform === "darwin") return macosPlatformBackend;
  if (platform === "win32") return windowsBackend;
  if (platform === "linux") return linuxBackend;
  return new UnsupportedPlatformBackend(platform);
}
var currentPlatformBackend = platformBackendForRuntime();

// ../../node_modules/@injaneity/pi-computer-use/src/runtime.ts
import { randomUUID as randomUUID4 } from "node:crypto";
var StaleResourceStateError = class extends Error {
  constructor(resourceKey, expectedEpoch, actualEpoch) {
    super(`State is stale for ${resourceKey}: expected epoch ${expectedEpoch}, current epoch ${actualEpoch}.`);
    this.resourceKey = resourceKey;
    this.expectedEpoch = expectedEpoch;
    this.actualEpoch = actualEpoch;
    this.name = "StaleResourceStateError";
  }
};
var StateStore = class {
  constructor(limit = 128) {
    this.limit = limit;
  }
  records = /* @__PURE__ */ new Map();
  create(resourceKey, epoch, value) {
    const record = { stateId: randomUUID4(), resourceKey, epoch, value };
    this.set(record);
    return record;
  }
  set(record) {
    this.records.delete(record.stateId);
    this.records.set(record.stateId, record);
    while (this.records.size > this.limit) {
      const oldest = this.records.keys().next().value;
      if (!oldest) break;
      this.records.delete(oldest);
    }
  }
  get(stateId2) {
    return this.records.get(stateId2);
  }
  clear() {
    this.records.clear();
  }
  get size() {
    return this.records.size;
  }
};
var ResourceScheduler = class {
  resources = /* @__PURE__ */ new Map();
  closed = false;
  epoch(resourceKey) {
    return this.resource(resourceKey).epoch;
  }
  restoreEpoch(resourceKey, epoch) {
    const record = this.resource(resourceKey);
    record.epoch = Math.max(record.epoch, Math.max(0, Math.trunc(epoch)));
  }
  async read(resourceKey, work) {
    return await this.enqueue(resourceKey, async (record) => ({ value: await work(record.epoch), epoch: record.epoch }));
  }
  async readAt(resourceKey, expectedEpoch, work) {
    return await this.enqueue(resourceKey, async (record) => {
      if (record.epoch !== expectedEpoch) throw new StaleResourceStateError(resourceKey, expectedEpoch, record.epoch);
      return { value: await work(record.epoch), epoch: record.epoch };
    });
  }
  async write(resourceKey, baseEpoch, work) {
    return await this.enqueue(resourceKey, async (record) => {
      if (record.epoch !== baseEpoch) throw new StaleResourceStateError(resourceKey, baseEpoch, record.epoch);
      const nextEpoch = record.epoch + 1;
      record.epoch = nextEpoch;
      return { value: await work(nextEpoch), epoch: nextEpoch };
    });
  }
  async drain() {
    await Promise.all([...this.resources.values()].map((record) => record.tail.catch(() => void 0)));
  }
  async close() {
    this.closed = true;
    await this.drain();
    this.resources.clear();
  }
  resource(resourceKey) {
    let record = this.resources.get(resourceKey);
    if (!record) {
      record = { epoch: 0, tail: Promise.resolve() };
      this.resources.set(resourceKey, record);
    }
    return record;
  }
  async enqueue(resourceKey, work) {
    if (this.closed) throw new Error("Computer-use session is shutting down.");
    const record = this.resource(resourceKey);
    const previous = record.tail;
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    record.tail = previous.catch(() => void 0).then(() => next);
    await previous.catch(() => void 0);
    try {
      return await work(record);
    } finally {
      release();
    }
  }
};

// ../../node_modules/@injaneity/pi-computer-use/src/state.ts
import { AsyncLocalStorage } from "node:async_hooks";
var SavedStates = class {
  store = new StateStore(128);
  operations = new AsyncLocalStorage();
  current() {
    const state = this.operations.getStore();
    if (!state) throw new Error("Computer-use operation state is unavailable.");
    return state;
  }
  get(stateId2) {
    return this.store.get(stateId2);
  }
  set(record) {
    this.store.set(record);
  }
  clear() {
    this.store.clear();
  }
  hydrate(record) {
    if (!record) return {};
    if (record.value.kind === "browser") {
      const outline2 = restoreOutline(record.value.outline);
      return {
        currentCapture: { stateId: record.stateId, width: 0, height: 0, scaleFactor: 1, timestamp: record.value.snapshot.capturedAt },
        currentLook: {
          lookId: record.value.snapshot.snapshotId,
          capturedAt: record.value.snapshot.capturedAt / 1e3,
          window: { windowId: 0, framePoints: { x: 0, y: 0, w: 1, h: 1 }, scaleFactor: 1, isModal: false, role: "document", subrole: "" },
          outline: outline2.root,
          timings: {},
          parsedOutline: outline2
        },
        currentOutline: outline2,
        resourceKey: record.resourceKey,
        epoch: record.epoch,
        browserSnapshot: record.value.snapshot,
        contextId: record.value.snapshot.contextId
      };
    }
    const outline = restoreOutline(record.value.outline);
    return {
      currentTarget: { ...record.value.target },
      currentCapture: { ...record.value.capture },
      currentStateTarget: { pid: record.value.target.pid, windowId: record.value.target.windowId, windowRef: record.value.target.windowRef },
      currentImageMode: record.value.imageMode,
      currentLook: { ...record.value.look, outline: outline.root, parsedOutline: outline },
      currentOutline: outline,
      currentNote: record.value.note ? structuredClone(record.value.note) : void 0,
      resourceKey: record.resourceKey,
      epoch: record.epoch
    };
  }
  saveDesktop(state, resourceKey, epoch) {
    if (!state.currentTarget || !state.currentCapture || !state.currentLook || !state.currentOutline) return;
    this.store.set({
      stateId: state.currentCapture.stateId,
      resourceKey,
      epoch,
      value: {
        kind: "desktop",
        target: { ...state.currentTarget },
        capture: { ...state.currentCapture },
        look: {
          lookId: state.currentLook.lookId,
          capturedAt: state.currentLook.capturedAt,
          window: structuredClone(state.currentLook.window),
          image: state.currentLook.image ? { ...state.currentLook.image } : void 0,
          timings: { ...state.currentLook.timings },
          readText: state.currentLook.readText ? { ...state.currentLook.readText } : void 0
        },
        outline: serializeOutline(state.currentOutline),
        note: state.currentNote ? structuredClone(state.currentNote) : void 0,
        imageMode: state.currentImageMode
      }
    });
  }
};

// ../../node_modules/@injaneity/pi-computer-use/src/view.ts
function numericRef(ref) {
  const match = /^@e(\d+)$/.exec(ref);
  return match ? Number(match[1]) : 0;
}
function rebuildIndexes2(outline) {
  outline.nodes = [];
  outline.refToWireRef = /* @__PURE__ */ new Map();
  outline.wireRefToRef = /* @__PURE__ */ new Map();
  const queue = [outline.root];
  while (queue.length > 0) {
    const node = queue.shift();
    outline.nodes.push(node);
    if (node.wireRef) {
      outline.refToWireRef.set(node.ref, node.wireRef);
      outline.wireRefToRef.set(node.wireRef, node.ref);
    }
    queue.push(...node.children);
  }
}
function structuralToken(node) {
  return [node.role, node.subrole, node.identifier, node.title, node.description].map((value) => value.trim().toLowerCase()).join("|");
}
function structuralKey(node) {
  const parts = [];
  let current = node;
  while (current) {
    const token = structuralToken(current);
    const siblings = current.parent?.children ?? [current];
    const peers = siblings.filter((candidate) => structuralToken(candidate) === token);
    parts.unshift(`${token}#${Math.max(0, peers.indexOf(current))}`);
    current = current.parent;
  }
  return parts.join(">");
}
function stabilizeRefs(base, next) {
  if (!base) return next;
  const reserved = /* @__PURE__ */ new Set();
  const assigned = /* @__PURE__ */ new Set();
  const byWireRef = new Map(base.nodes.filter((node) => node.wireRef).map((node) => [node.wireRef, node.ref]));
  const structuralGroups = /* @__PURE__ */ new Map();
  for (const node of base.nodes) {
    const key = structuralKey(node);
    structuralGroups.set(key, [...structuralGroups.get(key) ?? [], node]);
  }
  let nextIndex = Math.max(0, ...base.nodes.map((node) => numericRef(node.ref))) + 1;
  for (const node of next.nodes) {
    const wireStable = node.wireRef ? byWireRef.get(node.wireRef) : void 0;
    const structuralMatches = structuralGroups.get(structuralKey(node)) ?? [];
    const stable = wireStable ?? (structuralMatches.length === 1 ? structuralMatches[0].ref : void 0);
    if (stable && !reserved.has(stable)) {
      node.ref = stable;
      reserved.add(stable);
      assigned.add(node);
    }
  }
  for (const node of next.nodes) {
    if (assigned.has(node)) continue;
    while (reserved.has(`@e${nextIndex}`)) nextIndex += 1;
    node.ref = `@e${nextIndex++}`;
    reserved.add(node.ref);
  }
  rebuildIndexes2(next);
  return next;
}
function comparable(node) {
  const { children: _children, ...fields } = serializeOutlineNode(node);
  return {
    ...fields,
    rect: fields.rect ? { x: Math.round(fields.rect.x), y: Math.round(fields.rect.y), w: Math.round(fields.rect.w), h: Math.round(fields.rect.h) } : void 0,
    text: fields.text.map((item) => ({ string: item.string, confidence: Math.round(item.confidence * 100) / 100 }))
  };
}
function changedFields(base, next) {
  const before = comparable(base);
  const after = comparable(next);
  const fields = {};
  for (const key of Object.keys(after)) {
    if (key === "ref" || key === "wireRef") continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) fields[key] = after[key];
  }
  return fields;
}
function refPath(node) {
  const refs = [];
  let current = node;
  while (current) {
    refs.unshift(current.ref);
    current = current.parent;
  }
  return refs;
}
function changesBetween(base, next) {
  if (base.root.role !== next.root.role || base.root.subrole !== next.root.subrole) {
    return { changes: [], changedNodeCount: next.nodes.length, fullNodeCount: next.nodes.length, useFullView: true, reason: "root_replaced" };
  }
  const before = new Map(base.nodes.map((node) => [node.ref, node]));
  const after = new Map(next.nodes.map((node) => [node.ref, node]));
  const changes = [];
  for (const node of next.nodes) {
    const previous = before.get(node.ref);
    if (!previous) changes.push({ type: "added", ref: node.ref, parent: node.parent?.ref, node: { ...serializeOutlineNode(node), children: [] } });
    else {
      const fields = changedFields(previous, node);
      if (Object.keys(fields).length > 0) changes.push({ type: "updated", ref: node.ref, path: refPath(node), fields });
    }
  }
  for (const node of base.nodes) if (!after.has(node.ref)) changes.push({ type: "removed", ref: node.ref, parent: node.parent?.ref });
  const identityConfidence = next.nodes.length === 0 ? 1 : next.nodes.filter((node) => before.has(node.ref)).length / next.nodes.length;
  const changeRatio = changes.length / Math.max(1, Math.max(base.nodes.length, next.nodes.length));
  const identityLow = next.nodes.length > 8 && identityConfidence < 0.4;
  const overBudget = changes.length > 100 || changes.length > 20 && changeRatio > 0.65;
  return {
    changes,
    changedNodeCount: changes.length,
    fullNodeCount: next.nodes.length,
    useFullView: identityLow || overBudget,
    reason: identityLow ? "identity_confidence_low" : overBudget ? "change_budget_exceeded" : void 0
  };
}
function label(node) {
  return node.title || node.description || node.value || node.identifier || node.text.map((item) => item.string).join(" ").trim() || node.role || "node";
}
function renderChanges(changes) {
  return changes.map((change) => {
    if (change.type === "added") return `+ ${change.ref}${change.parent ? ` under ${change.parent}` : ""} ${JSON.stringify(label(change.node))}`;
    if (change.type === "removed") return `- ${change.ref}${change.parent ? ` from ${change.parent}` : ""}`;
    const fields = Object.entries(change.fields).filter(([key]) => !["rect", "text", "actions"].includes(key)).slice(0, 6).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ");
    const supplemental = [
      change.fields.text ? `text=${JSON.stringify(change.fields.text.map((item) => item.string))}` : void 0,
      change.fields.actions ? `actions=${JSON.stringify(change.fields.actions)}` : void 0
    ].filter(Boolean).join(", ");
    return `~ ${change.ref} (${change.path.join(" > ")}) ${[fields, supplemental].filter(Boolean).join(", ") || "changed"}`;
  }).join("\n");
}

// ../../node_modules/@injaneity/pi-computer-use/src/bridge.ts
var MISSING_TARGET_ERROR = "No current controlled window. Call observe_ui first to choose a target window.";
var CURRENT_TARGET_GONE_ERROR = "The current controlled window is no longer available. Call observe_ui to choose a new target window.";
var COMMAND_TIMEOUT_MS5 = 15e3;
var LOOK_TIMEOUT_MS = 33e3;
var ACTION_SETTLE_MS = 280;
var BROWSER_CONTEXT_PREFIX = "browser:";
var MANAGED_BROWSER_READY_TIMEOUT_MS = 15e3;
var AUTO_IMAGE_MAX_DIMENSION = 900;
var EXPLICIT_IMAGE_MAX_DIMENSION = 1600;
var BROWSER_TRANSACTION_ACTIONS = /* @__PURE__ */ new Set(["press", "click", "setText", "typeText", "keypress", "scroll", "drag", "moveMouse"]);
var runtimeState = {
  lastPermissionCheckAt: 0,
  windowRefs: /* @__PURE__ */ new Map(),
  windowRefByIdentity: /* @__PURE__ */ new Map(),
  browserRootByContext: /* @__PURE__ */ new Map(),
  browserContextByRoot: /* @__PURE__ */ new Map(),
  nextRootRefIndex: 1
};
var savedStates = new SavedStates();
var resourceScheduler = new ResourceScheduler();
function operationState() {
  return savedStates.current();
}
function desktopResourceKey(target) {
  return `desktop-pid:${target.pid}`;
}
function persistOperation(state) {
  if (!state.currentTarget || !state.currentCapture || !state.currentLook || !state.currentOutline) return;
  const resourceKey = state.resourceKey ?? desktopResourceKey(state.currentTarget);
  const epoch = state.epoch ?? resourceScheduler.epoch(resourceKey);
  savedStates.saveDesktop(state, resourceKey, epoch);
}
async function shutdownComputerUseSession() {
  await resourceScheduler.close();
  resourceScheduler = new ResourceScheduler();
  disconnectCdp();
  const managedBrowser = runtimeState.managedBrowser;
  runtimeState.managedBrowser = void 0;
  if (managedBrowser) {
    managedBrowser.kill("SIGTERM");
    managedBrowser.unref();
  }
  if (runtimeState.managedBrowserCdpPort && process.env.PI_COMPUTER_USE_CDP_PORT === runtimeState.managedBrowserCdpPort) {
    if (runtimeState.previousCdpPort === void 0) delete process.env.PI_COMPUTER_USE_CDP_PORT;
    else process.env.PI_COMPUTER_USE_CDP_PORT = runtimeState.previousCdpPort;
  }
  runtimeState.managedBrowserCdpPort = void 0;
  runtimeState.previousCdpPort = void 0;
  savedStates.clear();
  clearStoredOutputs();
  runtimeState.windowRefs.clear();
  runtimeState.windowRefByIdentity.clear();
  runtimeState.browserRootByContext.clear();
  runtimeState.browserContextByRoot.clear();
  runtimeState.nextRootRefIndex = 1;
  runtimeState.permissionStatus = void 0;
  runtimeState.helperDiagnostics = void 0;
  runtimeState.lastPermissionCheckAt = 0;
  await currentPlatformBackend.shutdown?.();
}
function currentRuntimeMode() {
  return isHeadlessMode() ? "stealth" : "default";
}
function currentDeliveryPolicy() {
  if (isHeadlessMode()) return "background";
  const value = (process.env.PI_COMPUTER_USE_DELIVERY_POLICY ?? process.env.PI_COMPUTER_USE_EVENT_DELIVERY ?? "default").toLowerCase();
  return value === "background" || value === "pid" ? "background" : value === "foreground" || value === "hid" ? "foreground" : value === "ax_only" || value === "ax-only" ? "ax_only" : "default";
}
function nativeInputDelivery(policy = currentDeliveryPolicy()) {
  return policy === "foreground" ? "hid" : "pid";
}
function executionTrace(strategy, variant, metadata = {}) {
  return {
    strategy,
    runtimeMode: currentRuntimeMode(),
    variant,
    stealthCompatible: variant === "stealth",
    ...metadata
  };
}
function settleMsForExecution(execution) {
  if (execution.performed?.deltaSource) return 0;
  if (execution.variant === "stealth") {
    switch (execution.strategy) {
      case "browser_open_location":
        return 120;
      default:
        return 120;
    }
  }
  return ACTION_SETTLE_MS;
}
function throwIfAborted3(signal) {
  if (signal?.aborted) {
    throw new Error("Operation aborted.");
  }
}
async function sleep2(ms, signal) {
  if (ms <= 0) return;
  throwIfAborted3(signal);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new Error("Operation aborted."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function withWindowWriteLock(target, work) {
  const state = operationState();
  const key = desktopResourceKey(target);
  const baseEpoch = state.epoch ?? resourceScheduler.epoch(key);
  const result = await resourceScheduler.write(key, baseEpoch, async (nextEpoch) => {
    state.resourceKey = key;
    state.epoch = nextEpoch;
    return await work();
  });
  return result.value;
}
function trimOrUndefined(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}
function normalizeText2(value) {
  return (value ?? "").trim().toLowerCase();
}
function toBoolean3(value) {
  return value === true;
}
function outlineNodeCenter(node) {
  if (!node.rect) {
    throw new Error(`Outline ref '${node.ref}' has no full-look coordinates after scoped expansion. Re-observe for coordinates.`);
  }
  return { x: node.rect.x + node.rect.w / 2, y: node.rect.y + node.rect.h / 2 };
}
function validateStateId(stateId2) {
  const state = operationState();
  if (!state.currentCapture) {
    throw new Error("No observation state is available. Call observe_ui first.");
  }
  const supplied = stateId2;
  if (supplied && state.currentCapture.stateId !== supplied) {
    throw new Error(
      `Stale state '${supplied}'. The active operation state is '${state.currentCapture.stateId}'. Observe the root again and retry.`
    );
  }
  const stateTarget = state.currentStateTarget;
  if (stateTarget && state.currentTarget && (stateTarget.pid !== state.currentTarget.pid || stateTarget.windowId !== state.currentTarget.windowId)) {
    throw new Error("The latest state belongs to a different window. Call observe_ui for the target window and retry.");
  }
  return state.currentCapture;
}
function formatOutlineNodeLabel(node) {
  const label2 = outlineNodeLabel(node) || "(unlabeled)";
  const identifier = node.identifier ? ` id=${JSON.stringify(node.identifier)}` : "";
  const capabilities = [
    node.canSetValue ? "setValue" : void 0,
    node.canPress ? "press" : void 0,
    node.canFocus ? "focus" : void 0,
    node.canScroll ? "scroll" : void 0,
    node.canIncrement || node.canDecrement ? "adjust" : void 0,
    node.pictureOnly ? "pictureOnly" : void 0
  ].filter((item) => Boolean(item));
  return `${node.ref} ${node.role}${node.subrole ? `/${node.subrole}` : ""}${identifier} ${JSON.stringify(label2)}${capabilities.length ? ` [${capabilities.join(",")}]` : ""}`;
}
function outlineNodeByRef(ref) {
  const state = operationState();
  const outline = state.currentOutline;
  const node = outline ? nodeByRef(outline, ref) : void 0;
  if (!node) {
    const windowHint = state.currentTarget?.windowRef ? `({ root: "${state.currentTarget.windowRef}" })` : "";
    throw new Error(`Outline ref '${ref}' is stale or not available for the latest state. Call observe_ui${windowHint} again and choose a current @e ref.`);
  }
  return node;
}
function wireRefForNode(node) {
  if (node.pictureOnly || !node.wireRef) {
    throw new Error(`Outline ref '${node.ref}' is pictureOnly and has no semantic element. It can be clicked by coordinates, but semantic-only actions are not available.`);
  }
  return node.wireRef;
}
function imageFallbackReason(tool, result, imageMode = "auto") {
  if (imageMode === "never") return void 0;
  if (imageMode === "always") return { reason: "fallback_recovery", message: "An image was requested explicitly for visual verification." };
  const outline = result.outline;
  const labeled = outline.nodes.filter((node) => outlineNodeLabel(node)).length;
  if (outline.nodes.length < 3) {
    return { reason: "sparse_ax_targets", message: "Only a few outline nodes were found, so the look image is attached for context." };
  }
  if (labeled * 3 < outline.nodes.length) {
    return { reason: "unlabeled_ax_targets", message: "Most outline nodes are unlabeled, so the look image is attached for context." };
  }
  if (tool === "wait" && currentPlatformBackend.isBrowserApp(result.target.appName, result.target.bundleId)) {
    return { reason: "browser_wait_verification", message: "Browser content may have changed visually during wait, so an image is attached for fallback." };
  }
  return void 0;
}
function currentTargetOrThrow() {
  const target = operationState().currentTarget;
  if (!target) {
    throw new Error(MISSING_TARGET_ERROR);
  }
  return target;
}
function emptyActivation() {
  return { activated: false, unminimized: false, raised: false };
}
async function ensureReady3(ctx, signal) {
  loadComputerUseConfig(ctx.cwd);
  throwIfAborted3(signal);
  const ready = await currentPlatformBackend.ensureReady(
    ctx,
    {
      permissionStatus: runtimeState.permissionStatus,
      lastPermissionCheckAt: runtimeState.lastPermissionCheckAt,
      helperDiagnostics: runtimeState.helperDiagnostics
    },
    signal
  );
  runtimeState.permissionStatus = ready.permissionStatus;
  runtimeState.lastPermissionCheckAt = ready.lastPermissionCheckAt;
  runtimeState.helperDiagnostics = ready.helperDiagnostics;
}
async function ensureComputerUseSetup(ctx, signal) {
  await ensureReady3(ctx, signal);
}
async function listApps(signal) {
  return await currentPlatformBackend.listApps(signal);
}
async function listWindows(pid, signal) {
  return await currentPlatformBackend.listRoots({ pid }, signal);
}
function appMatchesWindowQuery(app, query) {
  const appQuery = trimOrUndefined(query.app);
  const bundleQuery = trimOrUndefined(query.bundleId);
  const pidQuery = Number.isFinite(query.pid) ? Math.trunc(query.pid) : void 0;
  if (pidQuery !== void 0 && app.pid !== pidQuery) return false;
  if (bundleQuery && normalizeText2(app.bundleId ?? "") !== normalizeText2(bundleQuery)) return false;
  if (appQuery && normalizeText2(app.appName) !== normalizeText2(appQuery)) return false;
  return true;
}
function platformRootSheetCount(window) {
  const value = window.metadata?.sheetCount;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : void 0;
}
function platformRootPairing(window) {
  const value = window.metadata?.pairing;
  if (!value || typeof value !== "object") return void 0;
  const pairing = value;
  if (pairing.confidence !== "exact" && pairing.confidence !== "high" && pairing.confidence !== "low") return void 0;
  return { confidence: pairing.confidence, score: typeof pairing.score === "number" && Number.isFinite(pairing.score) ? pairing.score : Number.NEGATIVE_INFINITY };
}
function formatWindowLine(window) {
  if (window.kind === "browser_page") return `- ${window.windowRef} browser_page ${JSON.stringify(window.windowTitle)}${window.url ? ` \u2014 ${window.url}` : ""}`;
  const flags = [
    window.isFocused ? "focused" : void 0,
    window.isMain ? "main" : void 0,
    window.isModal ? "modal" : void 0,
    window.sheetCount ? `sheets=${window.sheetCount}` : void 0,
    window.isOnscreen ? "onscreen" : void 0,
    window.isMinimized ? "minimized" : void 0,
    window.browserUseAllowed ? void 0 : "browser_use_disabled"
  ].filter(Boolean).join(", ");
  const frame = `${Math.round(window.framePoints.x)},${Math.round(window.framePoints.y)} ${Math.round(window.framePoints.w)}x${Math.round(window.framePoints.h)}`;
  const id = window.windowId ? `windowId ${window.windowId}` : window.nativeWindowRef ? `nativeRootRef ${window.nativeWindowRef}` : "unstable root id";
  const pairing = window.pairing ? `, pairing ${window.pairing.confidence}/${Math.round(window.pairing.score)}` : "";
  return `- ${window.windowRef} ${window.kind} ${window.app} pid ${window.pid} \u2014 ${window.windowTitle || "(untitled)"} (z ${window.zOrder}, ${id}, frame ${frame}${pairing}${flags ? `, ${flags}` : ""})`;
}
async function getFrontmost(signal) {
  return await currentPlatformBackend.getFrontmost(signal);
}
function assertBrowserUseAllowed(target) {
  if (!isBrowserUseEnabled() && currentPlatformBackend.isBrowserApp(target.appName, target.bundleId)) {
    throw new Error(
      `Browser use is disabled by pi-computer-use config, so '${target.appName}' cannot be controlled. Enable browser_use in ~/.pi/agent/extensions/pi-computer-use.json or .pi/computer-use.json to allow browser windows.`
    );
  }
}
function windowRecordIdentity(record) {
  if (record.windowId && record.windowId > 0) {
    return `pid:${record.pid}|id:${record.windowId}`;
  }
  if (record.nativeWindowRef) {
    return `pid:${record.pid}|ref:${record.nativeWindowRef}`;
  }
  const { x, y, w, h } = record.framePoints;
  return `pid:${record.pid}|title:${normalizeText2(record.windowTitle)}|frame:${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)}`;
}
function storeWindowRef(record) {
  const identity = windowRecordIdentity(record);
  const existingRef = runtimeState.windowRefByIdentity.get(identity);
  if (existingRef) {
    const existing = runtimeState.windowRefs.get(existingRef);
    if (existing) {
      const updated = { ...record, ref: existingRef };
      runtimeState.windowRefs.set(existingRef, updated);
      return updated;
    }
  }
  const ref = `@r${runtimeState.nextRootRefIndex++}`;
  const stored = { ...record, ref };
  runtimeState.windowRefByIdentity.set(identity, ref);
  runtimeState.windowRefs.set(ref, stored);
  return stored;
}
function storeBrowserRootRef(contextId) {
  const existing = runtimeState.browserRootByContext.get(contextId);
  if (existing) return existing;
  const ref = `@r${runtimeState.nextRootRefIndex++}`;
  runtimeState.browserRootByContext.set(contextId, ref);
  runtimeState.browserContextByRoot.set(ref, contextId);
  return ref;
}
function storeWindowRefForTarget(target) {
  return storeWindowRef({
    appName: target.appName,
    bundleId: target.bundleId,
    pid: target.pid,
    windowTitle: target.windowTitle,
    windowId: target.windowId > 0 ? target.windowId : void 0,
    framePoints: target.framePoints,
    scaleFactor: target.scaleFactor,
    isMinimized: target.isMinimized,
    isOnscreen: target.isOnscreen,
    isMain: target.isMain,
    isFocused: target.isFocused
  }).ref;
}
function storeWindowRefForAppWindow(app, window) {
  return storeWindowRef({
    appName: app.appName,
    bundleId: app.bundleId,
    pid: app.pid,
    windowTitle: window.title || "(untitled)",
    windowId: window.windowId,
    nativeWindowRef: window.windowRef,
    framePoints: window.framePoints,
    scaleFactor: window.scaleFactor,
    isMinimized: window.isMinimized,
    isOnscreen: window.isOnscreen,
    isMain: window.isMain,
    isFocused: window.isFocused
  });
}
function choosePreferredWindow(windows, appName) {
  if (!windows.length) {
    throw new Error(`No controllable root was found in app '${appName}'.`);
  }
  const scored = [...windows].sort((a, b) => scoreWindow(b) - scoreWindow(a));
  return scored[0];
}
function scoreWindow(window) {
  let score = 0;
  if (window.isModal) score += 180;
  if (window.isFocused) score += 100;
  if (window.isMain) score += 80;
  if (!window.isMinimized) score += 40;
  if (window.isOnscreen) score += 20;
  if (window.windowId && window.windowId > 0) score += 10;
  if (window.title.trim().length > 0) score += 2;
  return score;
}
function summarizeWindowCandidate(window) {
  const flags = [
    window.isFocused ? "focused" : void 0,
    window.isMain ? "main" : void 0,
    window.isOnscreen ? "onscreen" : void 0,
    window.isMinimized ? "minimized" : void 0
  ].filter(Boolean).join(",");
  return `${window.title || "(untitled)"} [score=${scoreWindow(window)}${flags ? `, ${flags}` : ""}]`;
}
function summarizeWindowCandidates(windows, limit = 6) {
  return [...windows].sort((a, b) => scoreWindow(b) - scoreWindow(a)).slice(0, limit).map(summarizeWindowCandidate).join("; ");
}
function chooseRankedWindowOrUndefined(windows) {
  if (windows.length === 0) return void 0;
  const ranked = [...windows].sort((a, b) => scoreWindow(b) - scoreWindow(a));
  if (ranked.length === 1) return ranked[0];
  const topScore = scoreWindow(ranked[0]);
  const nextScore = scoreWindow(ranked[1]);
  return topScore >= nextScore + 25 ? ranked[0] : void 0;
}
function toResolvedTarget(app, window) {
  const baseTarget = {
    appName: app.appName,
    bundleId: app.bundleId,
    pid: app.pid,
    windowTitle: window.title || "(untitled)",
    windowId: typeof window.windowId === "number" ? window.windowId : 0,
    nativeWindowRef: window.windowRef,
    framePoints: window.framePoints,
    scaleFactor: window.scaleFactor,
    isMinimized: window.isMinimized,
    isOnscreen: window.isOnscreen,
    isMain: window.isMain,
    isFocused: window.isFocused
  };
  return { ...baseTarget, windowRef: storeWindowRefForAppWindow(app, window).ref };
}
function nativeWindowRequest(target) {
  return { pid: target.pid, windowId: target.windowId, windowRef: target.nativeWindowRef };
}
function setCurrentTarget(target) {
  assertBrowserUseAllowed(target);
  const windowRef = target.windowRef ?? storeWindowRefForTarget(target);
  operationState().currentTarget = {
    appName: target.appName,
    bundleId: target.bundleId,
    pid: target.pid,
    windowTitle: target.windowTitle,
    windowId: target.windowId,
    windowRef,
    nativeWindowRef: target.nativeWindowRef
  };
}
function normalizeWindowSelector(selector) {
  if (typeof selector === "number" && Number.isFinite(selector)) return String(Math.trunc(selector));
  if (typeof selector === "string") return trimOrUndefined(selector);
  return void 0;
}
async function resolveTargetByWindowSelector(selector, signal) {
  const normalized = normalizeWindowSelector(selector);
  if (!normalized) {
    throw new Error("root target must be a non-empty @r ref or numeric windowId.");
  }
  const current = operationState().currentTarget;
  if (current?.windowRef === normalized) {
    return await resolveCurrentTarget(signal);
  }
  const fromRef = runtimeState.windowRefs.get(normalized);
  if (fromRef) {
    const app2 = { appName: fromRef.appName, bundleId: fromRef.bundleId, pid: fromRef.pid };
    const windows = await listWindows(fromRef.pid, signal);
    const match2 = (fromRef.windowId ? windows.find((window) => window.windowId === fromRef.windowId) : void 0) ?? (fromRef.nativeWindowRef ? windows.find((window) => window.windowRef === fromRef.nativeWindowRef) : void 0) ?? windows.find((window) => normalizeText2(window.title || "(untitled)") === normalizeText2(fromRef.windowTitle));
    if (!match2) {
      throw new Error(`Root ref '${normalized}' is stale. Call find_roots again and choose a current window.`);
    }
    const resolved2 = toResolvedTarget(app2, match2);
    setCurrentTarget(resolved2);
    return resolved2;
  }
  const numericWindowId = Number(normalized);
  if (Number.isInteger(numericWindowId) && numericWindowId > 0) {
    const apps = await listApps(signal);
    for (const app2 of apps) {
      const windows = await listWindows(app2.pid, signal);
      const match2 = windows.find((window) => window.windowId === numericWindowId);
      if (match2) {
        assertBrowserUseAllowed(app2);
        const resolved2 = toResolvedTarget(app2, match2);
        setCurrentTarget(resolved2);
        return resolved2;
      }
    }
    throw new Error(`Window id '${numericWindowId}' was not found. Call find_roots again and choose a current window.`);
  }
  if (normalized.startsWith("@r")) {
    throw new Error(`Root ref '${normalized}' is not available in this session. Call find_roots first.`);
  }
  const config = getComputerUseConfig();
  const candidates = await collectWindowDetails(await listApps(signal), config, signal);
  const query = normalizeText2(normalized);
  const exact = candidates.filter((candidate) => normalizeText2(candidate.app) === query || normalizeText2(candidate.windowTitle) === query);
  const fuzzy = exact.length > 0 ? exact : candidates.filter((candidate) => `${normalizeText2(candidate.app)} ${normalizeText2(candidate.windowTitle)}`.includes(query));
  const match = fuzzy.sort((a, b) => Number(b.isFocused) - Number(a.isFocused) || a.zOrder - b.zOrder)[0];
  if (!match) throw new Error(`Root query '${normalized}' did not match any current root. Call find_roots to inspect roots.`);
  const app = { appName: match.app, bundleId: match.bundleId, pid: match.pid };
  const roots = await listWindows(match.pid, signal);
  const helperRoot = roots.find((root) => root.rootRef === match.nativeWindowRef || root.windowRef === match.nativeWindowRef || root.windowId === match.windowId) ?? roots[0];
  const resolved = toResolvedTarget(app, helperRoot);
  setCurrentTarget(resolved);
  return resolved;
}
function shouldPreferForegroundModalWindow(current, candidate) {
  if (candidate.windowId === current.windowId && candidate.windowRef === current.windowRef) return false;
  if (!candidate.isOnscreen || candidate.isMinimized) return false;
  if (candidate.isModal) return scoreWindow(candidate) >= scoreWindow(current);
  return false;
}
async function resolveCurrentTarget(signal) {
  const current = currentTargetOrThrow();
  const windows = await listWindows(current.pid, signal);
  if (!windows.length) {
    throw new Error(CURRENT_TARGET_GONE_ERROR);
  }
  const hadStableWindowId = current.windowId > 0;
  const titleQuery = normalizeText2(current.windowTitle);
  let match = current.nativeWindowRef ? windows.find((window) => window.windowRef === current.nativeWindowRef || window.rootRef === current.nativeWindowRef) : void 0;
  match ??= hadStableWindowId ? windows.find((window) => window.windowId !== void 0 && window.windowId === current.windowId) : void 0;
  if (!match) {
    const exactTitleMatches = titleQuery && titleQuery !== "(untitled)" ? windows.filter((window) => normalizeText2(window.title) === titleQuery) : [];
    if (exactTitleMatches.length === 1) {
      match = exactTitleMatches[0];
    } else if (exactTitleMatches.length > 1) {
      match = chooseRankedWindowOrUndefined(exactTitleMatches);
      if (!match) {
        throw new Error(
          `${CURRENT_TARGET_GONE_ERROR} Multiple windows now match '${current.windowTitle}': ${summarizeWindowCandidates(exactTitleMatches)}.`
        );
      }
    }
  }
  if (!match && !hadStableWindowId) {
    match = chooseRankedWindowOrUndefined(windows);
  }
  if (!match) {
    throw new Error(CURRENT_TARGET_GONE_ERROR);
  }
  const modal = windows.filter((window) => shouldPreferForegroundModalWindow(match, window)).sort((a, b) => scoreWindow(b) - scoreWindow(a))[0];
  if (modal) match = modal;
  const app = {
    appName: current.appName,
    bundleId: current.bundleId,
    pid: current.pid
  };
  const resolved = toResolvedTarget(app, match);
  setCurrentTarget(resolved);
  return resolved;
}
async function resolveFrontmostTarget(signal) {
  const frontmost = await getFrontmost(signal);
  const apps = await listApps(signal);
  const app = apps.find((candidate) => candidate.pid === frontmost.pid) ?? {
    appName: frontmost.appName,
    bundleId: frontmost.bundleId,
    pid: frontmost.pid
  };
  const windows = await listWindows(frontmost.pid, signal);
  if (!windows.length) {
    throw new Error("No frontmost controllable root was found. Open an app window and call observe_ui again.");
  }
  if (currentPlatformBackend.isBrowserApp(app.appName, app.bundleId)) {
    assertBrowserUseAllowed(app);
  }
  let selected = windows.find((window) => window.windowId !== void 0 && window.windowId === frontmost.windowId);
  if (!selected && frontmost.windowTitle) {
    selected = windows.find((window) => normalizeText2(window.title) === normalizeText2(frontmost.windowTitle));
  }
  selected ??= choosePreferredWindow(windows, app.appName);
  const resolved = toResolvedTarget(app, selected);
  setCurrentTarget(resolved);
  return resolved;
}
function matchesObserveSelection(target, selection) {
  const root = normalizeWindowSelector(selection.root);
  return !root || target.windowRef === root;
}
async function resolveTargetForObserve(signal) {
  return operationState().currentTarget ? await resolveCurrentTarget(signal) : await resolveFrontmostTarget(signal);
}
async function ensureTargetWindowId(target, signal) {
  if (target.windowId > 0 || target.nativeWindowRef) {
    return target;
  }
  const refreshed = await resolveCurrentTarget(signal);
  if (refreshed.windowId <= 0 && !refreshed.nativeWindowRef) {
    throw new Error(CURRENT_TARGET_GONE_ERROR);
  }
  return refreshed;
}
function captureForLook(look) {
  return {
    stateId: randomUUID5(),
    width: look.image?.width ?? 0,
    height: look.image?.height ?? 0,
    scaleFactor: look.window.scaleFactor,
    timestamp: Date.now()
  };
}
async function performLook(target, options, signal) {
  if ((!Number.isFinite(target.windowId) || target.windowId <= 0) && !target.nativeWindowRef) throw new Error(`Current platform requires a stable root id to observe '${target.windowTitle}'. Call find_roots and select a root with a stable id.`);
  return await currentPlatformBackend.observe({
    target: nativeWindowRequest(target),
    baseLookId: options.baseLookId,
    readText: options.readText,
    scopeRef: options.scopeRef,
    maxDimension: options.maxDimension,
    includeImage: options.includeImage
  }, { signal, timeoutMs: LOOK_TIMEOUT_MS });
}
function noteWindowForTarget(target, look) {
  return {
    windowRef: target.windowRef,
    title: target.windowTitle,
    pairing: look?.window.metadata?.pairing && typeof look.window.metadata.pairing === "object" ? look.window.metadata.pairing.confidence : void 0,
    pairingScore: look?.window.metadata?.pairing && typeof look.window.metadata.pairing === "object" ? look.window.metadata.pairing.score : void 0
  };
}
async function captureCurrentTarget(signal, readText = "auto", maxDimension = AUTO_IMAGE_MAX_DIMENSION, targetOverride, includeImage = true) {
  const state = operationState();
  const baseOutline = state.currentOutline;
  const baseTarget = state.currentTarget;
  let target = targetOverride ?? await resolveCurrentTarget(signal);
  target = await ensureTargetWindowId(target, signal);
  const look = await performLook(target, { maxDimension, readText, includeImage }, signal);
  const outline = stabilizeRefs(baseTarget && sameRootIdentity(baseTarget, target) ? baseOutline : void 0, look.parsedOutline);
  look.parsedOutline = outline;
  look.outline = outline.root;
  const capture = captureForLook(look);
  setCurrentTarget(target);
  state.currentCapture = capture;
  state.currentStateTarget = { pid: target.pid, windowId: target.windowId, windowRef: target.windowRef };
  state.currentLook = look;
  state.currentOutline = outline;
  state.currentNote = noteFromLook(state.currentNote, outline, noteWindowForTarget(target, look));
  state.resourceKey = desktopResourceKey(target);
  state.epoch ??= resourceScheduler.epoch(state.resourceKey);
  return {
    target,
    capture,
    look,
    outline,
    activation: emptyActivation()
  };
}
async function buildToolResult(tool, summary, result, execution, _signal, imageMode = operationState().currentImageMode ?? "auto", base) {
  const state = operationState();
  const fallbackReason = imageFallbackReason(tool, result, imageMode);
  const transition = base ? changesBetween(base.outline, result.outline) : void 0;
  const useDiff = Boolean(transition && !transition.useFullView);
  const folded = foldToBudget(result.outline);
  const renderedNote = renderNote(state.currentNote);
  const details = {
    tool,
    target: {
      app: result.target.appName,
      bundleId: result.target.bundleId,
      pid: result.target.pid,
      windowTitle: result.target.windowTitle,
      windowId: result.target.windowId,
      windowRef: result.target.windowRef ?? state.currentTarget?.windowRef,
      nativeWindowRef: result.target.nativeWindowRef ?? state.currentTarget?.nativeWindowRef
    },
    capture: {
      stateId: result.capture.stateId,
      width: result.capture.width,
      height: result.capture.height,
      scaleFactor: result.capture.scaleFactor,
      timestamp: result.capture.timestamp,
      coordinateSpace: "window-relative-screenshot-pixels"
    },
    lookId: result.look.lookId,
    view: useDiff ? "diff" : "full",
    baseStateId: transition ? base?.stateId : void 0,
    changes: useDiff ? transition?.changes : void 0,
    viewReason: transition?.useFullView ? transition.reason : void 0,
    renderedOutline: folded.text,
    outline: serializeOutline(result.outline),
    note: state.currentNote,
    activation: result.activation,
    execution,
    status: "ok",
    config: getComputerUseConfig(),
    helper: runtimeState.helperDiagnostics,
    imageReason: fallbackReason?.reason
  };
  let consoleText = "";
  if (currentPlatformBackend.isChromeFamilyApp(result.target.appName, result.target.bundleId)) {
    const tab = await cdpTabForWindow(result.target.windowTitle, result.target.framePoints);
    const entries = tab?.drainConsole() ?? [];
    if (entries.length > 0) {
      details.console = entries;
      consoleText = `

Browser console since the last action:
${entries.map((entry) => `[${entry.level}] ${entry.text}`).join("\n")}`;
    }
  }
  const noteText = renderedNote ? `

${renderedNote}` : "";
  const renderedChanges = useDiff ? renderChanges(transition.changes) : "";
  const outlineText = useDiff ? `

Changes (${transition.changedNodeCount}, ${base.stateId} \u2192 ${result.capture.stateId}):
${renderedChanges || "(no element changes)"}
Use stateId ${result.capture.stateId} for subsequent actions and queries.` : `

Outline (${folded.nodeCount} nodes, stateId ${result.capture.stateId}${transition?.reason ? `, full view: ${transition.reason}` : ""}${folded.truncated ? ", folded output truncated" : ""}):
${folded.text}`;
  const fallbackText = fallbackReason ? `

${fallbackReason.message}` : "";
  const deltaText = rootDeltaLines(execution).join("\n");
  const content = [{ type: "text", text: `${summary}${deltaText ? `
${deltaText}` : ""}${consoleText}${noteText}${outlineText}${fallbackText}` }];
  if (fallbackReason && result.look.image?.jpegBase64) {
    content.push({ type: "image", data: result.look.image.jpegBase64, mimeType: result.look.image.mimeType ?? "image/jpeg" });
  }
  return { content, details };
}
function currentLookOrThrow() {
  const state = operationState();
  if (!state.currentLook || !state.currentCapture) {
    throw new Error("No current look. Call observe_ui first, then act using refs or coordinates from that look.");
  }
  return state.currentLook;
}
function ensurePointIsInLookImage(x, y, look, errorPrefix = "Coordinates") {
  if (!look.image?.jpegBase64) {
    throw new Error(`${errorPrefix} require an image-bearing root. This look is outline-only; use an @e ref with a semantic action or observe an image-bearing root.`);
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${errorPrefix} must be finite numbers.`);
  }
  if (x < 0 || y < 0 || x >= look.image.width || y >= look.image.height) {
    throw new Error(`${errorPrefix} (${Math.round(x)},${Math.round(y)}) are outside the latest look image bounds (${look.image.width}x${look.image.height}). Call observe_ui again and retry.`);
  }
}
function modelRefForRootDelta(delta) {
  if (!delta.ref) return void 0;
  if (delta.ref.startsWith("@r")) return delta.ref;
  for (const record2 of runtimeState.windowRefs.values()) {
    if (record2.nativeWindowRef === delta.ref || record2.ref === delta.ref) return record2.ref;
  }
  const ref = `@r${runtimeState.nextRootRefIndex++}`;
  const current = operationState().currentTarget;
  const record = {
    ref,
    appName: current?.pid === delta.pid ? current.appName : "Unknown App",
    bundleId: current?.pid === delta.pid ? current.bundleId : void 0,
    pid: delta.pid,
    windowTitle: delta.title ?? "(untitled)",
    nativeWindowRef: delta.ref,
    framePoints: { x: 0, y: 0, w: 1, h: 1 },
    scaleFactor: 1,
    isMinimized: false,
    isOnscreen: true,
    isMain: false,
    isFocused: delta.change === "focused"
  };
  runtimeState.windowRefs.set(ref, record);
  runtimeState.windowRefByIdentity.set(windowRecordIdentity(record), ref);
  return ref;
}
function executionTraceFromAct(result, policy = currentDeliveryPolicy()) {
  const rootDelta = result.rootDelta?.map((delta) => ({ ...delta, ref: modelRefForRootDelta(delta) }));
  return executionTrace("act", result.performed?.delivery === "ax" ? "stealth" : "default", {
    outcome: result.outcome,
    performed: result.performed,
    evidence: result.evidence,
    error: result.error,
    stoppedAt: result.stoppedAt,
    rootDelta,
    delivery: result.performed?.delivery,
    deliveryPolicy: policy
  });
}
async function helperAct(target, action, headless, signal) {
  const checked = (candidate) => {
    if (!candidate || !["worked", "didnt", "unknown"].includes(candidate.outcome)) {
      throw new Error("Helper act returned an invalid result without an outcome.");
    }
    return candidate;
  };
  const textTimeout = "text" in action.params ? action.params.text.length * 25 + 4e3 : COMMAND_TIMEOUT_MS5;
  const timeoutMs = Math.max(COMMAND_TIMEOUT_MS5, textTimeout);
  if ((action.usesCurrentFocus || action.needsForeground) && !headless) {
    const foreground = checked(await currentPlatformBackend.act(helperActRequest(target, action, "foreground"), { signal, timeoutMs }));
    const trace = executionTraceFromAct(foreground, "foreground");
    trace.backgroundFirst = false;
    return trace;
  }
  try {
    const initialPolicy = headless ? "ax_only" : "background";
    const result = checked(await currentPlatformBackend.act(helperActRequest(target, action, initialPolicy), { signal, timeoutMs }));
    if (canRetryInForeground(action, result.outcome, headless)) {
      const foreground = checked(await currentPlatformBackend.act(helperActRequest(target, action, "foreground"), { signal, timeoutMs }));
      const trace2 = executionTraceFromAct(foreground, "foreground");
      trace2.backgroundFirst = true;
      trace2.escalatedToForeground = true;
      trace2.escalationReason = "side_effect_free_didnt";
      trace2.backgroundAttempt = { outcome: "didnt", reason: "Background input produced no observable value change; a foreground retry was safe." };
      return trace2;
    }
    const trace = executionTraceFromAct(result, "background");
    trace.backgroundFirst = true;
    return trace;
  } catch (error) {
    const code = error?.code;
    if (code !== "foreground_required" || headless) throw error;
    const foreground = checked(await currentPlatformBackend.act(helperActRequest(target, action, "foreground"), { signal, timeoutMs }));
    const trace = executionTraceFromAct(foreground, "foreground");
    trace.backgroundFirst = true;
    trace.escalatedToForeground = true;
    trace.escalationReason = code;
    trace.backgroundAttempt = { outcome: "foreground_required", reason: error instanceof Error ? error.message : String(error) };
    return trace;
  }
}
function helperActRequest(target, action, policy = currentDeliveryPolicy()) {
  const look = currentLookOrThrow();
  const delivery = nativeInputDelivery(policy);
  const base = { lookId: look.lookId, pid: target.pid, target: action.target, policy };
  return (() => {
    switch (action.action) {
      case "press":
      case "click":
        return { ...base, action: action.action, params: { ...action.params, delivery } };
      case "setText":
        return { ...base, action: action.action, params: { text: action.params.text, delivery } };
      case "typeText":
        return { ...base, action: action.action, params: { text: action.params.text, delivery } };
      case "keypress":
        return { ...base, action: action.action, params: { keys: action.params.keys, delivery } };
      case "scroll":
        return { ...base, action: action.action, params: { scrollX: action.params.scrollX, scrollY: action.params.scrollY, delivery } };
      case "drag":
        return { ...base, action: action.action, params: { path: action.params.path, delivery } };
      case "moveMouse":
        return { ...base, action: action.action, params: { delivery } };
    }
  })();
}
function rootDeltaLines(execution) {
  return (execution.rootDelta ?? []).map((delta) => {
    const quotedTitle = delta.title ? ` ${JSON.stringify(delta.title)}` : "";
    const ref = delta.ref ? ` (${delta.ref.startsWith("@") ? delta.ref : `@${delta.ref}`})` : "";
    const sheetCount = typeof delta.metadata?.sheetCount === "number" && Number.isFinite(delta.metadata.sheetCount) ? Math.max(0, Math.trunc(delta.metadata.sheetCount)) : void 0;
    const flags = [delta.isModal ? "modal" : void 0, sheetCount ? `sheets=${sheetCount}` : void 0].filter(Boolean).join(", ");
    const suffix = `${quotedTitle}${flags ? ` (${flags})` : ""}${ref}`;
    if (delta.change === "appeared") return `New root: ${delta.kind}${suffix}`;
    if (delta.change === "closed") return `Root closed: ${delta.kind}${suffix}`;
    return `Root focused: ${delta.kind}${suffix}`;
  });
}
function windowDetails(app, window, config) {
  const storedRef = storeWindowRefForAppWindow(app, window);
  return {
    app: app.appName,
    bundleId: app.bundleId,
    pid: app.pid,
    kind: window.kind,
    windowTitle: window.title || "(untitled)",
    windowId: window.windowId,
    windowRef: storedRef.ref,
    nativeWindowRef: window.windowRef,
    framePoints: window.framePoints,
    scaleFactor: window.scaleFactor,
    isMinimized: window.isMinimized,
    isOnscreen: window.isOnscreen,
    isMain: window.isMain,
    isFocused: window.isFocused,
    isModal: window.isModal,
    sheetCount: platformRootSheetCount(window),
    role: window.role,
    subrole: window.subrole,
    pairing: platformRootPairing(window),
    zOrder: window.zOrder,
    browserUseAllowed: config.browser_use || !currentPlatformBackend.isBrowserApp(app.appName, app.bundleId),
    score: scoreWindow(window)
  };
}
function sortWindowDetails(windows) {
  return windows.sort((a, b) => b.score - a.score || a.app.localeCompare(b.app) || a.windowTitle.localeCompare(b.windowTitle));
}
async function collectWindowDetails(apps, config, signal) {
  const perApp = await Promise.all(apps.map(async (app) => ({ app, windows: await listWindows(app.pid, signal) })));
  return sortWindowDetails(perApp.flatMap(({ app, windows }) => windows.map((window) => windowDetails(app, window, config))));
}
function collectBroadWindowDetails(roots, config) {
  const windows = [];
  for (const window of roots) {
    if (!window.pid) continue;
    windows.push(windowDetails({ appName: window.appName ?? "Unknown App", bundleId: window.bundleId, pid: window.pid }, window, config));
  }
  return sortWindowDetails(windows);
}
async function windowDetailsForFind(query, config, signal) {
  if (!query.app && !query.bundleId && !Number.isFinite(query.pid)) {
    return collectBroadWindowDetails(await currentPlatformBackend.listRoots({}, signal), config);
  }
  const apps = (await listApps(signal)).filter((app) => appMatchesWindowQuery(app, query));
  return await collectWindowDetails(apps, config, signal);
}
async function performListWindows(params, signal) {
  const rawParams = params ?? {};
  const query = {
    text: trimOrUndefined(rawParams.text),
    app: trimOrUndefined(rawParams.app),
    bundleId: trimOrUndefined(rawParams.bundleId),
    pid: Number.isFinite(rawParams.pid) ? Math.trunc(rawParams.pid) : void 0,
    kind: rawParams.kind
  };
  const config = getComputerUseConfig();
  const desktopForest = await windowDetailsForFind(query, config, signal);
  const includeBrowserPages = !query.pid && !query.bundleId && (!query.app || normalizeText2(query.app) === "browser") && config.browser_use;
  const browserForest = !includeBrowserPages ? [] : (await listCdpPageContexts().catch(() => [])).map((page) => ({
    app: "Browser",
    pid: 0,
    kind: "browser_page",
    windowTitle: page.title || page.url,
    windowRef: storeBrowserRootRef(page.contextId),
    framePoints: { x: 0, y: 0, w: 1, h: 1 },
    scaleFactor: 1,
    isMinimized: false,
    isOnscreen: true,
    isMain: false,
    isFocused: false,
    isModal: false,
    zOrder: Number.MAX_SAFE_INTEGER,
    browserUseAllowed: true,
    score: 0,
    url: page.url
  }));
  const allRoots = [...desktopForest, ...browserForest];
  const forest = allRoots.filter((root) => !query.kind || root.kind === query.kind);
  const ranked = forest.map((root, order) => ({ root, order, match: query.text ? rankedTextMatch([root.app, root.windowTitle], query.text) : { reason: "filter", score: 1 } })).filter((entry) => entry.match).sort((a, b) => b.match.score - a.match.score || Number(b.root.isFocused) - Number(a.root.isFocused) || a.root.zOrder - b.root.zOrder || a.order - b.order);
  const totalMatches = ranked.length;
  const windows = ranked.slice(0, 12).map((entry) => entry.root);
  const details = { tool: "find_roots", query, windows, totalMatches, returned: windows.length, hasMore: totalMatches > windows.length, config };
  const lines = windows.map(formatWindowLine);
  const text = lines.length ? `Found ${totalMatches} matching root${totalMatches === 1 ? "" : "s"}; returned ${windows.length}${totalMatches > windows.length ? ". Refine the filters for additional roots" : ""}. Use @r refs with observe_ui({ root: "@rN" }).
${lines.join("\n")}` : query.text || query.app || query.bundleId || query.pid || query.kind ? "No roots matched the supplied filters." : "No roots are currently visible to pi-computer-use.";
  return { content: [{ type: "text", text }], details };
}
function normalizeImageMode(value) {
  return value === "always" || value === "never" ? value : "auto";
}
function isBrowserContextId(contextId) {
  return Boolean(contextId?.startsWith(BROWSER_CONTEXT_PREFIX));
}
function browserSnapshotTarget(snapshotId, ref) {
  if (!snapshotId || !ref) return void 0;
  const record = savedStates.get(snapshotId);
  const snapshot = record?.value.kind === "browser" ? record.value.snapshot : void 0;
  const target = snapshot?.targets.find((candidate) => candidate.ref === ref);
  if (!snapshot || !target) return void 0;
  return { contextId: snapshot.contextId, backendNodeId: target.backendNodeId };
}
function browserContextForOperation() {
  const contextId = operationState().contextId;
  return isBrowserContextId(contextId) ? contextId : void 0;
}
async function withBrowserWrite(contextId, work) {
  const state = operationState();
  const targetId = contextId.slice(BROWSER_CONTEXT_PREFIX.length);
  const resourceKey = `cdp:${targetId}`;
  const baseEpoch = state.epoch ?? resourceScheduler.epoch(resourceKey);
  const result = await resourceScheduler.write(resourceKey, baseEpoch, async (nextEpoch) => {
    state.resourceKey = resourceKey;
    state.epoch = nextEpoch;
    return await work();
  });
  return result.value;
}
function browserObservationResult(browser, resourceKey, epoch, tool, base) {
  savedStates.set({ stateId: browser.snapshotId, resourceKey, epoch, value: { kind: "browser", snapshot: browser, outline: browser.outline } });
  const currentOutline = restoreOutline(browser.outline);
  const transition = base ? changesBetween(restoreOutline(base.outline), currentOutline) : void 0;
  const useDiff = Boolean(transition && !transition.useFullView);
  const folded = foldToBudget(currentOutline);
  const root = { ref: storeBrowserRootRef(browser.contextId), kind: "browser_page", title: browser.title, url: browser.url };
  const details = { tool, kind: "browser_page", stateId: browser.snapshotId, baseStateId: base?.stateId, view: useDiff ? "diff" : "full", changes: useDiff ? transition?.changes : void 0, root, outline: browser.outline, renderedOutline: folded.text };
  const viewText = useDiff ? `Changes (${transition.changedNodeCount}, ${base.stateId} \u2192 ${browser.snapshotId}):
${renderChanges(transition.changes) || "(no element changes)"}
Use stateId ${browser.snapshotId} for subsequent actions and queries.` : folded.text;
  return { content: [{ type: "text", text: `${tool} completed for ${root.ref} ${JSON.stringify(browser.title)}. State ${browser.snapshotId}.
${viewText}` }], details };
}
async function refreshBrowserSnapshot(contextId, tool, base) {
  const browser = await cdpSnapshotForContext(contextId);
  if (!browser) throw new Error(`Browser root '${contextId}' is no longer available. Call find_roots and observe_ui again.`);
  const state = operationState();
  const resourceKey = state.resourceKey ?? `cdp:${browser.targetId}`;
  return browserObservationResult(browser, resourceKey, state.epoch ?? resourceScheduler.epoch(resourceKey), tool, base);
}
function sliceText(value, offsetValue, _limitValue) {
  const offset = Math.max(0, Math.trunc(toFiniteNumber(offsetValue, 0)));
  const limit = UI_TEXT_PAGE_CHARS;
  const characters = Array.from(value);
  const end = Math.min(characters.length, offset + limit);
  return {
    offset,
    limit,
    totalChars: characters.length,
    hasMore: end < characters.length,
    text: offset >= characters.length ? "" : characters.slice(offset, end).join("")
  };
}
async function performReadText(params, signal) {
  const ref = trimOrUndefined(params.ref);
  if (ref?.startsWith("@o")) {
    const page = readStoredOutput(ref, params.offset);
    if (!page) throw new Error(`Output ref '${ref}' is unavailable or was evicted. Rerun the focused query.`);
    const details2 = { tool: "read_text", ref, ...page };
    const suffix = page.hasMore ? `

continue: read_text({ ref: "${ref}", offset: ${page.offset + page.limit} })` : page.complete ? "" : "\n\ncontinuation storage limit reached; rerun a more focused query for the remainder";
    return { content: [{ type: "text", text: `${page.text || "(empty output page)"}${suffix}` }], details: details2 };
  }
  const contextId = operationState().contextId;
  if (isBrowserContextId(contextId)) {
    const snapshot = operationState().browserSnapshot;
    if (!snapshot || snapshot.contextId !== contextId) throw new Error(`Browser state '${params.stateId}' is unavailable. Observe the browser root again.`);
    if (!ref) throw new Error("read_text requires an @e ref for browser contexts; use the outline root ref for whole-page text.");
    const outline = restoreOutline(snapshot.outline);
    const node2 = nodeByRef(outline, ref);
    if (!node2) throw new Error(`Browser text ref '${ref}' is unavailable in this state.`);
    const collect = (current) => [outlineNodeLabel(current), ...current.text.map((item) => item.string), ...current.children.flatMap(collect)].filter(Boolean);
    const value = node2 === outline.root ? snapshot.text : [...new Set(collect(node2))].join("\n");
    const sliced = sliceText(value, params.offset);
    const details2 = { tool: "read_text", ref, ...sliced };
    return { content: [{ type: "text", text: sliced.text || "(empty text slice)" }], details: details2 };
  }
  validateStateId(params.stateId);
  if (!ref) throw new Error("read_text requires ref for desktop contexts. Call observe_ui/inspect_ui and use a text-bearing outline ref.");
  const node = outlineNodeByRef(ref);
  const state = operationState();
  if (!state.resourceKey || state.epoch === void 0) throw new Error("The observation has no live resource identity. Observe again.");
  const raw = (await resourceScheduler.readAt(state.resourceKey, state.epoch, async () => await currentPlatformBackend.readText({
    lookId: state.currentOutline.lookId,
    elementRef: wireRefForNode(node),
    offset: Math.max(0, Math.trunc(toFiniteNumber(params.offset, 0))),
    limit: UI_TEXT_PAGE_CHARS
  }, { signal, timeoutMs: COMMAND_TIMEOUT_MS5 }))).value;
  const text = raw.text;
  const details = {
    tool: "read_text",
    ref,
    offset: raw.offset,
    limit: raw.limit,
    totalChars: raw.totalChars,
    hasMore: raw.hasMore,
    text
  };
  return { content: [{ type: "text", text: text || "(empty text slice)" }], details };
}
function normalizeWaitTimeoutMs(value) {
  return Math.max(100, Math.min(6e4, Math.trunc(toFiniteNumber(value, 1e4))));
}
function conditionScopeRef(params) {
  const ref = trimOrUndefined(params.ref);
  const scopeRef = trimOrUndefined(params.scopeRef);
  if (ref && scopeRef) throw new Error("A UI condition accepts ref or scopeRef, not both.");
  return ref ?? scopeRef;
}
function validateCondition(params) {
  const text = trimOrUndefined(params.text);
  const role = trimOrUndefined(params.role);
  const value = trimOrUndefined(params.value);
  const scopeRef = conditionScopeRef(params);
  if (!text && !role && !value) throw new Error("A UI condition requires text, role, or value.");
  if (role && !text && !value && !scopeRef) throw new Error("A role-only UI condition requires ref or scopeRef.");
  if (value && !params.ref) throw new Error("A value UI condition requires an exact ref.");
  return { text, role, value, scopeRef, scopeExact: Boolean(params.ref), gone: params.until === "absent", timeoutMs: normalizeWaitTimeoutMs(params.timeoutMs) };
}
function nodeWithinScope(node, scopeRef, scopeExact) {
  if (!scopeRef) return true;
  if (scopeExact) return node.ref === scopeRef;
  let current = node;
  while (current) {
    if (current.ref === scopeRef) return true;
    current = current.parent;
  }
  return false;
}
function normalizedRole(value) {
  return value.toLowerCase().replace(/^ax/, "").replace(/[ _-]+/g, "");
}
function platformRole(outline, role) {
  if (!role) return void 0;
  return outline.nodes.find((node) => normalizedRole(node.role) === normalizedRole(role))?.role ?? role;
}
function outlineConditionPresent(outline, condition) {
  return searchOutline(outline, condition.text, void 0, void 0, outline.nodes.length).some((match) => (!condition.role || normalizedRole(match.node.role) === normalizedRole(condition.role)) && nodeWithinScope(match.node, condition.scopeRef, condition.scopeExact) && (!condition.value || normalizeText2(match.node.value) === normalizeText2(condition.value)));
}
function conditionScopeNode(outline, condition) {
  const scopeNode = condition.scopeRef ? nodeByRef(outline, condition.scopeRef) : void 0;
  if (condition.scopeRef && !scopeNode) throw new Error(`Condition scope ref '${condition.scopeRef}' is unavailable in this state.`);
  return scopeNode;
}
async function performWaitFor(params, signal) {
  const contextId = operationState().contextId;
  const condition = validateCondition(params);
  const { text, role, value, scopeRef, scopeExact, gone, timeoutMs } = condition;
  if (isBrowserContextId(contextId)) {
    const state2 = operationState();
    if (!state2.resourceKey) throw new Error("The browser observation has no live resource identity. Observe again.");
    const baseSnapshot = state2.browserSnapshot;
    if (!baseSnapshot) throw new Error("Browser wait requires a complete base observation.");
    conditionScopeNode(restoreOutline(baseSnapshot.outline), condition);
    const deadline = Date.now() + timeoutMs;
    let lastSnapshot;
    let lastEpoch = state2.epoch ?? resourceScheduler.epoch(state2.resourceKey);
    const finish = (found, timedOut) => {
      if (!lastSnapshot) throw new Error("Browser wait completed without an observation.");
      savedStates.set({ stateId: lastSnapshot.snapshotId, resourceKey: state2.resourceKey, epoch: lastEpoch, value: { kind: "browser", snapshot: lastSnapshot, outline: lastSnapshot.outline } });
      const successorOutline = restoreOutline(lastSnapshot.outline);
      const transition2 = changesBetween(restoreOutline(baseSnapshot.outline), successorOutline);
      const useDiff2 = !transition2.useFullView;
      const renderedOutline = foldToBudget(successorOutline).text;
      const details2 = { tool: "wait_for", stateId: lastSnapshot.snapshotId, baseStateId: baseSnapshot.snapshotId, view: useDiff2 ? "diff" : "full", changes: useDiff2 ? transition2.changes : void 0, found, gone: found && gone || void 0, timedOut, nodeCount: lastSnapshot.targets.length, text, role, value, scopeRef, outline: lastSnapshot.outline, renderedOutline };
      const message2 = found ? gone ? "Condition disappeared." : "Condition appeared." : `Timed out after ${timeoutMs}ms waiting for condition.`;
      const viewText2 = useDiff2 ? `${renderChanges(transition2.changes) || "(no element changes)"}
Use stateId ${lastSnapshot.snapshotId} for subsequent actions and queries.` : renderedOutline;
      return { content: [{ type: "text", text: `${message2}
${viewText2}` }], details: details2 };
    };
    do {
      const scheduled = await resourceScheduler.read(state2.resourceKey, async () => await cdpSnapshotForContext(contextId));
      lastSnapshot = scheduled.value;
      lastEpoch = scheduled.epoch;
      if (!lastSnapshot) throw new Error(`Browser root '${contextId}' is no longer available. Call find_roots and observe_ui again.`);
      const present = outlineConditionPresent(restoreOutline(lastSnapshot.outline), condition);
      if (present !== gone) return finish(true);
      await sleep2(200, signal);
    } while (Date.now() < deadline);
    return finish(false, true);
  }
  const state = operationState();
  const baseView = { stateId: state.currentCapture.stateId, outline: state.currentOutline };
  let target = await resolveCurrentTarget(signal);
  target = await ensureTargetWindowId(target, signal);
  const scopeNode = conditionScopeNode(state.currentOutline, condition);
  const raw = await currentPlatformBackend.waitFor({
    ...nativeWindowRequest(target),
    lookId: state.currentOutline.lookId,
    text,
    role: platformRole(state.currentOutline, role),
    value,
    scopeRef: scopeNode ? wireRefForNode(scopeNode) : void 0,
    scopeExact,
    gone,
    timeoutMs
  }, { signal, timeoutMs: timeoutMs + 2e3 });
  if (!state.resourceKey || state.epoch === void 0) throw new Error("The observation has no live resource identity. Observe again.");
  const refreshed = (await resourceScheduler.readAt(state.resourceKey, state.epoch, async () => await captureCurrentTarget(signal, "auto"))).value;
  const transition = changesBetween(baseView.outline, refreshed.outline);
  const useDiff = !transition.useFullView;
  const matches = searchOutline(refreshed.outline, text, role, void 0, 1);
  const foundTarget = matches[0];
  const details = {
    tool: "wait_for",
    stateId: refreshed.capture.stateId,
    baseStateId: baseView.stateId,
    view: useDiff ? "diff" : "full",
    changes: useDiff ? transition.changes : void 0,
    found: raw.found,
    gone: raw.gone || void 0,
    timedOut: raw.timedOut || void 0,
    target: foundTarget ? serializeOutlineSearchMatch(foundTarget) : void 0,
    nodeCount: Number.isFinite(raw.nodeCount) ? Number(raw.nodeCount) : refreshed.outline.nodes.length,
    text,
    role,
    value,
    scopeRef,
    outline: serializeOutline(refreshed.outline),
    renderedOutline: foldToBudget(refreshed.outline).text
  };
  const message = details.found ? details.gone ? "Condition disappeared." : "Condition appeared." : `Timed out after ${timeoutMs}ms waiting for condition.`;
  const viewText = useDiff ? `${renderChanges(transition.changes) || "(no element changes)"}
Use stateId ${refreshed.capture.stateId} for subsequent actions and queries.` : details.renderedOutline;
  return { content: [{ type: "text", text: `${message}
${viewText}` }], details };
}
function sameRootIdentity(a, b) {
  if (a.pid !== b.pid) return false;
  if (a.windowId > 0 && b.windowId > 0) return a.windowId === b.windowId;
  if (a.nativeWindowRef && b.nativeWindowRef) return a.nativeWindowRef === b.nativeWindowRef;
  return normalizeText2(a.windowTitle) === normalizeText2(b.windowTitle);
}
async function performObserve(params, signal) {
  const requestedRoot = typeof params.root === "string" ? params.root : void 0;
  if (requestedRoot && !/^@r\d+$/.test(requestedRoot)) throw new Error("observe_ui.root must be an exact @r ref issued by find_roots.");
  const browserContextId = requestedRoot ? runtimeState.browserContextByRoot.get(requestedRoot) : void 0;
  if (isBrowserContextId(browserContextId)) {
    const targetId = browserContextId.slice(BROWSER_CONTEXT_PREFIX.length);
    const resourceKey2 = `cdp:${targetId}`;
    const scheduled2 = await resourceScheduler.read(resourceKey2, async () => await cdpSnapshotForContext(browserContextId));
    const browser = scheduled2.value;
    if (!browser) throw new Error(`Browser context '${browserContextId}' is no longer available. Call find_roots again.`);
    return browserObservationResult(browser, resourceKey2, scheduled2.epoch, "observe_ui");
  }
  const state = operationState();
  const mode = params.mode ?? "fused";
  const image = mode === "semantic" ? "never" : mode === "visual" ? "always" : "auto";
  const defaultReadText = mode === "semantic" ? "never" : mode === "visual" ? "always" : "auto";
  const readText = params.readText ?? defaultReadText;
  state.currentImageMode = normalizeImageMode(image);
  const selection = { root: normalizeWindowSelector(params.root) };
  const requestedTarget = selection.root ? await resolveTargetByWindowSelector(params.root, signal) : await resolveTargetForObserve(signal);
  const imageMode = normalizeImageMode(image);
  const resourceKey = desktopResourceKey(requestedTarget);
  const scheduled = await resourceScheduler.read(resourceKey, async (epoch) => {
    state.resourceKey = resourceKey;
    state.epoch = epoch;
    return await captureCurrentTarget(signal, readText, imageMode === "always" ? EXPLICIT_IMAGE_MAX_DIMENSION : AUTO_IMAGE_MAX_DIMENSION, requestedTarget, imageMode !== "never");
  });
  const captureResult = scheduled.value;
  if (!matchesObserveSelection(captureResult.target, selection) && !sameRootIdentity(captureResult.target, requestedTarget)) {
    throw new Error(
      `Observation target drifted from the requested selection. Requested ${requestedTarget.appName} \u2014 ${requestedTarget.windowTitle}, captured ${captureResult.target.appName} \u2014 ${captureResult.target.windowTitle}. Call observe_ui again or specify a more exact window title.`
    );
  }
  const summary = `Observed ${mode} ${captureResult.target.windowRef ? `${captureResult.target.windowRef} ` : ""}${captureResult.target.appName} \u2014 ${captureResult.target.windowTitle}. Returned the latest outline state.`;
  return await buildToolResult("observe_ui", summary, captureResult, executionTrace("look", "stealth"), signal, imageMode);
}
function currentOutlineOrThrow(stateId2) {
  validateStateId(stateId2);
  const outline = operationState().currentOutline;
  if (!outline) throw new Error("No observation outline is available. Call observe_ui first.");
  return outline;
}
function matchIsNonActionableStatic(match) {
  const node = match.node;
  return !node.canPress && !node.canFocus && !node.canSetValue && node.actions.length === 0 && !node.pictureOnly;
}
function shouldEscalateSearchOCR(matches, _text) {
  return matches.length === 0 || matches.every(matchIsNonActionableStatic);
}
async function performSearchUi(params, signal) {
  const state = operationState();
  let outline = currentOutlineOrThrow(params.stateId);
  const text = trimOrUndefined(params.text);
  const role = trimOrUndefined(params.role);
  const capability = trimOrUndefined(params.capability);
  if (!text && !role && !capability) throw new Error("search_ui requires text, role, or capability. Use observe_ui for a bounded overview.");
  const limit = 12;
  let ranked = searchOutlineRanked(outline, text, role, capability, limit);
  let matches = ranked.matches;
  let escalatedOCR = false;
  const look = state.currentLook;
  if (shouldEscalateSearchOCR(matches, text) && look && look.readText?.requested !== "never" && !look.readText?.executed && state.lastSearchOcrEscalatedLookId !== look.lookId) {
    state.lastSearchOcrEscalatedLookId = look.lookId;
    const currentTarget = await ensureTargetWindowId(await resolveCurrentTarget(signal), signal);
    if (!state.resourceKey || state.epoch === void 0) throw new Error("The observation has no live resource identity. Observe again.");
    const captureResult = (await resourceScheduler.readAt(state.resourceKey, state.epoch, async () => await captureCurrentTarget(signal, "always", AUTO_IMAGE_MAX_DIMENSION, currentTarget))).value;
    outline = captureResult.outline;
    ranked = searchOutlineRanked(outline, text, role, capability, limit);
    matches = ranked.matches;
    escalatedOCR = true;
  }
  const detailMatches = matches.map(serializeOutlineSearchMatch);
  const details = { tool: "search_ui", stateId: state.currentCapture?.stateId, lookId: outline.lookId, matches: detailMatches, totalMatches: ranked.totalMatches, returned: matches.length, hasMore: ranked.totalMatches > matches.length, note: state.currentNote };
  const lines = matches.map((match) => `${match.ref} ${match.role || "Unknown"} ${JSON.stringify(match.label || "(unlabeled)")} [${match.matchReason}${match.matchReason === "fuzzy" ? ` ${match.score?.toFixed(2)}` : ""}]
  path: ${match.path}`);
  const noteHeader = renderNote(state.currentNote);
  const noteText = noteHeader ? `${noteHeader}

` : "";
  const escalationText = escalatedOCR ? " OCR text was escalated for this search after the cached outline had no matches." : "";
  const moreText = ranked.totalMatches > matches.length ? ` Refine the query to inspect ${ranked.totalMatches - matches.length} additional matches.` : "";
  return { content: [{ type: "text", text: `${noteText}Found ${ranked.totalMatches} outline match${ranked.totalMatches === 1 ? "" : "es"}; returned ${matches.length}.${moreText}${escalationText}
${lines.join("\n")}` }], details };
}
async function performExpandUi(params, signal) {
  const state = operationState();
  let outline = currentOutlineOrThrow(params.stateId);
  const ref = trimOrUndefined(params.ref);
  if (!ref) throw new Error("expand_ui.ref is required.");
  const initialTarget = nodeByRef(outline, ref);
  if (!initialTarget) throw new Error(`Outline ref '${ref}' is not available in the current outline.`);
  let target = initialTarget;
  const depth = Math.max(1, Math.min(8, Math.trunc(toFiniteNumber(params.depth, 3))));
  const regionKey2 = noteRegionKeyForRef(outline, ref);
  const regionChanged = Boolean(regionKey2 && state.currentNote?.regions.some((region) => region.key === regionKey2 && region.status === "changed"));
  if (target.truncated || regionChanged) {
    const currentTarget = await ensureTargetWindowId(await resolveCurrentTarget(signal), signal);
    const targetWireRef = wireRefForNode(target);
    if (!state.resourceKey || state.epoch === void 0) throw new Error("The observation has no live resource identity. Observe again.");
    const scoped = (await resourceScheduler.readAt(state.resourceKey, state.epoch, async () => await performLook(currentTarget, {
      readText: "auto",
      baseLookId: outline.lookId,
      scopeRef: targetWireRef,
      maxDimension: 1,
      includeImage: false
    }, signal))).value;
    target = graftScopedOutline(outline, target.ref, scoped.parsedOutline);
    outline.lookId = scoped.lookId;
    state.currentOutline = outline;
    state.currentLook = { ...scoped, image: state.currentLook?.image, outline: outline.root, parsedOutline: outline };
    persistOperation(state);
  }
  const folded = foldToBudget(outline, { maxDepth: depth, maxNodes: 150 }, [target.ref]);
  const details = { tool: "expand_ui", stateId: state.currentCapture?.stateId, lookId: outline.lookId, target: serializeOutlineNodeShallow(target), renderedOutline: folded.text, note: state.currentNote };
  return { content: [{ type: "text", text: `${formatOutlineNodeLabel(target)}
path: ${outlineNodePath(target)}

${folded.text}` }], details };
}
async function performInspectUi(params) {
  const state = operationState();
  const outline = currentOutlineOrThrow(params.stateId);
  const ref = trimOrUndefined(params.ref);
  if (!ref) throw new Error("inspect_ui.ref is required.");
  const target = nodeByRef(outline, ref);
  if (!target) throw new Error(`Outline ref '${ref}' is not available in the current outline.`);
  const details = { tool: "inspect_ui", stateId: state.currentCapture?.stateId, lookId: outline.lookId, target: serializeOutlineNodeShallow(target), note: state.currentNote };
  const fields = [
    formatOutlineNodeLabel(target),
    `path: ${outlineNodePath(target)}`,
    `rect: ${JSON.stringify(target.rect)}`,
    `actions: ${target.actions.join(",") || "none"}`,
    `capabilities: ${[
      target.canPress ? "press" : void 0,
      target.canFocus ? "focus" : void 0,
      target.canSetValue ? "setValue" : void 0,
      target.canScroll ? "scroll" : void 0,
      target.canIncrement ? "increment" : void 0,
      target.canDecrement ? "decrement" : void 0,
      target.isTextInput ? "textInput" : void 0
    ].filter(Boolean).join(",") || "none"}`,
    `annotations: ${[
      target.offscreen ? "offscreen" : void 0,
      target.pictureOnly ? "pictureOnly" : void 0,
      target.truncated ? "truncated" : void 0,
      target.scrollExtent ? `scrollable ${target.scrollExtent.seen}/${target.scrollExtent.total}` : void 0
    ].filter(Boolean).join(",") || "none"}`
  ];
  return { content: [{ type: "text", text: fields.join("\n") }], details };
}
function prepareUiAction(action, state, look, headless) {
  return prepareAction(action, state, {
    headless,
    image: look.image,
    node: outlineNodeByRef,
    center: outlineNodeCenter,
    validatePoint: (x, y, label2) => ensurePointIsInLookImage(x, y, look, label2)
  });
}
async function dispatchUiAction(action, target, look, headless, state, signal) {
  const prepared = prepareUiAction(action, state, look, headless);
  if (prepared.action === "wait") {
    await sleep2(prepared.params.ms, signal);
    return executionTrace("wait", "stealth", { outcome: "worked" });
  }
  const trace = await helperAct(target, prepared, headless, signal);
  if (!headless && (prepared.establishesFocus || prepared.action === "click" && "x" in prepared.target)) {
    state.currentFocus = true;
  }
  return trace;
}
async function dispatchUiTransaction(actions, target, look, headless, signal) {
  if (headless && currentPlatformBackend.actBatch) {
    const actionState2 = { currentFocus: false };
    const requests = actions.map((action) => helperActRequest(target, prepareUiAction(action, actionState2, look, true), "ax_only"));
    const textLength = actions.reduce((sum, action) => sum + (action.text?.length ?? 0), 0);
    const result = await currentPlatformBackend.actBatch(requests, { signal, timeoutMs: Math.max(COMMAND_TIMEOUT_MS5, textLength * 25 + 6e3) });
    if (!result.steps || result.steps.length === 0) throw new Error("Native action transaction returned no checked steps.");
    const execution = aggregateExecutions(result.steps.map((step) => executionTraceFromAct(step, "ax_only")));
    const batchTrace = executionTraceFromAct(result, "ax_only");
    execution.outcome = result.outcome;
    execution.performed = result.performed;
    execution.rootDelta = batchTrace.rootDelta;
    execution.stoppedAt = result.stoppedAt;
    return execution;
  }
  const steps = [];
  const actionState = { currentFocus: false };
  for (const action of actions) {
    const step = await dispatchUiAction(action, target, look, headless, actionState, signal);
    steps.push(step);
    if (step.outcome === "didnt") break;
  }
  return aggregateExecutions(steps);
}
function aggregateExecutions(steps) {
  const outcomes = steps.map((step) => step.outcome);
  const outcome = outcomes.includes("didnt") ? "didnt" : outcomes.includes("unknown") ? "unknown" : "worked";
  const fallback = steps.find((step) => step.escalatedToForeground);
  return executionTrace("act", steps.every((step) => step.variant === "stealth") ? "stealth" : "default", {
    outcome,
    steps,
    actionCount: steps.length,
    rootDelta: steps.flatMap((step) => step.rootDelta ?? []),
    backgroundFirst: true,
    escalatedToForeground: Boolean(fallback),
    escalationReason: fallback?.escalationReason,
    backgroundAttempt: fallback?.backgroundAttempt
  });
}
function exactPlatformRootMatchesTarget(root, target) {
  if (root.pid !== target.pid) return false;
  const nativeRefMatches = Boolean(target.nativeWindowRef && (root.rootRef === target.nativeWindowRef || root.windowRef === target.nativeWindowRef));
  const windowIdMatches = target.windowId > 0 && root.windowId === target.windowId;
  return nativeRefMatches || windowIdMatches;
}
function clearDesktopOperationState(state) {
  state.currentTarget = void 0;
  state.currentCapture = void 0;
  state.currentStateTarget = void 0;
  state.currentLook = void 0;
  state.currentOutline = void 0;
  state.currentNote = void 0;
}
async function terminalDesktopActionResult(target, baseStateId, execution, error, condition) {
  let exactRootAvailable;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const roots = await currentPlatformBackend.listRoots({ pid: target.pid });
      exactRootAvailable = roots.some((root) => exactPlatformRootMatchesTarget(root, target));
      if (exactRootAvailable) break;
      if (attempt < 2) await sleep2(75);
    }
  } catch {
  }
  const targetClosed = exactRootAvailable === false;
  if (targetClosed && !(execution.rootDelta ?? []).some((delta) => delta.change === "closed" && delta.pid === target.pid && (delta.ref === target.windowRef || delta.ref === target.nativeWindowRef))) {
    execution.rootDelta = [
      ...execution.rootDelta ?? [],
      {
        change: "closed",
        kind: "window",
        ref: target.windowRef,
        title: target.windowTitle,
        pid: target.pid,
        metadata: { source: "post_action_identity_probe" }
      }
    ];
  }
  if (targetClosed && condition) {
    const verificationStatus = condition.gone ? "verified" : "failed";
    execution.verification = {
      status: verificationStatus,
      text: condition.text,
      role: condition.role,
      value: condition.value,
      gone: condition.gone || void 0,
      timeoutMs: condition.timeoutMs
    };
    execution.outcome = outcomeAfterCheck(execution.outcome ?? "unknown", verificationStatus);
    if (verificationStatus === "failed") {
      execution.error = {
        code: "postcondition_failed",
        message: "The source root closed before the requested presence or value postcondition could be verified."
      };
    }
  }
  const status = targetClosed ? "target_closed" : "post_action_observation_failed";
  const code = targetClosed ? "target_closed" : "post_action_observation_failed";
  const message = error instanceof Error ? error.message : String(error);
  clearDesktopOperationState(operationState());
  const details = {
    tool: "act_ui",
    status,
    baseStateId,
    target: {
      app: target.appName,
      bundleId: target.bundleId,
      pid: target.pid,
      windowTitle: target.windowTitle,
      windowId: target.windowId,
      windowRef: target.windowRef,
      nativeWindowRef: target.nativeWindowRef
    },
    execution,
    error: { code, message }
  };
  const result = targetClosed ? `The action was delivered, and its source root ${target.appName} \u2014 ${target.windowTitle} closed before a successor observation could be captured.` : `The action was delivered, but its source root ${target.appName} \u2014 ${target.windowTitle} could not be observed afterward: ${message}`;
  return {
    content: [{ type: "text", text: `${result}
No successor state was created. Call find_roots, then observe_ui to continue.` }],
    details
  };
}
async function performDesktopTransaction(params, actions, signal) {
  const state = operationState();
  state.currentImageMode = "auto";
  validateStateId(params.stateId);
  const look = currentLookOrThrow();
  const baseView = { stateId: state.currentCapture.stateId, outline: state.currentOutline };
  const condition = params.expect ? validateCondition(params.expect) : void 0;
  const scopeNode = condition ? conditionScopeNode(look.parsedOutline, condition) : void 0;
  const target = await ensureTargetWindowId(await resolveCurrentTarget(signal), signal);
  const noteBefore = state.currentNote;
  return await withWindowWriteLock(target, async () => {
    const headless = getComputerUseConfig().headless;
    const execution = await dispatchUiTransaction(actions, target, look, headless, signal);
    const executedActions = actions.slice(0, execution.actionCount ?? actions.length);
    try {
      if (condition) {
        const { text: expectedText, role: expectedRole, value: expectedValue, scopeExact, gone, timeoutMs } = condition;
        const beforePresent = outlineConditionPresent(look.parsedOutline, condition);
        const desiredWasPreexisting = beforePresent !== gone;
        const verification = await currentPlatformBackend.waitFor({
          ...nativeWindowRequest(target),
          lookId: look.parsedOutline.lookId,
          text: expectedText,
          role: platformRole(look.parsedOutline, expectedRole),
          value: expectedValue,
          scopeRef: scopeNode ? wireRefForNode(scopeNode) : void 0,
          scopeExact,
          gone,
          timeoutMs
        }, { signal, timeoutMs: timeoutMs + 2e3 });
        execution.verification = {
          status: verification.found ? desiredWasPreexisting ? "preexisting" : "verified" : "failed",
          text: expectedText,
          role: expectedRole,
          value: expectedValue,
          gone: gone || void 0,
          timeoutMs
        };
        execution.outcome = outcomeAfterCheck(execution.outcome ?? "unknown", execution.verification.status);
        if (!verification.found) {
          execution.error = {
            code: "postcondition_failed",
            message: `The action was delivered but its postcondition was not satisfied within ${timeoutMs}ms.`
          };
        }
      } else {
        await sleep2(settleMsForExecution(execution), signal);
      }
      const capture = await captureCurrentTarget(signal, "auto", AUTO_IMAGE_MAX_DIMENSION, target);
      execution.outcome = outcomeAfterObservedValues(execution.outcome ?? "unknown", executedActions, (ref) => nodeByRef(capture.outline, ref)?.value);
      for (const action of executedActions) {
        state.currentNote = noteAfterAct(state.currentNote ?? noteBefore, action.ref, capture.outline, { window: noteWindowForTarget(capture.target, capture.look), rootDelta: execution.rootDelta });
      }
      return await buildToolResult("act_ui", `Executed ${executedActions.length} checked UI action${executedActions.length === 1 ? "" : "s"} in ${target.appName} \u2014 ${target.windowTitle}. Returned state ${capture.capture.stateId}.`, capture, execution, signal, state.currentImageMode, baseView);
    } catch (error) {
      if (signal?.aborted) {
        clearDesktopOperationState(state);
        throw error;
      }
      return await terminalDesktopActionResult(target, baseView.stateId, execution, error, condition);
    }
  });
}
async function performBrowserTransaction(params, actions, signal) {
  const contextId = browserContextForOperation();
  if (!contextId) throw new Error("Browser transaction requires a browser observation state.");
  const baseSnapshot = operationState().browserSnapshot;
  if (!baseSnapshot) throw new Error("Browser transaction requires a complete base observation.");
  const baseView = { stateId: baseSnapshot.snapshotId, outline: baseSnapshot.outline };
  const condition = params.expect ? validateCondition(params.expect) : void 0;
  if (condition) conditionScopeNode(restoreOutline(baseSnapshot.outline), condition);
  const prepared = actions.map((action) => {
    if (!BROWSER_TRANSACTION_ACTIONS.has(action.action)) throw new Error(`Browser transactions do not support '${action.action}'.`);
    if (action.action === "click" && action.ref && action.button && action.button !== "left") throw new Error("Browser ref clicks support only the left button; use coordinate clicks for right or middle buttons.");
    const target = browserSnapshotTarget(params.stateId, trimOrUndefined(action.ref));
    if ((action.action === "press" || action.action === "setText" || action.action === "click" && action.ref || action.action === "typeText" && action.ref) && !Number.isFinite(target?.backendNodeId)) {
      throw new Error(`Browser ${action.action} requires an actionable @e ref owned by ${params.stateId}.`);
    }
    if (action.ref && (!target || target.contextId !== contextId)) throw new Error(`Browser ${action.action} ref must be owned by ${params.stateId}.`);
    return { action, target };
  });
  return await withBrowserWrite(contextId, async () => {
    for (const { action, target } of prepared) {
      let worked = false;
      if (action.action === "press" || action.action === "click" && action.ref) {
        worked = true;
        for (let count = 0; count < (action.clickCount ?? 1); count += 1) worked = await cdpClickForContext(contextId, target.backendNodeId) && worked;
      } else if (action.action === "click") {
        worked = await cdpMouseForContext(contextId, action.x, action.y, "mousePressed", action.button ?? "left", action.clickCount ?? 1) && await cdpMouseForContext(contextId, action.x, action.y, "mouseReleased", action.button ?? "left", action.clickCount ?? 1);
      } else if (action.action === "setText") worked = await cdpTypeForContext(contextId, target.backendNodeId, action.text ?? "", true);
      else if (action.action === "typeText") worked = target?.backendNodeId ? await cdpTypeForContext(contextId, target.backendNodeId, action.text ?? "", false) : await cdpTypeFocusedForContext(contextId, action.text ?? "");
      else if (action.action === "keypress") worked = await cdpKeypressForContext(contextId, action.keys ?? []);
      else if (action.action === "scroll") worked = await cdpScrollForContext(contextId, toFiniteNumber(action.scrollX, 0), toFiniteNumber(action.scrollY, 0), target?.backendNodeId);
      else if (action.action === "drag") worked = await cdpDragForContext(contextId, normalizeActionPath(action.path));
      else if (action.action === "moveMouse") worked = await cdpMouseForContext(contextId, action.x, action.y, "mouseMoved");
      if (!worked) throw new Error("The browser root became unavailable during the action transaction. Observe it again.");
    }
    if (condition) {
      const deadline = Date.now() + condition.timeoutMs;
      let satisfied = false;
      do {
        const snapshot = await cdpSnapshotForContext(contextId);
        if (!snapshot) throw new Error(`Browser root '${contextId}' is no longer available. Observe it again.`);
        const present = outlineConditionPresent(restoreOutline(snapshot.outline), condition);
        satisfied = present !== condition.gone;
        if (!satisfied) await sleep2(100, signal);
      } while (!satisfied && Date.now() < deadline);
      if (!satisfied) throw new Error(`The browser action was delivered but its postcondition was not satisfied within ${condition.timeoutMs}ms.`);
    }
    return await refreshBrowserSnapshot(contextId, "act_ui", baseView);
  });
}
function normalizeActionPath(path10) {
  return (path10 ?? []).map((point2) => Array.isArray(point2) ? { x: toFiniteNumber(point2[0], 0), y: toFiniteNumber(point2[1], 0) } : { x: toFiniteNumber(point2.x, 0), y: toFiniteNumber(point2.y, 0) });
}
function validateActionTarget(action) {
  const hasRef = Boolean(trimOrUndefined(action.ref));
  const hasX = Number.isFinite(action.x);
  const hasY = Number.isFinite(action.y);
  if (hasX !== hasY) throw new Error(`${action.action} coordinates require both x and y.`);
  const hasPoint = hasX && hasY;
  if ((action.action === "click" || action.action === "moveMouse") && hasRef === hasPoint) {
    throw new Error(`${action.action} requires exactly one target: ref or x/y coordinates.`);
  }
  if (action.action === "press" && !hasRef) throw new Error("press requires an actionable ref.");
  if (action.action === "scroll" && toFiniteNumber(action.scrollX, 0) === 0 && toFiniteNumber(action.scrollY, 0) === 0) throw new Error("scroll requires a non-zero scrollX or scrollY delta.");
  if (action.clickCount !== void 0 && (!Number.isInteger(action.clickCount) || action.clickCount < 1 || action.clickCount > 3)) throw new Error("clickCount must be an integer from 1 to 3.");
}
async function performAct(params, signal) {
  const actions = Array.isArray(params.actions) ? params.actions : [];
  if (actions.length === 0) throw new Error("act_ui.actions must contain at least one action.");
  if (actions.length > 20) throw new Error("act_ui supports at most 20 actions per transaction.");
  for (const action of actions) validateActionTarget(action);
  if (operationState().contextId) return await performBrowserTransaction(params, actions, signal);
  return await performDesktopTransaction(params, actions, signal);
}
function managedBrowserExecutableCandidates(browser) {
  const overrideName = browser === "helium" ? "PI_COMPUTER_USE_HELIUM_EXECUTABLE" : "PI_COMPUTER_USE_CHROME_EXECUTABLE";
  const override = trimOrUndefined(process.env[overrideName]);
  if (override) return [path9.resolve(override)];
  const platformCandidates = process.platform === "darwin" ? browser === "helium" ? [
    "/Applications/Helium.app/Contents/MacOS/Helium",
    path9.join(os7.homedir(), "Applications", "Helium.app", "Contents", "MacOS", "Helium")
  ] : [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path9.join(os7.homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome")
  ] : process.platform === "win32" ? browser === "helium" ? [
    process.env.LOCALAPPDATA && path9.join(process.env.LOCALAPPDATA, "Helium", "Application", "helium.exe"),
    process.env.PROGRAMFILES && path9.join(process.env.PROGRAMFILES, "Helium", "Application", "helium.exe")
  ] : [
    process.env.LOCALAPPDATA && path9.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.PROGRAMFILES && path9.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path9.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")
  ] : browser === "helium" ? [
    "/usr/bin/helium",
    "/usr/bin/helium-browser",
    "/opt/helium/chrome",
    path9.join(os7.homedir(), ".local", "helium", "chrome")
  ] : [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium"
  ];
  const pathNames = browser === "helium" ? process.platform === "win32" ? ["helium.exe"] : ["helium", "helium-browser"] : process.platform === "win32" ? ["chrome.exe"] : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  const pathCandidates = (process.env.PATH ?? "").split(path9.delimiter).filter(Boolean).flatMap((directory) => pathNames.map((name) => path9.join(directory, name)));
  return [.../* @__PURE__ */ new Set([...platformCandidates.filter((candidate) => Boolean(candidate)), ...pathCandidates])];
}
async function managedBrowserExecutable(browser) {
  const candidates = managedBrowserExecutableCandidates(browser);
  for (const candidate of candidates) {
    try {
      await access4(candidate, fsConstants5.X_OK);
      return candidate;
    } catch {
    }
  }
  const overrideName = browser === "helium" ? "PI_COMPUTER_USE_HELIUM_EXECUTABLE" : "PI_COMPUTER_USE_CHROME_EXECUTABLE";
  if (trimOrUndefined(process.env[overrideName])) {
    throw new Error(`${browser} executable from ${overrideName} was not found or is not executable: ${candidates[0]}.`);
  }
  throw new Error(`${browser} executable was not found. Set ${overrideName} to its absolute path.`);
}
function freeTcpPort() {
  return new Promise((resolve, reject) => {
    const server = net2.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => port > 0 ? resolve(port) : reject(new Error("Could not allocate a local CDP port.")));
    });
  });
}
async function waitForCdpPort(port, signal) {
  const deadline = Date.now() + MANAGED_BROWSER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Browser launch was aborted.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
    }
    await sleep2(200, signal);
  }
  throw new Error(`Managed browser did not expose CDP on port ${port} within ${MANAGED_BROWSER_READY_TIMEOUT_MS}ms.`);
}
async function performLaunchBrowser(params, signal) {
  const browser = getComputerUseConfig().managed_browser;
  const executable = await managedBrowserExecutable(browser);
  const port = await freeTcpPort();
  const requestedUrl = trimOrUndefined(params.url);
  if (requestedUrl && !/^https?:\/\//i.test(requestedUrl)) throw new Error("launch_browser.url must be an absolute HTTP(S) URL.");
  const url = requestedUrl ?? "about:blank";
  const profileDir = path9.join(os7.tmpdir(), `pi-${browser}-cdp-${port}`);
  disconnectCdp();
  runtimeState.managedBrowser?.kill("SIGTERM");
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    url
  ];
  if (runtimeState.previousCdpPort === void 0 && runtimeState.managedBrowserCdpPort === void 0) {
    runtimeState.previousCdpPort = process.env.PI_COMPUTER_USE_CDP_PORT;
  }
  const managedBrowser = spawn4(executable, args, { stdio: "ignore", detached: false });
  managedBrowser.unref();
  runtimeState.managedBrowser = managedBrowser;
  runtimeState.managedBrowserCdpPort = String(port);
  process.env.PI_COMPUTER_USE_CDP_PORT = String(port);
  try {
    await waitForCdpPort(port, signal);
  } catch (error) {
    if (runtimeState.managedBrowser === managedBrowser) {
      runtimeState.managedBrowser = void 0;
      managedBrowser.kill("SIGTERM");
      if (runtimeState.previousCdpPort === void 0) delete process.env.PI_COMPUTER_USE_CDP_PORT;
      else process.env.PI_COMPUTER_USE_CDP_PORT = runtimeState.previousCdpPort;
      runtimeState.managedBrowserCdpPort = void 0;
      runtimeState.previousCdpPort = void 0;
    }
    throw error;
  }
  const page = (await listCdpPageContexts())[0];
  if (!page) throw new Error("Managed browser launched without a CDP page context.");
  const resourceKey = `cdp:${page.targetId}`;
  const scheduled = await resourceScheduler.read(resourceKey, async () => await cdpSnapshotForContext(page.contextId));
  if (!scheduled.value) throw new Error("Managed browser page could not be observed after launch.");
  return browserObservationResult(scheduled.value, resourceKey, scheduled.epoch, "launch_browser");
}
async function performNavigateBrowser(params) {
  const contextId = browserContextForOperation();
  const url = trimOrUndefined(params.url);
  if (!contextId) throw new Error("navigate_browser.stateId must belong to a CDP browser-page observation. Native browser windows use act_ui.");
  if (!url || !/^https?:\/\//i.test(url)) throw new Error("navigate_browser.url must be an absolute HTTP(S) URL.");
  const baseSnapshot = operationState().browserSnapshot;
  if (!baseSnapshot) throw new Error("Browser navigation requires a complete base observation.");
  return await withBrowserWrite(contextId, async () => {
    const ok = await cdpNavigateContext(contextId, url);
    if (!ok) throw new Error(`Browser context '${contextId}' is no longer available. Observe it again.`);
    return await refreshBrowserSnapshot(contextId, "navigate_browser", { stateId: baseSnapshot.snapshotId, outline: baseSnapshot.outline });
  });
}
async function performEvaluateBrowser(params) {
  const contextId = browserContextForOperation();
  const expression = typeof params.expression === "string" ? params.expression : "";
  if (!contextId) throw new Error("evaluate_browser.stateId must belong to a browser observation.");
  if (!expression.trim()) throw new Error("evaluate_browser.expression must be non-empty JavaScript.");
  const baseSnapshot = operationState().browserSnapshot;
  if (!baseSnapshot) throw new Error("Browser evaluation requires a complete base observation.");
  return await withBrowserWrite(contextId, async () => {
    const result = await cdpEvaluateForContext(contextId, expression);
    if (!result) throw new Error(`Browser context '${contextId}' is no longer available. Observe it again.`);
    const successor = await refreshBrowserSnapshot(contextId, "evaluate_browser", { stateId: baseSnapshot.snapshotId, outline: baseSnapshot.outline });
    const details = {
      tool: "evaluate_browser",
      baseStateId: baseSnapshot.snapshotId,
      stateId: successor.details.stateId,
      view: successor.details.view,
      changes: successor.details.changes,
      outline: successor.details.outline,
      renderedOutline: successor.details.renderedOutline
    };
    return { content: [...successor.content, { type: "text", text: `Evaluation value: ${JSON.stringify(result.value)}` }], details };
  });
}
async function executeTool(ctx, params, signal, run) {
  const outputRef = trimOrUndefined(params?.ref)?.startsWith("@o") === true;
  const requestedStateId = outputRef ? void 0 : trimOrUndefined(params?.stateId);
  const stateRecord = requestedStateId ? savedStates.get(requestedStateId) : void 0;
  if (requestedStateId && !stateRecord) {
    throw new Error(`State '${requestedStateId}' is unavailable or was evicted. Observe the root again.`);
  }
  const operation = savedStates.hydrate(stateRecord);
  return await savedStates.operations.run(operation, async () => {
    await resourceScheduler.read("session-lifecycle", async () => await ensureReady3(ctx, signal));
    throwIfAborted3(signal);
    const result = await run();
    persistOperation(operation);
    return result;
  });
}
function makeToolExecutor(tool, perform) {
  return async (_toolCallId, params, signal, _onUpdate, ctx) => {
    try {
      return applyOutputEnvelope(tool, await executeTool(ctx, params, signal, () => perform(params, signal)));
    } catch (error) {
      throw boundToolError(tool, error);
    }
  };
}
var executeFind = makeToolExecutor("find_roots", performListWindows);
var executeReadText = makeToolExecutor("read_text", performReadText);
var executeWaitFor = makeToolExecutor("wait_for", performWaitFor);
var executeObserve = makeToolExecutor("observe_ui", performObserve);
var executeSearchUi = makeToolExecutor("search_ui", performSearchUi);
var executeExpandUi = makeToolExecutor("expand_ui", performExpandUi);
var executeInspectUi = makeToolExecutor("inspect_ui", performInspectUi);
var executeAct = makeToolExecutor("act_ui", performAct);
var executeNavigateBrowser = makeToolExecutor("navigate_browser", performNavigateBrowser);
var executeEvaluateBrowser = makeToolExecutor("evaluate_browser", performEvaluateBrowser);
var executeLaunchBrowser = makeToolExecutor("launch_browser", performLaunchBrowser);
function reconstructStateFromBranch(ctx) {
  savedStates.clear();
  clearStoredOutputs();
  runtimeState.windowRefs.clear();
  runtimeState.windowRefByIdentity.clear();
  runtimeState.nextRootRefIndex = 1;
  const restoredResources = /* @__PURE__ */ new Set();
  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    if (entry?.type !== "message") continue;
    const message = entry.message;
    if (!message || message.role !== "toolResult") continue;
    if (!AGENT_TOOL_NAMES.has(message.toolName)) continue;
    const rawDetails = message.details;
    if (rawDetails?.tool === "find_roots" && Array.isArray(rawDetails.windows)) {
      for (const window of rawDetails.windows) {
        if (typeof window?.windowRef !== "string" || !Number.isFinite(window?.pid)) continue;
        const record = {
          ref: window.windowRef,
          appName: typeof window.app === "string" ? window.app : "Unknown App",
          bundleId: typeof window.bundleId === "string" ? window.bundleId : void 0,
          pid: Math.trunc(window.pid),
          windowTitle: typeof window.windowTitle === "string" ? window.windowTitle : "(untitled)",
          windowId: Number.isFinite(window.windowId) ? Math.trunc(window.windowId) : void 0,
          nativeWindowRef: typeof window.nativeWindowRef === "string" ? window.nativeWindowRef : void 0,
          framePoints: {
            x: toFiniteNumber(window.framePoints?.x, 0),
            y: toFiniteNumber(window.framePoints?.y, 0),
            w: Math.max(1, toFiniteNumber(window.framePoints?.w, 1)),
            h: Math.max(1, toFiniteNumber(window.framePoints?.h, 1))
          },
          scaleFactor: Math.max(1, toFiniteNumber(window.scaleFactor, 1)),
          isMinimized: toBoolean3(window.isMinimized),
          isOnscreen: toBoolean3(window.isOnscreen),
          isMain: toBoolean3(window.isMain),
          isFocused: toBoolean3(window.isFocused)
        };
        runtimeState.windowRefs.set(record.ref, record);
        runtimeState.windowRefByIdentity.set(windowRecordIdentity(record), record.ref);
        const match = /^@r(\d+)$/.exec(record.ref);
        if (match) runtimeState.nextRootRefIndex = Math.max(runtimeState.nextRootRefIndex, Number(match[1]) + 1);
      }
      continue;
    }
    const details = rawDetails;
    if (!details?.target || !details?.capture) continue;
    const app = typeof details.target.app === "string" ? details.target.app : void 0;
    if (!app) continue;
    if (!Number.isFinite(details.target.pid) || !Number.isFinite(details.target.windowId)) continue;
    if (typeof details.capture.stateId !== "string") continue;
    const target = {
      appName: app,
      bundleId: details.target.bundleId,
      pid: Math.trunc(details.target.pid),
      windowTitle: details.target.windowTitle ?? "(untitled)",
      windowId: Math.trunc(details.target.windowId),
      windowRef: typeof details.target.windowRef === "string" ? details.target.windowRef : void 0,
      nativeWindowRef: typeof details.target.nativeWindowRef === "string" ? details.target.nativeWindowRef : void 0
    };
    const resourceKey = desktopResourceKey(target);
    if (restoredResources.has(resourceKey)) continue;
    const capture = {
      stateId: details.capture.stateId,
      width: Math.max(1, Math.trunc(toFiniteNumber(details.capture.width, 1))),
      height: Math.max(1, Math.trunc(toFiniteNumber(details.capture.height, 1))),
      scaleFactor: Math.max(1, toFiniteNumber(details.capture.scaleFactor, 1)),
      timestamp: Number.isFinite(details.capture.timestamp) ? details.capture.timestamp : Date.now()
    };
    if (details.outline?.root && typeof details.outline.lookId === "string") {
      const epoch = 0;
      resourceScheduler.restoreEpoch(resourceKey, epoch);
      savedStates.set({
        stateId: capture.stateId,
        resourceKey,
        epoch,
        value: {
          kind: "desktop",
          target,
          capture,
          outline: details.outline,
          look: {
            lookId: details.outline.lookId,
            capturedAt: details.capture.timestamp / 1e3,
            window: {
              windowId: Math.trunc(details.target.windowId),
              framePoints: { x: 0, y: 0, w: details.capture.width, h: details.capture.height },
              scaleFactor: details.capture.scaleFactor,
              isModal: false,
              role: "",
              subrole: ""
            },
            image: { jpegBase64: "", width: details.capture.width, height: details.capture.height },
            timings: {}
          },
          note: details.note
        }
      });
      restoredResources.add(resourceKey);
    }
  }
}

// ../../node_modules/@injaneity/pi-computer-use/extensions/computer-use.ts
var stateId = Type.String({ description: "Required state id owning every @e ref used by this operation" });
var point = { x: Type.Number(), y: Type.Number() };
var mouseButton2 = Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")]));
var clickByRef = Type.Object({ action: Type.Literal("click"), ref: Type.String(), button: mouseButton2, clickCount: Type.Optional(Type.Number({ minimum: 1, maximum: 3 })) });
var clickByPoint = Type.Object({ action: Type.Literal("click"), ...point, button: mouseButton2, clickCount: Type.Optional(Type.Number({ minimum: 1, maximum: 3 })) });
var uiAction = Type.Union([
  Type.Object({ action: Type.Literal("press"), ref: Type.String({ description: "Actionable outline ref" }) }),
  clickByRef,
  clickByPoint,
  Type.Object({ action: Type.Literal("setText"), ref: Type.String({ description: "Editable outline ref" }), text: Type.String() }),
  Type.Object({ action: Type.Literal("typeText"), ref: Type.Optional(Type.String({ description: "Omit after a click to type into the focus established by that click" })), text: Type.String() }),
  Type.Object({ action: Type.Literal("keypress"), ref: Type.Optional(Type.String({ description: "Omit to send keys to the focused control" })), keys: Type.Array(Type.String(), { minItems: 1 }) }),
  Type.Object({ action: Type.Literal("scroll"), ref: Type.Optional(Type.String()), scrollX: Type.Optional(Type.Number()), scrollY: Type.Optional(Type.Number()) }),
  Type.Object({ action: Type.Literal("drag"), path: Type.Array(Type.Object(point), { minItems: 2 }) }),
  Type.Object({ action: Type.Literal("moveMouse"), ...point })
]);
var conditionProperties = {
  ref: Type.Optional(Type.String({ description: "Specific @e ref to test", maxLength: 128 })),
  scopeRef: Type.Optional(Type.String({ description: "Restrict matching to this @e subtree", maxLength: 128 })),
  text: Type.Optional(Type.String({ description: "Text that must match", maxLength: 512 })),
  role: Type.Optional(Type.String({ description: "Exact normalized role", maxLength: 128 })),
  value: Type.Optional(Type.String({ description: "Exact normalized value; normally pair with ref" })),
  until: Type.Optional(Type.Union([Type.Literal("present"), Type.Literal("absent")], { description: "Desired condition, default present" })),
  timeoutMs: Type.Optional(Type.Number({ description: "Maximum wait, default 10000ms", minimum: 100, maximum: 6e4 }))
};
var findTool = defineTool({
  name: "find_roots",
  label: "Find Roots",
  description: "Find a bounded, ranked set of controllable UI roots with refs, geometry, and focus state.",
  promptSnippet: "Find a target root before observe_ui when needed.",
  parameters: Type.Object({
    text: Type.Optional(Type.String({ description: "Ranked app or title text", maxLength: 256 })),
    app: Type.Optional(Type.String({ description: "Exact normalized app name", maxLength: 256 })),
    bundleId: Type.Optional(Type.String({ description: "Exact bundle id" })),
    pid: Type.Optional(Type.Number({ description: "Exact process id" })),
    kind: Type.Optional(Type.Union([Type.Literal("window"), Type.Literal("menu"), Type.Literal("sheet"), Type.Literal("popover"), Type.Literal("dialog"), Type.Literal("browser_page")], { description: "Exact root kind" }))
  }),
  execute: executeFind
});
var observeTool = defineTool({
  name: "observe_ui",
  label: "Observe UI",
  description: "Capture the current/frontmost root or one exact @r root and return a bounded UI outline.",
  promptSnippet: "Primary UI observation tool. Follow with search_ui, expand_ui, inspect_ui, or act_ui.",
  promptGuidelines: [
    "Use mode=semantic to skip OCR and images, visual to force them, and fused for automatic selection.",
    "Use @e outline refs from observe_ui/search_ui for act_ui; pictureOnly refs are coordinate-only and blocked by UI-tree-only policy."
  ],
  parameters: Type.Object({
    root: Type.Optional(Type.String({ description: "Exact @r ref issued by find_roots" })),
    mode: Type.Optional(Type.Union([Type.Literal("semantic"), Type.Literal("visual"), Type.Literal("fused")], { description: "Observation mode, default fused" }))
  }),
  execute: executeObserve
});
var searchUiTool = defineTool({
  name: "search_ui",
  label: "Search UI",
  description: "Return a bounded, deterministically ranked search of the cached outline. At least one predicate is required.",
  promptSnippet: "Find targets not shown in the compact observe_ui output; refine broad searches instead of paging matches.",
  parameters: Type.Object({
    text: Type.Optional(Type.String({ description: "Human-readable text or label", maxLength: 256 })),
    role: Type.Optional(Type.String({ description: "Exact normalized role, e.g. button", maxLength: 128 })),
    capability: Type.Optional(Type.String({ description: "Exact capability, e.g. press", maxLength: 128 })),
    stateId
  }),
  execute: executeSearchUi
});
var expandUiTool = defineTool({
  name: "expand_ui",
  label: "Expand UI",
  description: "Unfold bounded local outline context for one @e ref.",
  promptSnippet: "Expand a specific ref instead of dumping unrelated UI.",
  parameters: Type.Object({ ref: Type.String(), depth: Type.Optional(Type.Number({ minimum: 1, maximum: 8, description: "Subtree depth, default 3" })), stateId }),
  execute: executeExpandUi
});
var inspectUiTool = defineTool({
  name: "inspect_ui",
  label: "Inspect UI",
  description: "Inspect one exact outline ref with fields, geometry, capabilities, and annotations.",
  promptSnippet: "Use when a target's evidence or provenance matters.",
  parameters: Type.Object({ ref: Type.String(), stateId }),
  execute: executeInspectUi
});
var actTool = defineTool({
  name: "act_ui",
  label: "Act",
  description: "Perform one or more precisely targeted checked actions and return the successor state.",
  promptSnippet: "Pass dependent click/type steps together and use expect for observable completion.",
  promptGuidelines: ["After clicking an editable region, omit ref from typeText/keypress so input follows the established focus."],
  parameters: Type.Object({ stateId, expect: Type.Optional(Type.Object(conditionProperties)), actions: Type.Array(uiAction, { minItems: 1, maxItems: 20 }) }),
  execute: executeAct
});
var readTextTool = defineTool({
  name: "read_text",
  label: "Read Text",
  description: "Read a fixed-size page from an @e UI ref or immutable @o truncated-output ref.",
  promptSnippet: "Use @e with its stateId; @o continuation refs don't need stateId.",
  parameters: Type.Object({ ref: Type.String(), offset: Type.Optional(Type.Number({ minimum: 0 })), stateId: Type.Optional(stateId) }),
  execute: executeReadText
});
var waitForTool = defineTool({
  name: "wait_for",
  label: "Wait For",
  description: "Wait for one scoped UI condition and return the successor state.",
  promptSnippet: "Use after asynchronous UI changes instead of polling observe_ui.",
  parameters: Type.Object({ ...conditionProperties, stateId }),
  execute: executeWaitFor
});
var launchBrowserTool = defineTool({
  name: "launch_browser",
  label: "Launch Browser Context",
  description: "Launch the configured Pi-managed CDP browser and return an observed browser-page state.",
  promptSnippet: "Use for browser work that needs a managed CDP context.",
  promptGuidelines: ["Prefer curl through bash when the page is directly fetchable."],
  parameters: Type.Object({ url: Type.Optional(Type.String({ maxLength: 8192 })) }),
  execute: executeLaunchBrowser
});
var navigateBrowserTool = defineTool({
  name: "navigate_browser",
  label: "Navigate Browser",
  description: "Navigate an observed CDP browser-page state to an HTTP(S) URL.",
  promptSnippet: "Native browser windows use act_ui; this tool is CDP-only.",
  parameters: Type.Object({ url: Type.String({ maxLength: 8192 }), stateId }),
  execute: executeNavigateBrowser
});
var evaluateBrowserTool = defineTool({
  name: "evaluate_browser",
  label: "Evaluate Browser",
  description: "Evaluate targeted JavaScript in a CDP browser-page state; returned output is strictly bounded.",
  promptSnippet: "Prefer observe/search/read; return selected fields, aggregates, or bounded slices.",
  parameters: Type.Object({ stateId, expression: Type.String({ maxLength: 65536 }) }),
  execute: executeEvaluateBrowser
});
function formatConfigStatus() {
  const loaded = getLoadedComputerUseConfig();
  return [
    "pi-computer-use configuration",
    `browser_use: ${loaded.config.browser_use ? "enabled" : "disabled"}`,
    `managed_browser: ${loaded.config.managed_browser}`,
    `headless: ${loaded.config.headless ? "enabled" : "disabled"}`,
    `cursor_overlay: ${loaded.config.cursor_overlay ? "enabled" : "disabled"}`,
    "",
    "Sources:",
    ...loaded.sources.map((source) => `- ${source.path}: ${source.error ? `error: ${source.error}` : source.exists ? "loaded" : "not found"}`),
    `- env overrides: ${Object.keys(loaded.env).join(", ") || "none"}`
  ].join("\n");
}
function computerUseExtension(pi) {
  for (const tool of [findTool, observeTool, searchUiTool, expandUiTool, inspectUiTool, actTool, readTextTool, waitForTool, launchBrowserTool, navigateBrowserTool, evaluateBrowserTool]) pi.registerTool(tool);
  pi.registerCommand("computer-use", {
    description: "Show pi-computer-use configuration",
    handler: async (_args, ctx) => {
      loadComputerUseConfig(ctx.cwd);
      ctx.ui.notify(formatConfigStatus(), "info");
    }
  });
  pi.on("session_start", async (_event, ctx) => {
    loadComputerUseConfig(ctx.cwd);
    reconstructStateFromBranch(ctx);
  });
  pi.on("session_shutdown", async () => {
    await shutdownComputerUseSession();
  });
}
export {
  computerUseExtension as default
};
