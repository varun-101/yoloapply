import nodemailer from "nodemailer";
import { readFile } from "fs/promises";
import path from "path";
import { owner } from "./owner";

export function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error(
      "SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env (use an app password for Outlook/Gmail)."
    );
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export interface SendOptions {
  to: string;
  toName?: string;
  subject: string;
  body: string; // plain text
  attachResumePdfPath?: string | null;
}

export async function sendEmail(opts: SendOptions): Promise<{ messageId: string }> {
  const transport = getTransport();
  const fromName = process.env.SMTP_FROM_NAME ?? owner.name;
  const fromAddress = process.env.SMTP_USER ?? owner.email;

  const attachments = [];
  if (opts.attachResumePdfPath) {
    const buf = await readFile(opts.attachResumePdfPath);
    attachments.push({
      filename: `Varun_Chandwani_Resume.pdf`,
      content: buf,
      contentType: "application/pdf",
    });
  }

  const info = await transport.sendMail({
    from: { name: fromName, address: fromAddress },
    to: opts.toName ? { name: opts.toName, address: opts.to } : opts.to,
    subject: opts.subject,
    text: opts.body,
    attachments,
  });
  return { messageId: info.messageId };
}
