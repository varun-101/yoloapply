import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";

// Lightweight identity for client components that need to gate UI (e.g. the
// Discover "Scan now" button, the Admin nav entry).
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    return NextResponse.json({
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
      canScan: user.canScan,
    });
  } catch (e) {
    return apiError(e);
  }
}
