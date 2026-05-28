import { NextRequest, NextResponse } from "next/server";

// Origins allowed to call /api/* cross-origin. Extension IDs differ between dev
// and prod, so we accept any `chrome-extension://*` origin and verify auth via
// Bearer token instead.
function isAllowedCrossOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (origin.startsWith("chrome-extension://")) return true;
  if (origin.startsWith("moz-extension://")) return true;
  return false;
}

function corsHeaders(origin: string | null): Headers {
  const h = new Headers();
  if (origin && isAllowedCrossOrigin(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Vary", "Origin");
  }
  h.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  h.set("Access-Control-Max-Age", "600");
  return h;
}

function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // server-side, curl, same-origin fetch
  try {
    const o = new URL(origin);
    const host = req.headers.get("host") ?? "";
    return o.host === host;
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest): NextResponse {
  const origin = req.headers.get("origin");

  // CORS preflight — answer immediately.
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }

  // Same-origin requests: no auth needed (web app at localhost:3001).
  if (isSameOrigin(req)) {
    const res = NextResponse.next();
    corsHeaders(origin).forEach((v, k) => res.headers.set(k, v));
    return res;
  }

  // Cross-origin: only allow known extension origins, and require Bearer auth.
  if (!isAllowedCrossOrigin(origin)) {
    return new NextResponse(JSON.stringify({ error: "cross-origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...Object.fromEntries(corsHeaders(origin)) },
    });
  }

  const expected = process.env.EXTENSION_API_KEY;
  if (!expected) {
    return new NextResponse(
      JSON.stringify({ error: "EXTENSION_API_KEY not configured on the server" }),
      {
        status: 503,
        headers: { "Content-Type": "application/json", ...Object.fromEntries(corsHeaders(origin)) },
      }
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (presented !== expected) {
    return new NextResponse(JSON.stringify({ error: "invalid api key" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...Object.fromEntries(corsHeaders(origin)) },
    });
  }

  const res = NextResponse.next();
  corsHeaders(origin).forEach((v, k) => res.headers.set(k, v));
  return res;
}

export const config = {
  matcher: "/api/:path*",
};
