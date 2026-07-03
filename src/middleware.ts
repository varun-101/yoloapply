import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

// Two auth surfaces:
//  - Browser sessions: Clerk. Pages redirect to /sign-in; /api/* handlers
//    return 401 JSON via requireUser() (src/lib/auth.ts).
//  - Chrome extension: cross-origin Bearer token, validated in route handlers
//    (this middleware runs on the Edge runtime — no Prisma here). Extension
//    requests must NEVER hit Clerk's protect(), which would answer a fetch
//    with an HTML redirect, so the origin branch comes first.

// "/" is the public landing page; the dashboard renders there only once signed
// in. "/share/…" is the public resume/cover-letter share page — its token is
// the auth (verified in the page/route handlers, which also rate-limit).
const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)", "/share(.*)"]);

// Extension IDs differ between dev and prod, so we accept any extension
// origin and rely on the Bearer token for auth.
function isExtensionOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://");
}

function corsHeaders(origin: string | null): Headers {
  const h = new Headers();
  if (origin && isExtensionOrigin(origin)) {
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

export default clerkMiddleware(async (auth, req) => {
  const origin = req.headers.get("origin");

  // CORS preflight — answer before Clerk gets involved (no auth on OPTIONS).
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }

  // Extension traffic: attach CORS and pass through; the route handler
  // resolves the Bearer token to a user.
  if (isExtensionOrigin(origin)) {
    const res = NextResponse.next();
    corsHeaders(origin).forEach((v, k) => res.headers.set(k, v));
    return res;
  }

  // Any other cross-origin caller is rejected outright.
  if (!isSameOrigin(req)) {
    return new NextResponse(JSON.stringify({ error: "cross-origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // API routes fall through — handlers respond 401 JSON via requireUser(),
  // which is friendlier to fetch() callers than a redirect.
  if (req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // Pages: redirect signed-out users to /sign-in.
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    // All pages except Next internals and static assets.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/api/:path*",
  ],
};
