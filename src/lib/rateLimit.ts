import { NextResponse } from "next/server";

// Fixed-window in-memory rate limiter — guards the public (unauthenticated)
// share endpoints, where every hit costs a DB read and possibly a Supabase
// download. Same single-instance caveat as the discovery locks: counters live
// on globalThis, so horizontal scaling would need a shared store instead.

interface Window {
  count: number;
  resetAt: number;
}

const g = globalThis as unknown as { __rateLimit?: Map<string, Window> };

function store(): Map<string, Window> {
  if (!g.__rateLimit) g.__rateLimit = new Map();
  return g.__rateLimit;
}

// Bounds memory under an address-rotating flood: expired windows are pruned
// opportunistically; if the map is still full afterwards, it resets (which
// briefly *loosens* limits rather than blocking legitimate traffic).
const MAX_ENTRIES = 10_000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const map = store();
  const now = Date.now();
  const k = `${bucket}:${key}`;
  let w = map.get(k);
  if (!w || w.resetAt <= now) {
    if (map.size >= MAX_ENTRIES) {
      for (const [ek, ew] of map) if (ew.resetAt <= now) map.delete(ek);
      if (map.size >= MAX_ENTRIES) map.clear();
    }
    w = { count: 0, resetAt: now + windowMs };
    map.set(k, w);
  }
  w.count += 1;
  return {
    ok: w.count <= limit,
    remaining: Math.max(0, limit - w.count),
    retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
  };
}

// Best-effort client address for keying public-endpoint limits. Behind the
// Railway proxy the first x-forwarded-for hop is the real client; locally
// there's no proxy header and everyone shares "unknown" (fine for dev).
export function clientIpFrom(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = (fwd.split(",")[0] ?? "").trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "unknown";
}

export function tooManyResponse(r: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: "too many requests — slow down" },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } }
  );
}
