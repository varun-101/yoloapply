import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/auth";

// All users with the flags + counts the admin panel manages.
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        canScan: true,
        createdAt: true,
        profile: { select: { name: true } },
        searchPref: { select: { discoveryEnabled: true } },
        credential: { select: { deepseekKeyEnc: true } },
        _count: { select: { applications: true, userLeads: true } },
      },
    });
    // Never leak the encrypted key — expose presence only.
    return NextResponse.json(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.profile?.name ?? null,
        isAdmin: u.isAdmin,
        canScan: u.canScan,
        discoveryEnabled: u.searchPref?.discoveryEnabled ?? false,
        hasDeepseekKey: !!u.credential?.deepseekKeyEnc,
        applications: u._count.applications,
        leads: u._count.userLeads,
        createdAt: u.createdAt,
      }))
    );
  } catch (e) {
    return apiError(e);
  }
}
