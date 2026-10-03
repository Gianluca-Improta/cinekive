import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Keep in step with isPrivateHost in api-client.ts. Middleware cannot import that module. */
function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").split(":")[0].toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  if (isPrivateHost(host)) return NextResponse.next();
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return NextResponse.next();
  }
  return NextResponse.json(
    { detail: "This public link is read-only. Ingest and edits stay on the machine running Cinekive." },
    { status: 403 }
  );
}

export const config = {
  matcher: ["/cinekive-api/:path*"],
};
