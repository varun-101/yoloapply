/* YOLOapply service worker.
 *
 * Deliberately minimal. This app is multi-tenant and almost every page is
 * personalized behind Clerk, so caching HTML or API responses would risk
 * showing one user's data (or stale pipeline state) to another session.
 * The rules:
 *   - navigations  → network only, with an offline fallback page
 *   - build assets → cache-first (Next hashes /_next/static/*, so a cached
 *                    entry can never be stale for a different build)
 *   - icons        → cache-first. Unlike /_next/static these filenames are
 *                    stable, so an already-installed client keeps the old PNG
 *                    until VERSION below changes — bump it when you re-run
 *                    scripts/generate-icons.ts.
 *   - everything else (all /api/*, Clerk, POSTs) → untouched, straight to network
 *
 * Registered by src/components/pwa/register-sw.tsx in production only.
 */

// Bumping this drops every old cache in `activate` — the only way to force an
// installed client off stale icons or a stale /offline shell.
const VERSION = "v1";
const SHELL = `yoloapply-shell-${VERSION}`;
const ASSETS = `yoloapply-assets-${VERSION}`;
const OFFLINE_URL = "/offline";

// Precached without credentials: /offline is a public route, so this caches the
// signed-out shell and never a page rendered with the user's session data.
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(new Request(url, { credentials: "omit", cache: "reload" }));
            if (res.ok) await cache.put(url, res);
          } catch {
            /* offline at install time — the runtime handlers still work */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS]);
      const names = await caches.keys();
      await Promise.all(names.map((n) => (keep.has(n) ? null : caches.delete(n))));
      await self.clients.claim();
    })()
  );
});

function isBuildAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return; // Clerk, Supabase, fonts
  if (url.pathname.startsWith("/api/")) return; // never cache tenant data

  if (isBuildAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) (await caches.open(ASSETS)).put(req, res.clone());
        return res;
      })()
    );
    return;
  }

  // Page loads: always live data; fall back to the offline page only when the
  // network is genuinely gone (a 4xx/5xx from the server is still the truth).
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          return (await caches.match(OFFLINE_URL)) ?? Response.error();
        }
      })()
    );
  }
});
