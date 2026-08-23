import type { DemoInbox } from "./recipients.ts";

export interface PunchyMail {
  subject: string;
  greeting: string;
  paragraphs: string[];
  cta: string;
  signoff: string;
  ps: string;
}

/**
 * English-only customer mail. Dashboard can stay Hinglish; the inbox should not.
 * Tone: a teammate, not a collections desk. Each decline gets a different story.
 */
export function punchyMail(inbox: DemoInbox, payUrl?: string): PunchyMail {
  const first = inbox.name;
  const link = payUrl ?? "";

  if (inbox.decline === "mandate_paused") {
    return {
      subject: "A quick heads-up: AutoPay took a nap",
      greeting: `Hi ${first},`,
      paragraphs: [
        "You know how UPI AutoPay sometimes just… switches itself off? A bank app update, a fat thumb, a “just checking” screen. That just happened on your Eureka Labs AI/ML subscription.",
        "We saw the pause. We did not try to pull the money again. Retrying a paused mandate is how you annoy a bank and a human at the same time. Also how you burn one of the few retries India even allows.",
        "Your seat is still yours. Lectures, notebooks, the cohort: none of that got deleted. Access just waits on AutoPay the way a door waits on a key.",
        "Thirty seconds on the link. Same UPI app. Same course. No new signup, no “welcome again” email, no starting over at module one.",
        "If you meant to pause, totally fine. Ignore this. If you didn’t, the link is the whole fix.",
      ],
      cta: link ? "Turn AutoPay back on" : "We’ll send the restart link in a moment.",
      signoff: "Mira, Eureka Labs",
      ps: "Your account is completely fine. This is a heads-up, not a threat. We will not keep poking a dead mandate.",
    };
  }

  if (inbox.decline === "card_expired") {
    return {
      subject: "Your card had a birthday. The payment did not.",
      greeting: `Hi ${first},`,
      paragraphs: [
        "Banks love expiring cards on a Tuesday and telling nobody. The plastic in your wallet looks the same. The number on file at Eureka Labs just became a museum piece.",
        "Your latest AI/ML course charge bounced for that reason. Not because you left. Not because we got creative with the amount. The card aged out.",
        "We are not going to keep poking the old number. That never works. It just looks desperate, and it can make the next bank more suspicious, not less.",
        "New card (or UPI). Same subscription. Same lectures waiting in the same place you left them. One tap, this month is paid, you go back to the module.",
        "If you already updated it in your bank app, the link still helps. It just takes the new details and we’re done.",
      ],
      cta: link ? "Update card and pay this month" : "We’ll send a fresh pay link in a moment.",
      signoff: "Mira, Eureka Labs",
      ps: "Nothing is cancelled. The course is waiting. The card just aged out.",
    };
  }

  if (inbox.decline === "checkout_abandoned") {
    return {
      subject: "You were this close. We saved your seat.",
      greeting: `Hi ${first},`,
      paragraphs: [
        "You started checkout for Eureka Labs and then life happened. A call. A tab. A kettle. We have all been that person.",
        "We did not silently debit you. That would be a jerk move. You pick the moment. We just kept the cart warm.",
        "Same AI/ML cohort. Same price you already saw. No “offer expires in 3:00” countdown, no fake remaining seats, no guilt.",
        "Whenever you have thirty seconds (tonight, tomorrow, after the meeting that should have been an email) the link finishes what you started.",
        "If you changed your mind, that’s also fine. Close this. We won’t chase you around the internet.",
      ],
      cta: link ? "Finish checkout" : "We’ll send the checkout link in a moment.",
      signoff: "Mira, Eureka Labs",
      ps: "No countdown timers. No fake scarcity. Just the course you already wanted.",
    };
  }

  return {
    subject: "A quick heads-up on your Eureka Labs payment",
    greeting: `Hi ${first},`,
    paragraphs: [
      "You know how banks sometimes get suspicious of perfectly normal charges, at perfectly normal times, for perfectly normal reasons? That just happened to you.",
      "Your latest Eureka Labs AI/ML course charge didn’t go through. It’s almost certainly temporary. The kind of thing that sorts itself out once your bank finishes its afternoon nap.",
      "We are not going to hammer the same debit every morning. That is how a small glitch becomes a blocked card and a bad mood.",
      "If we need you, there will be one calm link. If we don’t, you won’t hear from us again about this.",
    ],
    cta: link ? "Take a look" : "We’ll follow up with a link if we need you.",
    signoff: "Mira, Eureka Labs",
    ps: "Your account is completely fine. This is a heads-up, not a threat.",
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
