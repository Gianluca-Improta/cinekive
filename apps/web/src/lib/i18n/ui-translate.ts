/**
 * Optional DOM overlay for leftover English chrome.
 * Default OFF — catalog packs are the reliable path. When enabled, applies
 * cached translations only (no live fight with React re-renders mid-edit).
 */

import { api } from "@/lib/api-client";
import type { LocaleCode } from "@/lib/i18n/types";

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "CODE",
  "PRE",
  "KBD",
  "SVG",
  "PATH",
  "MATH",
  "BUTTON", // avoid flipping labels under the cursor mid-click
]);

/** English → translated for active locale (session + localStorage). */
const memoryCache = new Map<string, string>();
/** Translated → English so we never re-send already-localized text. */
const reverseCache = new Map<string, string>();

const pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let activeLocale: LocaleCode = "en";
let enabled = false;
let flushing = false;
let observer: MutationObserver | null = null;
let passCount = 0;

function cacheKey(locale: string, text: string): string {
  return `${locale}::${text}`;
}

function storageKey(locale: string, text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `cinekive.uiTx2.${locale}.${h.toString(36)}.${text.length}`;
}

function readPersisted(locale: string, text: string): string | null {
  const mem = memoryCache.get(cacheKey(locale, text));
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(storageKey(locale, text));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { s: string; t: string };
    if (parsed.s !== text) return null;
    memoryCache.set(cacheKey(locale, text), parsed.t);
    reverseCache.set(cacheKey(locale, parsed.t), text);
    return parsed.t;
  } catch {
    return null;
  }
}

function writePersisted(locale: string, text: string, translated: string) {
  memoryCache.set(cacheKey(locale, text), translated);
  reverseCache.set(cacheKey(locale, translated), text);
  try {
    localStorage.setItem(storageKey(locale, text), JSON.stringify({ s: text, t: translated }));
  } catch {
    /* quota */
  }
}

export function looksLikeEnglishUi(text: string): boolean {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length < 3 || s.length > 200) return false;
  if (!/[A-Za-z]{3,}/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return false;
  if (/^[\w.-]+@[\w.-]+$/.test(s)) return false;
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return false;
  if (/^[\\/].*[\\/]/.test(s)) return false;
  if (/^[a-z]+(_[a-z0-9]+)+$/i.test(s)) return false;
  if (/^\d+(\.\d+)?%?$/.test(s)) return false;
  // Already localized (CJK / Hangul / Cyrillic-heavy)
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const other = (s.match(/[\u0400-\u04ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
  if (other >= latin) return false;
  return true;
}

function shouldSkipElement(el: Element | null): boolean {
  if (!el) return true;
  if (el.closest("[data-no-translate], [contenteditable='true'], [data-tx-lock]")) return true;
  if (SKIP_TAGS.has(el.tagName)) return true;
  // Don't touch focused fields / open menus mid-interaction
  if (typeof document !== "undefined") {
    const ae = document.activeElement;
    if (ae && (ae === el || el.contains(ae))) return true;
  }
  return false;
}

function collectTextNodes(root: ParentNode): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node as Text;
      const parent = text.parentElement;
      if (!parent || shouldSkipElement(parent)) return NodeFilter.FILTER_REJECT;
      const trimmed = (text.nodeValue || "").trim();
      if (!trimmed) return NodeFilter.FILTER_REJECT;
      // Already a known translation for this locale — leave alone
      if (reverseCache.has(cacheKey(activeLocale, trimmed))) return NodeFilter.FILTER_REJECT;
      if (!looksLikeEnglishUi(trimmed)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode())) out.push(n as Text);
  return out;
}

function applyToNode(node: Text, original: string, translated: string) {
  if (!translated || translated === original) return;
  const cur = node.nodeValue || "";
  const lead = cur.match(/^\s*/)?.[0] ?? "";
  const trail = cur.match(/\s*$/)?.[0] ?? "";
  node.nodeValue = `${lead}${translated}${trail}`;
  const parent = node.parentElement;
  if (parent) parent.setAttribute("data-tx-lock", "1");
}

async function flushQueue() {
  if (flushing || !enabled || activeLocale === "en") return;
  flushing = true;
  try {
    while (pending.size > 0) {
      const batch = [...pending].slice(0, 30);
      batch.forEach((t) => pending.delete(t));
      const need = batch.filter((t) => !readPersisted(activeLocale, t));
      if (need.length) {
        try {
          const res = await api.translateBatch({
            texts: need,
            source_lang: "en",
            target_lang: activeLocale,
          });
          for (const item of res.items) {
            writePersisted(
              activeLocale,
              item.text,
              item.translated_text && item.translated_text !== item.text
                ? item.translated_text
                : item.text
            );
          }
        } catch {
          for (const t of need) writePersisted(activeLocale, t, t);
        }
      }
      const nodes = collectTextNodes(document.body);
      for (const node of nodes) {
        const original = (node.nodeValue || "").trim();
        const hit = readPersisted(activeLocale, original);
        if (hit && hit !== original) applyToNode(node, original, hit);
      }
    }
  } finally {
    flushing = false;
  }
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, 400);
}

function enqueueFromDom(root: ParentNode = document.body) {
  if (!enabled || activeLocale === "en") return;
  // Cap passes per session to avoid endless React ↔ translate loops
  if (passCount > 40) return;
  const nodes = collectTextNodes(root);
  let added = false;
  for (const node of nodes) {
    const original = (node.nodeValue || "").trim();
    const cached = readPersisted(activeLocale, original);
    if (cached && cached !== original) {
      applyToNode(node, original, cached);
      continue;
    }
    if (cached === original) continue;
    if (!pending.has(original)) {
      pending.add(original);
      added = true;
    }
  }
  if (added) {
    passCount += 1;
    scheduleFlush();
  }
}

export function startUiTranslateLayer(locale: LocaleCode) {
  activeLocale = locale;
  enabled = locale !== "en";
  passCount = 0;
  if (!enabled) {
    stopUiTranslateLayer();
    return;
  }
  enqueueFromDom(document.body);
  if (!observer) {
    observer = new MutationObserver(() => {
      if (!enabled) return;
      // Debounced — avoid per-keystroke / per-frame thrash
      scheduleFlush();
      enqueueFromDom(document.body);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: false, // don't fight React character updates
    });
  }
}

export function stopUiTranslateLayer() {
  enabled = false;
  pending.clear();
  passCount = 0;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (typeof document !== "undefined") {
    document.querySelectorAll("[data-tx-lock]").forEach((el) => el.removeAttribute("data-tx-lock"));
  }
}

export function setUiTranslateLocale(locale: LocaleCode) {
  if (locale === "en") {
    stopUiTranslateLayer();
    activeLocale = "en";
    return;
  }
  activeLocale = locale;
  startUiTranslateLayer(locale);
}
