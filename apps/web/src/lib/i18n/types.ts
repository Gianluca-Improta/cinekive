/** Core locale is always English — other packs fall back to en for missing keys. */

export type LocaleCode = "en" | "zh" | "es" | "fr" | "de" | "ja";

export type MessageTree = { [key: string]: string | MessageTree };

export type LocaleMeta = {
  code: LocaleCode;
  label: string;
  nativeLabel: string;
  /** Rough UI pack coverage for the switcher hint. */
  coverage: "full" | "strong" | "partial";
  dir?: "ltr" | "rtl";
};

/** Only locales with a real pack — empty stubs are not listed. */
export const LOCALE_META: LocaleMeta[] = [
  { code: "en", label: "English", nativeLabel: "English", coverage: "full" },
  { code: "zh", label: "Chinese", nativeLabel: "中文", coverage: "strong" },
  { code: "es", label: "Spanish", nativeLabel: "Español", coverage: "strong" },
  { code: "fr", label: "French", nativeLabel: "Français", coverage: "partial" },
  { code: "de", label: "German", nativeLabel: "Deutsch", coverage: "partial" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語", coverage: "partial" },
];

export const DEFAULT_LOCALE: LocaleCode = "en";
export const LOCALE_STORAGE_KEY = "cinekive.locale";
