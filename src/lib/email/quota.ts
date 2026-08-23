import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const MAX_SENDS_PER_INBOX = 20;

const FILE = join(process.cwd(), "data", "mail-sends.json");

type Ledger = Record<string, number>;

function load(): Ledger {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Ledger;
  } catch {
    return {};
  }
}

function save(ledger: Ledger): void {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(ledger, null, 2));
}

export function sentCount(email: string): number {
  return load()[email.toLowerCase()] ?? 0;
}

export function remaining(email: string): number {
  return Math.max(0, MAX_SENDS_PER_INBOX - sentCount(email));
}

export function recordSend(email: string): number {
  const ledger = load();
  const key = email.toLowerCase();
  ledger[key] = (ledger[key] ?? 0) + 1;
  save(ledger);
  return ledger[key];
}

export function quotaSnapshot(emails: string[]): Array<{ email: string; sent: number; left: number }> {
  return emails.map((email) => ({
    email,
    sent: sentCount(email),
    left: remaining(email),
  }));
}
