import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { ensureSearchPrefs } from "@/lib/searchPrefs";

// Discovery filters: title include/exclude keywords, locations, and the
// scheduled-scan toggle.

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const prefs = await ensureSearchPrefs(user.id);
    return NextResponse.json({ prefs });
  } catch (e) {
    return apiError(e);
  }
}

interface SearchBody {
  includeKeywords?: string[];
  excludeKeywords?: string[];
  locationKeywords?: string[];
  discoveryEnabled?: boolean;
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const s = String(item).trim().toLowerCase();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser(req);
    await ensureSearchPrefs(user.id);
    const body = (await req.json()) as SearchBody;

    const includeKeywords = cleanList(body.includeKeywords);
    const excludeKeywords = cleanList(body.excludeKeywords);
    const locationKeywords = cleanList(body.locationKeywords);

    if (includeKeywords.length === 0) {
      return NextResponse.json(
        { error: "at least one include keyword is required — otherwise no posting can match" },
        { status: 400 }
      );
    }
    // Scheduled discovery needs to know where the user can work; without
    // locations every located posting would be filtered out.
    const discoveryEnabled = !!body.discoveryEnabled && locationKeywords.length > 0;

    const row = await prisma.searchPreference.update({
      where: { userId: user.id },
      data: { includeKeywords, excludeKeywords, locationKeywords, discoveryEnabled },
    });
    return NextResponse.json({
      prefs: {
        userId: user.id,
        includeKeywords: row.includeKeywords,
        excludeKeywords: row.excludeKeywords,
        locationKeywords: row.locationKeywords,
        discoveryEnabled: row.discoveryEnabled,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
