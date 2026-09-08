/// <reference lib="dom" />

import { ipcRenderer } from "electron";

const PAGE_CHANNEL = "pi-browser-page";
const refElements = new Map<string, Element>();
let selectionMode = false;
let allowFileInputOnce = false;
let overlayBox: HTMLDivElement | null = null;

ipcRenderer.on(`${PAGE_CHANNEL}:command`, (_event, message: unknown) => {
  if (!isRecord(message) || typeof message.kind !== "string") return;
  if (message.kind === "set-selection-mode") {
    selectionMode = isRecord(message.payload) && message.payload.enabled === true;
    ensureOverlay();
    if (!selectionMode) hideOverlay();
    return;
  }
  if (message.kind === "allow-file-input-once") {
    allowFileInputOnce = true;
    return;
  }
  if (!isRecord(message.payload) || typeof message.payload.requestId !== "string") return;
  const requestId = message.payload.requestId;
  const payload = message.payload.payload;
  try {
    const result = message.kind === "observe"
      ? observePage()
      : message.kind === "act"
        ? actOnPage(payload)
        : message.kind === "text-state"
          ? textState(payload)
          : undefined;
    ipcRenderer.send(`${PAGE_CHANNEL}:response`, { requestId, result });
  } catch (error) {
    ipcRenderer.send(`${PAGE_CHANNEL}:response`, {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

window.addEventListener("mousemove", (event) => {
  if (!selectionMode) return;
  const target = event.composedPath().find((entry): entry is Element => entry instanceof Element);
  if (target) highlight(target);
}, true);

window.addEventListener("click", (event) => {
  const fileInput = event.composedPath().find(
    (entry): entry is HTMLInputElement => entry instanceof HTMLInputElement && entry.type === "file",
  );
  if (fileInput) {
    if (allowFileInputOnce) {
      allowFileInputOnce = false;
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send(`${PAGE_CHANNEL}:permission-requested`, { permission: "file-upload" });
    return;
  }
  if (!selectionMode) return;
  const target = event.composedPath().find((entry): entry is Element => entry instanceof Element);
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  ipcRenderer.send(`${PAGE_CHANNEL}:element-selected`, { element: describeElement(target) });
  selectionMode = false;
  hideOverlay();
}, true);

window.addEventListener("drop", (event) => {
  if (event.dataTransfer?.files.length) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

window.addEventListener("keydown", (event) => {
  if (!selectionMode || event.key !== "Escape") return;
  selectionMode = false;
  hideOverlay();
  ipcRenderer.send(`${PAGE_CHANNEL}:selection-cancelled`);
}, true);

function ensureOverlay(): void {
  if (overlayBox?.isConnected || !document.documentElement) return;
  const host = document.createElement("div");
  host.setAttribute("data-pi-browser-selector", "");
  const shadow = host.attachShadow({ mode: "closed" });
  const box = document.createElement("div");
  box.style.cssText = [
    "position:fixed",
    "display:none",
    "pointer-events:none",
    "z-index:2147483647",
    "border:2px solid #5b7cfa",
    "background:rgba(91,124,250,.12)",
    "box-shadow:0 0 0 1px rgba(255,255,255,.72) inset",
  ].join(";");
  shadow.appendChild(box);
  document.documentElement.appendChild(host);
  overlayBox = box;
}

function highlight(element: Element): void {
  ensureOverlay();
  if (!overlayBox) return;
  const rect = element.getBoundingClientRect();
  overlayBox.style.display = rect.width > 0 && rect.height > 0 ? "block" : "none";
  overlayBox.style.left = `${Math.max(0, rect.left)}px`;
  overlayBox.style.top = `${Math.max(0, rect.top)}px`;
  overlayBox.style.width = `${Math.max(0, rect.width)}px`;
  overlayBox.style.height = `${Math.max(0, rect.height)}px`;
}

function hideOverlay(): void {
  if (overlayBox) overlayBox.style.display = "none";
}

function observePage() {
  refElements.clear();
  const nodes: Record<string, unknown>[] = [];
  const candidates = document.body?.querySelectorAll("a,button,input,textarea,select,[role],h1,h2,h3,h4,p,li,summary,[contenteditable=true]") ?? [];
  for (const element of Array.from(candidates)) {
    if (nodes.length >= 220 || !isVisible(element)) continue;
    const ref = `e${nodes.length + 1}`;
    refElements.set(ref, element);
    const description = describeElement(element);
    nodes.push({
      ref,
      tag: description.tag,
      ...(description.role ? { role: description.role } : {}),
      ...(description.accessibleName ? { name: description.accessibleName } : {}),
      ...(description.text ? { text: description.text } : {}),
      ...(element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement
        ? { disabled: element.disabled }
        : {}),
    });
  }
  return { nodes };
}

function textState(value: unknown): { readonly visible: boolean } {
  if (!isRecord(value) || typeof value.text !== "string" || !value.text.trim()) {
    throw new Error("text is required for a browser text wait");
  }
  const needle = value.text.trim().toLocaleLowerCase();
  const visible = normalizedText(document.body?.innerText ?? "", 250_000).toLocaleLowerCase().includes(needle);
  return { visible };
}

function actOnPage(value: unknown): unknown {
  if (!isRecord(value) || typeof value.kind !== "string") throw new Error("invalid browser action");
  const element = typeof value.ref === "string" ? refElements.get(value.ref) : undefined;
  if (value.ref && (!element || !element.isConnected)) throw new Error("stale_element: observe the page again");
  if (element instanceof HTMLElement) {
    element.scrollIntoView({ block: "center", inline: "nearest" });
    element.focus({ preventScroll: true });
  }
  if (value.kind === "click" && element instanceof HTMLElement) {
    element.click();
    return { clicked: value.ref };
  }
  if (value.kind === "hover" && element) {
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: false, view: window }));
    return { hovered: value.ref };
  }
  if (value.kind === "type" && element instanceof HTMLElement && typeof value.text === "string") {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const nextValue = value.replace === false ? `${element.value}${value.text}` : value.text;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, nextValue);
      else element.value = nextValue;
    } else if (element.isContentEditable) {
      element.textContent = value.replace === false ? `${element.textContent ?? ""}${value.text}` : value.text;
    } else {
      throw new Error("element is not editable");
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value.text }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { typed: value.ref };
  }
  if (value.kind === "press" && typeof value.key === "string") {
    const target = element ?? document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key: value.key, bubbles: true, cancelable: true }));
    target.dispatchEvent(new KeyboardEvent("keyup", { key: value.key, bubbles: true, cancelable: true }));
    if (value.key === "Enter" && target instanceof HTMLElement) target.click();
    return { pressed: value.key };
  }
  if (value.kind === "select" && element instanceof HTMLSelectElement && Array.isArray(value.values)) {
    const values = new Set(value.values.map(String));
    for (const option of Array.from(element.options)) option.selected = values.has(option.value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { selected: [...values] };
  }
  if (value.kind === "scroll") {
    const target = element instanceof HTMLElement ? element : window;
    target.scrollBy({
      left: typeof value.deltaX === "number" ? value.deltaX : 0,
      top: typeof value.deltaY === "number" ? value.deltaY : 500,
      behavior: "instant",
    });
    return { scrolled: true };
  }
  throw new Error(`unsupported browser action: ${value.kind}`);
}

function describeElement(element: Element) {
  const tag = element.tagName.toLowerCase();
  const role = explicitOrImplicitRole(element);
  const accessibleName = getAccessibleName(element);
  const text = normalizedText(element.textContent ?? "", 500);
  const attributes = collectAttributes(element);
  const cssFallback = buildCssPath(element);
  const locator = buildLocator(element, role, accessibleName, text, cssFallback);
  const ancestors: { tag: string; role?: string; name?: string }[] = [];
  let parent = element.parentElement;
  while (parent && ancestors.length < 4) {
    const parentRole = explicitOrImplicitRole(parent);
    const parentName = getAccessibleName(parent);
    ancestors.push({
      tag: parent.tagName.toLowerCase(),
      ...(parentRole ? { role: parentRole } : {}),
      ...(parentName ? { name: parentName.slice(0, 120) } : {}),
    });
    parent = parent.parentElement;
  }
  return {
    tag,
    ...(role ? { role } : {}),
    ...(accessibleName ? { accessibleName } : {}),
    ...(text ? { text } : {}),
    attributes,
    locator,
    cssFallback,
    ancestors,
  };
}

function collectAttributes(element: Element): Record<string, string> {
  const allowed = /^(id|name|type|href|title|alt|placeholder|class|role|aria-[\w-]+|data-(testid|test|cy|qa))$/;
  const entries: [string, string][] = [];
  for (const attribute of Array.from(element.attributes)) {
    if (!allowed.test(attribute.name) || entries.length >= 24) continue;
    let value = normalizedText(attribute.value, 256);
    if (attribute.name === "href") value = sanitizeHref(value);
    if (value) entries.push([attribute.name, value]);
  }
  return Object.fromEntries(entries);
}

function buildLocator(element: Element, role: string, name: string, text: string, cssFallback: string) {
  for (const attribute of ["data-testid", "data-test", "data-cy", "data-qa"]) {
    const value = element.getAttribute(attribute);
    if (value) return { kind: "test-id", value: `${attribute}=${JSON.stringify(value)}`, unique: isUnique(`[${attribute}="${escapeAttribute(value)}"]`) };
  }
  if (element.id) return { kind: "id", value: `#${CSS.escape(element.id)}`, unique: isUnique(`#${CSS.escape(element.id)}`) };
  if (role && name) {
    const matches = Array.from(document.querySelectorAll(roleSelector(role))).filter((candidate) => getAccessibleName(candidate) === name);
    return { kind: "role", value: `role=${role}[name=${JSON.stringify(name)}]`, unique: matches.length === 1 };
  }
  if (element instanceof HTMLInputElement && element.labels?.[0]) {
    const label = normalizedText(element.labels[0].textContent ?? "", 200);
    if (label) return { kind: "label", value: label, unique: true };
  }
  if (text && text.length <= 120) {
    const matches = Array.from(document.querySelectorAll(element.tagName)).filter((candidate) => normalizedText(candidate.textContent ?? "", 500) === text);
    if (matches.length === 1) return { kind: "text", value: text, unique: true };
  }
  return { kind: "css", value: cssFallback, unique: isUnique(cssFallback) };
}

function buildCssPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement && parts.length < 5) {
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    const testAttribute = ["data-testid", "data-test", "data-cy", "data-qa"].find((name) => current?.hasAttribute(name));
    if (testAttribute) {
      parts.unshift(`[${testAttribute}="${escapeAttribute(current.getAttribute(testAttribute) ?? "")}"]`);
      break;
    }
    let part = current.tagName.toLowerCase();
    const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((entry) => entry.tagName === current?.tagName) : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function explicitOrImplicitRole(element: Element): string {
  const explicit = element.getAttribute("role")?.trim();
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4") return "heading";
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "button" || type === "submit" || type === "reset") return "button";
    return "textbox";
  }
  return "";
}

function getAccessibleName(element: Element): string {
  const direct = element.getAttribute("aria-label") || element.getAttribute("alt") || element.getAttribute("title") || element.getAttribute("placeholder");
  if (direct) return normalizedText(direct, 200);
  if (element instanceof HTMLInputElement && element.labels?.[0]) return normalizedText(element.labels[0].textContent ?? "", 200);
  return normalizedText(element.textContent ?? "", 200);
}

function roleSelector(role: string): string {
  if (role === "button") return "button,[role=button],input[type=button],input[type=submit],input[type=reset]";
  if (role === "link") return "a[href],[role=link]";
  if (role === "textbox") return "input:not([type]),input[type=text],input[type=email],input[type=search],input[type=url],textarea,[role=textbox]";
  return `[role="${escapeAttribute(role)}"]`;
}

function isUnique(selector: string): boolean {
  try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

function normalizedText(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function sanitizeHref(value: string): string {
  try {
    const url = new URL(value, location.href);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|password|key|code|auth/i.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return value;
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
