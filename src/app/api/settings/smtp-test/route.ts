import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { getSmtpConfig } from "@/lib/credentials";
import { sendEmail } from "@/lib/mailer";

export const maxDuration = 60;

// Sends a test email from the user's SMTP account to itself, so they can
// verify the app password before a real cold email rides on it.
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const smtp = await getSmtpConfig(user.id);
    await sendEmail(user.id, {
      to: smtp.user,
      subject: "YOLOapply SMTP test",
      body: "Your SMTP credentials work — cold emails will send from this account.\n\n— YOLOapply",
    });
    return NextResponse.json({ ok: true, to: smtp.user });
  } catch (e) {
    return apiError(e);
  }
}
