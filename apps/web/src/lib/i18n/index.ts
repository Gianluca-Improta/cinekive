import en from "./locales/en";
import zh from "./locales/zh";
import es from "./locales/es";
import fr from "./locales/fr";
import de from "./locales/de";
import ja from "./locales/ja";
import {
  DEFAULT_LOCALE,
  LOCALE_META,
  type LocaleCode,
  type MessageTree,
} from "./types";

const catalogs: Record<LocaleCode, MessageTree> = {
  en,
  zh,
  es,
  fr,
  de,
  ja,
};

function lookup(tree: MessageTree | undefined, path: string[]): string | undefined {
  if (!tree) return undefined;
  let node: string | MessageTree | undefined = tree;
  for (const part of path) {
    if (node == null || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function resolveMessage(locale: LocaleCode, key: string): string {
  const path = key.split(".").filter(Boolean);
  const hit =
    lookup(catalogs[locale], path) ??
    (locale !== DEFAULT_LOCALE ? lookup(catalogs[DEFAULT_LOCALE], path) : undefined);
  return hit ?? key;
}

export function formatMessage(
  template: string,
  vars?: Record<string, string | number>
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`
  );
}

export function t(
  locale: LocaleCode,
  key: string,
  vars?: Record<string, string | number>
): string {
  return formatMessage(resolveMessage(locale, key), vars);
}

export function isLocaleCode(v: string): v is LocaleCode {
  return LOCALE_META.some((m) => m.code === v);
}

export function detectBrowserLocale(): LocaleCode {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const raw = (navigator.language || "en").toLowerCase();
  const short = raw.split("-")[0] || "en";
  if (isLocaleCode(short)) return short;
  if (raw.startsWith("zh")) return "zh";
  return DEFAULT_LOCALE;
}

export { LOCALE_META, DEFAULT_LOCALE, catalogs };
export type { LocaleCode, MessageTree };
