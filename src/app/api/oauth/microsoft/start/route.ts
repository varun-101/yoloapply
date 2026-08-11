import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { authorizeUrl } from "@/lib/microsoft/oauth";
import { createOAuthState } from "@/lib/microsoft/state";

// Kicks off the Outlook connect flow. Reached by a full-page navigation from
// Settings → Credentials (not a fetch — it has to leave the page), so the
// response is a redirect to Microsoft's consent screen.
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    return NextResponse.redirect(authorizeUrl(createOAuthState(user.id)));
  } catch (e) {
    return apiError(e);
  }
}
