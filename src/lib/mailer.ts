import nodemailer from "nodemailer";
import { getSenderConfig, type SmtpConfig } from "./credentials";
import { sendViaGraph } from "./microsoft/graphMail";

// Outbound email always leaves from the USER's own mailbox — cold emails must
// come from the applicant's address, never a shared sender. Two ways to get
// there, chosen explicitly in Settings → Credentials:
//   - "smtp":      their own SMTP account (e.g. a Gmail app password)
//   - "microsoft": an Outlook / Microsoft 365 account connected over OAuth,
//                  sent through Graph (src/lib/microsoft/graphMail.ts)
//
// Both paths compile the SAME nodemailer message, so attachments and the
// In-Reply-To / References headers that thread follow-ups behave identically
// whichever provider is selected.

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

function messagePayload(opts: SendOptions, from: { name: string; address: string }) {
  return {
    from,
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
  };
}

// Compiles the message to raw RFC5322 MIME instead of delivering it. Graph's
// sendMail accepts exactly this (base64) and it is the only Graph form that
// can carry In-Reply-To / References — its JSON message object restricts
// custom headers to ones starting with "x-".
async function buildMime(
  opts: SendOptions,
  from: { name: string; address: string }
): Promise<{ mime: Buffer; messageId: string }> {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows", // CRLF — what RFC5322 wants and what Exchange expects
  });
  const info = await transport.sendMail(messagePayload(opts, from));
  return { mime: info.message as Buffer, messageId: info.messageId };
}

async function sendViaSmtp(
  smtp: SmtpConfig,
  opts: SendOptions
): Promise<{ messageId: string; fromAddress: string }> {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  const info = await transport.sendMail(
    messagePayload(opts, { name: smtp.fromName, address: smtp.user })
  );
  return { messageId: info.messageId, fromAddress: smtp.user };
}

export async function sendEmail(
  userId: string,
  opts: SendOptions
): Promise<{ messageId: string; fromAddress: string }> {
  const sender = await getSenderConfig(userId);

  if (sender.provider === "microsoft") {
    const from = { name: sender.fromName, address: sender.address };
    const { mime, messageId } = await buildMime(opts, from);
    const sentMessageId = await sendViaGraph(userId, mime, {
      subject: opts.subject,
      to: opts.to,
      fallbackMessageId: messageId,
    });
    return { messageId: sentMessageId, fromAddress: sender.address };
  }

  return sendViaSmtp(sender.smtp, opts);
}
