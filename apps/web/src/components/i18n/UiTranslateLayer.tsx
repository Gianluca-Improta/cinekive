"use client";

import { useEffect } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { setUiTranslateLocale, stopUiTranslateLayer } from "@/lib/i18n/ui-translate";

/**
 * Sits on top of the whole app: when locale ≠ English and UI auto-translate
 * is on, translates remaining hardcoded English chrome via the language API.
 * Catalog strings from t() are already localized and usually skipped.
 */
export function UiTranslateLayer() {
  const { locale, autoTranslateUi } = useI18n();

  useEffect(() => {
    if (!autoTranslateUi || locale === "en") {
      stopUiTranslateLayer();
      return;
    }
    setUiTranslateLocale(locale);
    return () => stopUiTranslateLayer();
  }, [locale, autoTranslateUi]);

  return null;
}
