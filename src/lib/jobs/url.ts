// Params that describe click attribution rather than posting identity. ATS
// tokens and every other query parameter remain intact.
const TRACKING_PARAMS = new Set([
  "src",
  "source",
  "gh_src",
  "ref",
  "trk",
  "trackingid",
  "alternatechannel",
  "ebp",
  "lipi",
]);

export function canonicalizeJobUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}
