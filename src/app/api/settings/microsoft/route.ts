import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { disconnectMicrosoft } from "@/lib/microsoft/oauth";

// Disconnect the connected Outlook mailbox. Clears the stored tokens and
// falls the sender back to SMTP, so nobody is left pointed at a provider that
// can no longer send. Revoking the app's access entirely is done on
// Microsoft's side (account.live.com / myapps.microsoft.com).
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser(req);
    await disconnectMicrosoft(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
