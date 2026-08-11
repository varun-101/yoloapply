import { ApiUserError } from "../auth";
import { getMicrosoftAccessToken } from "./oauth";

// Sending through Microsoft Graph.
//
// The message is handed over as base64 MIME, not as Graph's JSON `message`
// object, and that choice is load-bearing: the JSON form cannot carry
// In-Reply-To / References at all (custom internetMessageHeaders must start
// with "x-"), which would silently break follow-up threading. MIME preserves
// every header nodemailer already builds — see buildMime() in src/lib/mailer.ts.

const GRAPH = "https://graph.microsoft.com/v1.0";

// Graph rejects a single submission over ~4 MB with HTTP 413. Guard a little
// under it and say so in plain language rather than surfacing a raw Graph
// error. Resume PDFs run ~100 KB, so nobody should ever meet this.
const MAX_MIME_BYTES = 3.5 * 1024 * 1024;

// sendMail returns 202 with an empty body — no message id. We need the real
// Message-ID because follow-up.ts threads the follow-up off it, and Exchange
// may rewrite whatever we put in the MIME. So: read it back out of Sent Items.
// Delivery is asynchronous, hence two attempts. The deterministic alternative
// (create draft → read its id → send) needs the Mail.ReadWrite scope, a
// visibly heavier consent screen; this works on the Mail.Read we already have.
const SENT_LOOKUP_DELAYS_MS = [1200, 2500];

export interface GraphSendContext {
  subject: string;
  to: string;
  /** Used when the Sent Items lookup comes up empty — threading may be off, but the send still succeeded. */
  fallbackMessageId: string;
}

interface GraphError {
  error?: { code?: string; message?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SentMessage {
  internetMessageId?: string | null;
  subject?: string | null;
  toRecipients?: { emailAddress?: { address?: string | null } | null }[] | null;
}

// Best effort by design — every failure path here returns null and the caller
// falls back. A send that already succeeded must never be reported as failed
// because we couldn't look up its id afterwards.
async function findSentMessageId(
  accessToken: string,
  ctx: GraphSendContext
): Promise<string | null> {
  const wanted = ctx.to.trim().toLowerCase();
  const url =
    `${GRAPH}/me/mailFolders/sentitems/messages` +
    `?$top=15&$select=internetMessageId,subject,toRecipients&$orderby=sentDateTime desc`;

  for (const delay of SENT_LOOKUP_DELAYS_MS) {
    await sleep(delay);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { value?: SentMessage[] };
      const hit = (data.value ?? []).find(
        (m) =>
          m.internetMessageId &&
          (m.subject ?? "") === ctx.subject &&
          (m.toRecipients ?? []).some(
            (r) => r.emailAddress?.address?.trim().toLowerCase() === wanted
          )
      );
      if (hit?.internetMessageId) return hit.internetMessageId;
    } catch {
      // network hiccup or timeout — try the next delay, then give up
    }
  }
  return null;
}

export async function sendViaGraph(
  userId: string,
  mime: Buffer,
  ctx: GraphSendContext
): Promise<string> {
  if (mime.byteLength > MAX_MIME_BYTES) {
    const mb = (mime.byteLength / (1024 * 1024)).toFixed(1);
    throw new ApiUserError(
      `This email is ${mb} MB, over the ~4 MB limit Outlook accepts in one send. Shrink the attachments or share a link instead.`,
      400,
      "email_too_large"
    );
  }

  const accessToken = await getMicrosoftAccessToken(userId);
  const res = await fetch(`${GRAPH}/me/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "text/plain",
    },
    body: mime.toString("base64"),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as GraphError;
    const detail = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw new ApiUserError(
        `Outlook rejected the send (${detail}). Reconnect your account in Settings → Credentials.`,
        400,
        "microsoft_disconnected"
      );
    }
    throw new ApiUserError(`Outlook couldn't send this email: ${detail}`, 502, "microsoft_send_failed");
  }

  return (await findSentMessageId(accessToken, ctx)) ?? ctx.fallbackMessageId;
}
