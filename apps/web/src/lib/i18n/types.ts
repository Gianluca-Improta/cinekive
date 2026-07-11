/** Core locale is always English — other packs fall back to en for missing keys. */

export type LocaleCode =
  | "en"
  | "zh"
  | "es"
  | "fr"
  | "de"
  | "ja"
  | "pt"
  | "ko"
  | "it"
  | "ru";

export type MessageTree = { [key: string]: string | MessageTree };

export type LocaleMeta = {
  code: LocaleCode;
  label: string;
  nativeLabel: string;
  dir?: "ltr" | "rtl";
};

export const LOCALE_META: LocaleMeta[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "zh", label: "Chinese", nativeLabel: "中文" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português" },
  { code: "ko", label: "Korean", nativeLabel: "한국어" },
  { code: "it", label: "Italian", nativeLabel: "Italiano" },
  { code: "ru", label: "Russian", nativeLabel: "Русский" },
];

export const DEFAULT_LOCALE: LocaleCode = "en";
export const LOCALE_STORAGE_KEY = "cinekive.locale";
