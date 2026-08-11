import { isPlausibleEmail } from "../verify";
import { TARGET_TITLES, type LaneResult, type RawCandidate } from "../types";

const SEARCH_ENDPOINT = "https://api.apollo.io/api/v1/mixed_people/api_search";
const ENRICH_ENDPOINT = "https://api.apollo.io/api/v1/people/match";

interface ApolloPerson {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  last_name_obfuscated?: string;
  title?: string;
  email?: string | null;
  email_status?: string | null;
  linkedin_url?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}
interface ApolloResponse { people?: ApolloPerson[]; person?: ApolloPerson }
interface ApolloErrorBody { error?: string; message?: string; error_code?: string }

class ApolloApiError extends Error {
  constructor(public statusCode: number, public errorCode: string | null, message: string) {
    super(message);
  }
}

function locationOf(person: ApolloPerson): string | undefined {
  return [person.city, person.state, person.country].filter(Boolean).join(", ") || undefined;
}

function nameOf(person: ApolloPerson): string | undefined {
  return (person.name ?? `${person.first_name ?? ""} ${person.last_name ?? person.last_name_obfuscated ?? ""}`).trim() || undefined;
}

async function apolloRequest<T>(request: typeof fetch, url: string, apiKey: string, params: URLSearchParams): Promise<T> {
  const response = await request(`${url}?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "Cache-Control": "no-cache", "x-api-key": apiKey },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const raw = (await response.text().catch(() => "")).slice(0, 1000);
    let parsed: ApolloErrorBody = {};
    try { parsed = JSON.parse(raw) as ApolloErrorBody; } catch { /* Apollo may return plain text */ }
    const code = parsed.error_code ?? null;
    const providerMessage = parsed.error ?? parsed.message ?? (raw || response.statusText);
    const message = code === "API_INACCESSIBLE"
      ? "Apollo People Search requires a paid Apollo plan; Free-plan API keys cannot access this endpoint."
      : response.status === 401
        ? "Apollo rejected the API key. Create or copy a valid API key from Apollo settings."
        : response.status === 429
          ? "Apollo rate limit exceeded."
          : providerMessage;
    throw new ApolloApiError(response.status, code, `Apollo returned HTTP ${response.status}${code ? ` (${code})` : ""}: ${message}`);
  }
  return (await response.json()) as T;
}

function laneStatus(error: unknown): LaneResult["status"] {
  if (error instanceof ApolloApiError) {
    if (error.errorCode === "API_INACCESSIBLE") return "plan_required";
    if (error.statusCode === 401 || error.statusCode === 403) return "auth_error";
    if (error.statusCode === 402) return "quota_exhausted";
    if (error.statusCode === 429) return "rate_limited";
  }
  return "error";
}

export async function fetchApolloContacts(
  domain: string | null,
  company: string,
  apiKey: string,
  location?: string | null,
  request: typeof fetch = fetch
): Promise<LaneResult> {
  try {
    // Apollo documents these as query parameters with repeated [] array keys.
    const params = new URLSearchParams({ page: "1", per_page: "25", include_similar_titles: "true" });
    for (const title of TARGET_TITLES) params.append("person_titles[]", title);
    if (domain) params.append("q_organization_domains_list[]", domain);
    else params.set("q_organization_name", company);
    if (location) params.append("person_locations[]", location);

    const response = await apolloRequest<ApolloResponse>(request, SEARCH_ENDPOINT, apiKey, params);
    const candidates: RawCandidate[] = (response.people ?? [])
      .map((person) => ({
        name: nameOf(person),
        title: person.title ?? undefined,
        linkedinUrl: person.linkedin_url ?? undefined,
        location: locationOf(person),
        providerPersonId: person.id,
        source: "apollo" as const,
        confidence: 0,
        verified: false,
        contactStatus: "not_requested" as const,
      }))
      .filter((person) => person.name && person.providerPersonId);
    return { source: "apollo", candidates, status: "ok" };
  } catch (error) {
    return {
      source: "apollo",
      candidates: [],
      error: error instanceof Error ? error.message : String(error),
      status: laneStatus(error),
    };
  }
}

export async function resolveApolloContact(
  apiKey: string,
  person: { providerPersonId?: string | null; name?: string | null; linkedinUrl?: string | null; domain?: string | null },
  request: typeof fetch = fetch
): Promise<RawCandidate> {
  const params = new URLSearchParams({ reveal_personal_emails: "false", reveal_phone_number: "false" });
  if (person.providerPersonId) params.set("id", person.providerPersonId);
  if (person.linkedinUrl) params.set("linkedin_url", person.linkedinUrl);
  if (person.name) params.set("name", person.name);
  if (person.domain) params.set("domain", person.domain);
  const response = await apolloRequest<ApolloResponse>(request, ENRICH_ENDPOINT, apiKey, params);
  const result = response.person;
  const email = result?.email && isPlausibleEmail(result.email) ? result.email.toLowerCase() : undefined;
  return {
    name: result ? nameOf(result) : person.name ?? undefined,
    title: result?.title ?? undefined,
    email,
    linkedinUrl: result?.linkedin_url ?? person.linkedinUrl ?? undefined,
    location: result ? locationOf(result) : undefined,
    providerPersonId: result?.id ?? person.providerPersonId ?? undefined,
    source: "apollo",
    confidence: email ? (result?.email_status === "verified" ? 0.92 : 0.7) : 0,
    verified: result?.email_status === "verified",
    verifyMethod: result?.email_status === "verified" ? "apollo" : undefined,
    contactStatus: email ? "resolved" : "failed",
  };
}
