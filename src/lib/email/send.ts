import nodemailer from "nodemailer";
import { findLink } from "../razorpay/audit.ts";
import { hinglishNudge } from "../recovery/copy.ts";
import { grantAdaptive } from "../recovery/policy.ts";
import { caseById } from "../razorpay/executor.ts";
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
  const c = caseById(inbox.caseId);
  const decision = c ? grantAdaptive(c) : undefined;
  const nudge = c && decision ? hinglishNudge(c, decision) : `${inbox.name}, payment fail ho gaya.`;
  const link = findLink(inbox.caseId)?.shortUrl;

  const subject = `FitRoot · ${inbox.name}, payment pending`;
  const text = [
    `Hi ${inbox.name},`,
    "",
    nudge,
    link ? `Pay / fix here: ${link}` : "Payment link will appear after you create the test links.",
    "",
    "— FitRoot (Piplup recovery, Razorpay test mode)",
  ].join("\n");

  const html = `
    <p>Hi ${inbox.name},</p>
    <p>${nudge}</p>
    ${link ? `<p><a href="${link}">Pay / fix AutoPay</a></p>` : "<p>Create the test Payment Links first, then send again.</p>"}
    <p style="color:#666;font-size:12px">FitRoot · Piplup recovery · Razorpay test mode</p>
  `;

  return { subject, text, html };
}

export async function sendReminders(emails: string[]): Promise<Array<{ email: string; name: string; ok: boolean; error?: string }>> {
  const targets = allowedInboxes(emails);
  if (targets.length === 0) {
    throw new Error("Pick at least one of the three demo inboxes.");
  }

  const mail = transporter();
  const from = mailStatus().from;
  const results: Array<{ email: string; name: string; ok: boolean; error?: string }> = [];

  for (const inbox of targets) {
    const content = bodyFor(inbox);
    try {
      await mail.sendMail({
        from: `FitRoot <${from}>`,
        to: inbox.email,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
      results.push({ email: inbox.email, name: inbox.name, ok: true });
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
