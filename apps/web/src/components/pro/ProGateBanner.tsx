"use client";

import { Crown } from "lucide-react";
import { PRO_UPGRADE_URL, useEntitlements } from "@/hooks/useEntitlements";
import { cn } from "@/lib/utils";

type Props = {
  feature?: string;
  title?: string;
  detail?: string;
  className?: string;
  compact?: boolean;
};

export function ProGateBanner({
  feature,
  title = "Cinekive Pro",
  detail = "Unlock studio workflow tools with a one-time purchase.",
  className,
  compact,
}: Props) {
  const { data } = useEntitlements();
  if (data?.is_pro) return null;
  const url = data?.upgrade_url || PRO_UPGRADE_URL;
  const price = data?.price_usd ?? 19;

  return (
    <div
      className={cn(
        "rounded-xl border border-cinema-cyan/30 bg-cinema-cyan/5 px-3 py-2.5",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <Crown className="mt-0.5 h-4 w-4 shrink-0 text-cinema-cyan" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white">{title}</p>
          {!compact && (
            <p className="mt-0.5 text-[11px] text-cinema-muted">
              {detail}
              {feature ? ` (${feature})` : ""}
            </p>
          )}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center rounded-lg bg-cinema-cyan px-2.5 py-1 text-xs font-semibold text-black hover:opacity-90"
          >
            Unlock Pro — ${price}
          </a>
        </div>
      </div>
    </div>
  );
}
