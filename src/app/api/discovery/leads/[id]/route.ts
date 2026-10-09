import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { isSettableLeadStatus, setLeadStatus, SETTABLE_LEAD_STATUSES } from "@/lib/discovery/leadStatus";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const status = body?.status;
    if (!isSettableLeadStatus(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${SETTABLE_LEAD_STATUSES.map((s) => `'${s}'`).join(", ")}` },
        { status: 400 }
      );
    }
    // Dismiss / mark unavailable / restore is per-user: it only affects this
    // user's overlay on the shared catalog row.
    const updated = await setLeadStatus(user.id, params.id, status);
    return NextResponse.json(updated);
  } catch (e) {
    return apiError(e);
  }
}
