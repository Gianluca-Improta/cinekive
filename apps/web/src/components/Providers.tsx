"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { UiTranslateLayer } from "@/components/i18n/UiTranslateLayer";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { AppearanceProvider } from "@/lib/appearance";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <AppearanceProvider>
        <I18nProvider>
          <UiTranslateLayer />
          {children}
        </I18nProvider>
      </AppearanceProvider>
    </QueryClientProvider>
  );
}
