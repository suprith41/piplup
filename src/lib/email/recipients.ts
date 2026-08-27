export const DEMO_INBOXES = [
  {
    caseId: "rc_071",
    name: "Sam",
    decline: "mandate_paused",
    email: "drstrangemcue616@gmail.com",
  },
  {
    caseId: "rc_072",
    name: "Elon",
    decline: "card_expired",
    email: "suprithbin@gmail.com",
  },
  {
    caseId: "rc_096",
    name: "Dario",
    decline: "checkout_abandoned",
    email: "quanttrading819@gmail.com",
  },
] as const;

export type DemoInbox = (typeof DEMO_INBOXES)[number];

const ALLOWED = new Set<string>(DEMO_INBOXES.map((row) => row.email.toLowerCase()));

export function allowedInboxes(emails: string[]): DemoInbox[] {
  const wanted = new Set(emails.map((e) => e.trim().toLowerCase()));
  return DEMO_INBOXES.filter((row) => wanted.has(row.email.toLowerCase()) && ALLOWED.has(row.email.toLowerCase()));
}
