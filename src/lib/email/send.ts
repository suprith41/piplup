import nodemailer from "nodemailer";
import { findLink } from "../razorpay/audit.ts";
import { mailToHtml, mailToText, punchyMail } from "./copy.ts";
import { MAX_SENDS_PER_INBOX, remaining, recordSend, sentCount } from "./quota.ts";
import { allowedInboxes, DEMO_INBOXES, type DemoInbox } from "./recipients.ts";

export function mailStatus(): { configured: boolean; from: string } {
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";
  return {
    configured: Boolean(user && pass),
    from: process.env.SMTP_FROM || user,
  };
}

function transporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    throw new Error("Email not set up. Add SMTP_USER and SMTP_PASS to .env.local (Gmail app password).");
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user, pass },
  });
}

function bodyFor(inbox: DemoInbox): { subject: string; text: string; html: string } {
  const link = findLink(inbox.caseId)?.shortUrl;
  const mail = punchyMail(inbox, link);
  return {
    subject: mail.subject,
    text: mailToText(mail, link),
    html: mailToHtml(mail, link),
  };
}

export async function sendReminders(
  emails: string[],
): Promise<Array<{ email: string; name: string; ok: boolean; error?: string; sent?: number; left?: number }>> {
  const targets = allowedInboxes(emails);
  if (targets.length === 0) {
    throw new Error("Pick at least one of the three demo inboxes.");
  }

  const mail = transporter();
  const from = mailStatus().from;
  const results: Array<{ email: string; name: string; ok: boolean; error?: string }> = [];

  for (const inbox of targets) {
    const used = sentCount(inbox.email);
    if (used >= MAX_SENDS_PER_INBOX) {
      results.push({
        email: inbox.email,
        name: inbox.name,
        ok: false,
        error: `Cap reached (${MAX_SENDS_PER_INBOX} reminders).`,
      });
      continue;
    }

    const n = used + 1;
    const content = bodyFor(inbox);

    try {
      await mail.sendMail({
        from: `Eureka Labs <${from}>`,
        to: inbox.email,
        subject: content.subject,
        text: content.text,
        html: content.html,
        headers: {
          "X-Piplup-Send": String(n),
        },
      });
      recordSend(inbox.email);
      results.push({
        email: inbox.email,
        name: inbox.name,
        ok: true,
        sent: n,
        left: remaining(inbox.email),
      });
    } catch (error) {
      results.push({
        email: inbox.email,
        name: inbox.name,
        ok: false,
        error: error instanceof Error ? error.message : "send failed",
      });
    }
  }

  return results;
}

export { DEMO_INBOXES };
