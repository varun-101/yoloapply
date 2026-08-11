import type { LaneResult, RawCandidate } from "../types";

const SEARCH_URL = "https://www.signalhire.com/api/v1/candidate/searchByQuery";
const PERSON_URL = "https://www.signalhire.com/api/v1/candidate/search";
const RECRUITER_TITLES =
  '"Technical Recruiter" OR "Engineering Recruiter" OR "Technical Talent Acquisition" OR "Talent Acquisition Partner" OR Recruiter OR "Head of Talent" OR "People Partner"';

interface SearchProfile {
  uid?: string;
  fullName?: string;
  location?: string;
  experience?: Array<{ company?: string | null; title?: string | null; current?: boolean | null }>;
}
interface SearchResponse { profiles?: SearchProfile[] }
interface SignalHireCandidate {
  fullName?: string;
  locations?: Array<{ name?: string | null }>;
  // Kept for compatibility with older SignalHire responses.
  location?: string;
  contacts?: Array<{ type?: string; value?: string; rating?: number; subType?: string }>;
  social?: Array<{ type?: string; link?: string; rating?: number }>;
  experience?: Array<{ position?: string | null; company?: string | null; current?: boolean | null }>;
}
interface PersonResult { item?: string; status?: string; candidate?: SignalHireCandidate }

function titleFromSearch(profile: SearchProfile): string | undefined {
  return profile.experience?.find((entry) => entry.current)?.title ?? profile.experience?.find((entry) => entry.title)?.title ?? undefined;
}
function recruiterPriority(title?: string | null): number {
  const value = (title ?? "").toLowerCase();
  if (/technical recruiter|engineering recruiter/.test(value)) return 100;
  if (/talent acquisition.*(engineering|technical)|engineering.*talent/.test(value)) return 95;
  if (/talent acquisition|recruiter/.test(value)) return 85;
  if (/head of people|head of talent|people partner|hr manager/.test(value)) return 70;
  return 20;
}

async function requestJson<T>(request: typeof fetch, url: string, apiKey: string, body: Record<string, unknown>) {
  const response = await request(url, {
    method: "POST",
    headers: { apikey: apiKey, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const creditsRemaining = response.headers.get("x-credits-left") ?? undefined;
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    const hint = response.status === 401 ? "invalid API key" : response.status === 402 ? "credits or daily search quota exhausted" : response.status === 429 ? "rate limit exceeded" : detail || response.statusText;
    throw new Error(`SignalHire returned HTTP ${response.status}: ${hint}`);
  }
  return { data: (await response.json()) as T, creditsRemaining };
}

function statusFromError(error: string): LaneResult["status"] {
  if (/HTTP 402|quota exhausted/i.test(error)) return "quota_exhausted";
  if (/HTTP 401|invalid API key/i.test(error)) return "auth_error";
  if (/HTTP 429|rate limit/i.test(error)) return "rate_limited";
  return "error";
}

export async function fetchSignalHireContacts(
  company: string,
  apiKey: string,
  request: typeof fetch = fetch,
  location?: string | null
): Promise<LaneResult> {
  try {
    const body: Record<string, unknown> = { currentCompany: company, currentTitle: RECRUITER_TITLES, size: 25 };
    if (location) body.location = location;
    const { data: search, creditsRemaining } = await requestJson<SearchResponse>(request, SEARCH_URL, apiKey, body);
    const candidates: RawCandidate[] = (search.profiles ?? [])
      .filter((profile) => profile.uid && profile.fullName)
      .sort((a, b) => recruiterPriority(titleFromSearch(b)) - recruiterPriority(titleFromSearch(a)))
      .slice(0, 25)
      .map((profile) => ({
        name: profile.fullName,
        title: titleFromSearch(profile),
        location: profile.location,
        providerPersonId: profile.uid,
        source: "signalhire",
        confidence: 0,
        verified: false,
        contactStatus: "not_requested",
      }));
    return { source: "signalhire", candidates, status: "ok", creditsRemaining };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { source: "signalhire", candidates: [], error: message, status: statusFromError(message) };
  }
}

export async function resolveSignalHireContact(
  apiKey: string,
  person: { providerPersonId?: string | null; linkedinUrl?: string | null; name?: string | null },
  request: typeof fetch = fetch
): Promise<RawCandidate> {
  const item = person.providerPersonId || person.linkedinUrl;
  if (!item) throw new Error("SignalHire needs a profile ID or LinkedIn URL to reveal contact details.");
  const { data } = await requestJson<PersonResult[]>(request, PERSON_URL, apiKey, { items: [item], withoutWaterfall: true });
  const result = data[0];
  const candidate = result?.status === "success" ? result.candidate : undefined;
  const emails = (candidate?.contacts ?? []).filter((contact) => contact.type === "email" && contact.value).sort((a, b) => (b.subType === "work" ? 1000 : 0) + (b.rating ?? 0) - ((a.subType === "work" ? 1000 : 0) + (a.rating ?? 0)));
  const phones = (candidate?.contacts ?? []).filter((contact) => contact.type === "phone" && contact.value).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const linkedIn = (candidate?.social ?? [])
    .filter((social) => social.type === "li" && social.link && /^https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\//i.test(social.link))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0]?.link;
  const currentExperience = candidate?.experience?.find((entry) => entry.current) ?? candidate?.experience?.[0];
  const email = emails[0];
  return {
    name: candidate?.fullName ?? person.name ?? undefined,
    title: currentExperience?.position ?? undefined,
    email: email?.value?.toLowerCase(),
    phone: phones[0]?.value,
    linkedinUrl: linkedIn ?? person.linkedinUrl ?? undefined,
    location: candidate?.locations?.find((location) => location.name)?.name ?? candidate?.location,
    providerPersonId: person.providerPersonId ?? undefined,
    source: "signalhire",
    confidence: email ? Math.min(0.92, Math.max(0.65, (email.rating ?? 75) / 100)) : 0,
    verified: false,
    contactStatus: email ? "resolved" : "failed",
  };
}
