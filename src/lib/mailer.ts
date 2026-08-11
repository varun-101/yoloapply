import nodemailer from "nodemailer";
import { getSmtpConfig } from "./credentials";

// Outbound email sends through the USER's own SMTP account (Gmail app
// password saved in Settings → Credentials) — cold emails must come from
// the applicant's address, not a shared one.

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendOptions {
  to: string;
  toName?: string;
  subject: string;
  body: string; // plain text
  attachments?: MailAttachment[];
  inReplyTo?: string;
  references?: string[];
}

export async function sendEmail(
  userId: string,
  opts: SendOptions
): Promise<{ messageId: string; fromAddress: string }> {
  const smtp = await getSmtpConfig(userId);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });

  const info = await transport.sendMail({
    from: { name: smtp.fromName, address: smtp.user },
    to: opts.toName ? { name: opts.toName, address: opts.to } : opts.to,
    subject: opts.subject,
    text: opts.body,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
    attachments: (opts.attachments ?? []).map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType ?? "application/pdf",
    })),
  });
  return { messageId: info.messageId, fromAddress: smtp.user };
}
