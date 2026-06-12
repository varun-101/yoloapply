import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, apiError, ApiUserError } from "@/lib/auth";
import { ensureSearchPrefs } from "@/lib/searchPrefs";

// Admin toggles for one user: canScan, isAdmin, and discoveryEnabled (which
// lives on SearchPreference).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));

    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

    // Guard against locking yourself out of admin.
    if (target.id === admin.id && body.isAdmin === false) {
      throw new ApiUserError("you can't remove your own admin access", 400);
    }

    const data: { canScan?: boolean; isAdmin?: boolean } = {};
    if (typeof body.canScan === "boolean") data.canScan = body.canScan;
    if (typeof body.isAdmin === "boolean") data.isAdmin = body.isAdmin;
    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: target.id }, data });
    }

    if (typeof body.discoveryEnabled === "boolean") {
      await ensureSearchPrefs(target.id);
      await prisma.searchPreference.update({
        where: { userId: target.id },
        data: { discoveryEnabled: body.discoveryEnabled },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
