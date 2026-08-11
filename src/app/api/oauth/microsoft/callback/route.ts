import { NextRequest, NextResponse } from "next/server";
import { connectMicrosoftAccount } from "@/lib/microsoft/oauth";
import { verifyOAuthState } from "@/lib/microsoft/state";

// Where Microsoft sends the browser back after the consent screen.
//
// Deliberately does NOT call requireUser: the signed `state` carries the
// userId, so the flow doesn't depend on the Clerk session cookie surviving the
// round trip through login.microsoftonline.com. Verifying that signature is
// also the CSRF defence — without it, someone could hand a victim a callback
// URL that attaches THEIR mailbox to the victim's account.
//
// Every outcome is a redirect back into Settings, because a person is looking
// at this in a browser tab; a JSON error body would be a dead end.

const SETTINGS_PATH = "/settings/credentials";

function back(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL(SETTINGS_PATH, req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // The user cancelled, or an admin blocked consent for the tenant.
  const oauthError = params.get("error");
  if (oauthError) {
    const description = params.get("error_description");
    return back(req, {
      msError:
        oauthError === "access_denied"
          ? "Outlook connection cancelled."
          : (description ?? oauthError).slice(0, 300),
    });
  }

  const state = verifyOAuthState(params.get("state"));
  if (!state.ok) {
    return back(req, {
      msError:
        state.reason === "expired"
          ? "That Outlook sign-in took too long — try connecting again."
          : "Invalid Outlook sign-in request. Start again from Settings.",
    });
  }

  const code = params.get("code");
  if (!code) return back(req, { msError: "Microsoft didn't return an authorization code." });

  try {
    const { email } = await connectMicrosoftAccount(state.userId, code);
    return back(req, { msConnected: email });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return back(req, { msError: message.slice(0, 300) });
  }
}
