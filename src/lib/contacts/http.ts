// Shared fetch helpers for the scraping lanes: a browser-ish User-Agent, a hard
// timeout, and a size cap so a giant page can't blow up memory. All return null
// on any failure (lanes degrade rather than throw).

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MAX_BYTES = 1_500_000; // 1.5 MB is plenty for a marketing/team page

export async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/(xhtml|xml|json)|text\/plain/.test(ct) && ct) return null;
    const buf = await res.arrayBuffer();
    return Buffer.from(buf.slice(0, MAX_BYTES)).toString("utf8");
  } catch {
    return null;
  }
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 10000
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, Accept: "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
