"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/I18nProvider";

type Props = {
  text: string | null | undefined;
  className?: string;
  as?: "p" | "span" | "div";
};

/**
 * Shows English (or source) text, and when locale ≠ en + auto-translate is on,
 * swaps in a translated version via the API language module.
 */
export function TranslatedText({ text, className, as: Tag = "p" }: Props) {
  const { locale, autoTranslateContent, t } = useI18n();
  const [showOriginal, setShowOriginal] = useState(false);
  const source = (text || "").trim();

  useEffect(() => {
    setShowOriginal(false);
  }, [source, locale]);

  const enabled =
    Boolean(source) &&
    autoTranslateContent &&
    locale !== "en" &&
    !showOriginal &&
    source.length > 1;

  const q = useQuery({
    queryKey: ["translate", locale, source.slice(0, 200)],
    queryFn: () =>
      api.translate({
        text: source,
        source_lang: "en",
        target_lang: locale,
      }),
    enabled,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  if (!source) return null;

  const display =
    enabled && q.data?.translated_text && q.data.translated_text !== source
      ? q.data.translated_text
      : source;

  return (
    <Tag className={className}>
      {enabled && q.isFetching ? (
        <span className="text-cinema-muted">{t("detail.translating")}</span>
      ) : (
        display
      )}
      {enabled && q.data?.translated_text && q.data.translated_text !== source && (
        <button
          type="button"
          onClick={() => setShowOriginal((v) => !v)}
          className="ml-2 text-[10px] text-cinema-cyan hover:underline"
        >
          {showOriginal ? t("detail.translate") : t("detail.showOriginal")}
        </button>
      )}
    </Tag>
  );
}
