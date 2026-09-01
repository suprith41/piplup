import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export type LedgerKind = "link" | "mail" | "webhook";

export interface LedgerEntry {
  at: string;
  kind: LedgerKind;
  caseId: string;
  mutation: string;
  clock?: string;
  granted: boolean;
  reason: string;
  outcome: string;
  linkUrl?: string;
  error?: string;
}

export interface BatchDecision {
  caseId: string;
  name: string;
  decline: string;
  klass: string;
  bank: string;
  clock: string;
  mutation: string;
  npciSlotsUsed: number;
  recovered: boolean;
  stopped: boolean;
  reason: string;
  scheduledDay?: number;
}

export interface BatchSnapshot {
  generatedAt: string;
  cases: number;
  atRisk: number;
  recovered: number;
  t3: number;
  lift: number;
  slotsSaved: number;
  stopAccuracy: number;
  decisions: BatchDecision[];
}

const DIR = join(process.cwd(), "data");
const LEDGER = join(DIR, "ledger.json");
const BATCH = join(DIR, "last-batch.json");

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

export function readLedger(): LedgerEntry[] {
  return readJson<LedgerEntry[]>(LEDGER, []);
}

export function appendLedger(line: Omit<LedgerEntry, "at">): LedgerEntry {
  const full: LedgerEntry = { at: new Date().toISOString(), ...line };
  const rows = readLedger();
  rows.push(full);
  writeJson(LEDGER, rows);
  return full;
}

export function isCasePaid(caseId: string): boolean {
  return readLedger().some((row) => row.kind === "webhook" && row.caseId === caseId && row.outcome === "paid");
}

export function paidCaseIds(): string[] {
  return [...new Set(readLedger().filter((row) => row.kind === "webhook" && row.outcome === "paid").map((row) => row.caseId))];
}

export function writeLastBatch(snapshot: BatchSnapshot): BatchSnapshot {
  writeJson(BATCH, snapshot);
  return snapshot;
}

export function readLastBatch(): BatchSnapshot | null {
  const snapshot = readJson<BatchSnapshot | null>(BATCH, null);
  return snapshot?.generatedAt ? snapshot : null;
}
