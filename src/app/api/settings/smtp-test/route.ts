import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { getSenderConfig } from "@/lib/credentials";
import { sendEmail } from "@/lib/mailer";

export const maxDuration = 60;

// Sends a test email from the user's own mailbox to itself, so they can verify
// the sender works before a real cold email rides on it. Goes through whichever
// provider is selected (SMTP or a connected Outlook account), so this one
// button covers both.
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const sender = await getSenderConfig(user.id);
    const via = sender.provider === "microsoft" ? "your connected Outlook account" : "your SMTP account";
    await sendEmail(user.id, {
      to: sender.address,
      subject: "YOLOapply send test",
      body: `Sending works — cold emails will go out from this address via ${via}.\n\n— YOLOapply`,
    });
    return NextResponse.json({ ok: true, to: sender.address, provider: sender.provider });
  } catch (e) {
    return apiError(e);
  }
}
