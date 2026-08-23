import type { DemoInbox } from "./recipients.ts";

export interface PunchyMail {
  subject: string;
  greeting: string;
  paragraphs: string[];
  cta: string;
  signoff: string;
  ps: string;
}

export function punchyMail(inbox: DemoInbox, payUrl?: string): PunchyMail {
  const first = inbox.name;
  const link = payUrl ?? "";

  if (inbox.decline === "mandate_paused") {
    return {
      subject: "A quick heads-up: AutoPay took a nap",
      greeting: `Hi ${first},`,
      paragraphs: [
        "UPI AutoPay paused itself on your Eureka Labs AI/ML subscription. We did not retry. That just annoys the bank.",
        "Your seat is still yours. Thirty seconds on the link and the course stays open. If you meant to pause, ignore this.",
      ],
      cta: link ? "Turn AutoPay back on" : "We will send the restart link in a moment.",
      signoff: "Mira, Eureka Labs",
      ps: "Your account is fine. This is a heads-up, not a threat.",
    };
  }

  if (inbox.decline === "card_expired") {
    return {
      subject: "Your card had a birthday. The payment did not.",
      greeting: `Hi ${first},`,
      paragraphs: [
        "The card on your Eureka Labs subscription expired. We are not going to keep poking the old number.",
        "New card (or UPI), same course. One tap and you are back in the lecture.",
      ],
      cta: link ? "Update card and pay this month" : "We will send a fresh pay link in a moment.",
      signoff: "Mira, Eureka Labs",
      ps: "Nothing is cancelled. The card just aged out.",
    };
  }

  if (inbox.decline === "checkout_abandoned") {
    return {
      subject: "You were this close. We saved your seat.",
      greeting: `Hi ${first},`,
      paragraphs: [
        "You started Eureka Labs checkout and life happened. We did not silently debit you.",
        "Same price, same cohort. The link finishes it whenever you have thirty seconds.",
      ],
      cta: link ? "Finish checkout" : "We will send the checkout link in a moment.",
      signoff: "Mira, Eureka Labs",
      ps: "No fake countdown. Just the course you already wanted.",
    };
  }

  return {
    subject: "A quick heads-up on your Eureka Labs payment",
    greeting: `Hi ${first},`,
    paragraphs: [
      "Your latest Eureka Labs charge did not go through. Almost certainly temporary.",
      "We will not hammer the same debit every morning. One calm link if we need you.",
    ],
    cta: link ? "Take a look" : "We will follow up with a link if we need you.",
    signoff: "Mira, Eureka Labs",
    ps: "Your account is fine. This is a heads-up, not a threat.",
  };
}

export function mailToText(mail: PunchyMail, payUrl?: string): string {
  return [
    mail.greeting,
    "",
    ...mail.paragraphs,
    "",
    payUrl ? `${mail.cta}: ${payUrl}` : mail.cta,
    "",
    mail.signoff,
    "",
    `P.S. ${mail.ps}`,
  ].join("\n");
}

export function mailToHtml(mail: PunchyMail, payUrl?: string): string {
  const paras = mail.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
  const button = payUrl
    ? `<p><a href="${escapeHtml(payUrl)}" style="display:inline-block;margin-top:8px;padding:10px 16px;background:#1f6b4a;color:#fff;text-decoration:none;border-radius:6px">${escapeHtml(mail.cta)}</a></p>`
    : `<p>${escapeHtml(mail.cta)}</p>`;

  return `
    <p>${escapeHtml(mail.greeting)}</p>
    ${paras}
    ${button}
    <p>${escapeHtml(mail.signoff)}</p>
    <p style="color:#666;font-size:13px"><em>P.S. ${escapeHtml(mail.ps)}</em></p>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
