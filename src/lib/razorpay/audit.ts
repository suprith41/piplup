import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { CreatedLink } from "./client.ts";

export interface AuditLine {
  at: string;
  caseId: string;
  mutation: string;
  granted: boolean;
  reason: string;
  outcome: "created" | "reused" | "refused" | "failed";
  link?: CreatedLink;
  error?: string;
}

const FILE = join(process.cwd(), "data", "audit.json");

function load(): AuditLine[] {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as AuditLine[];
  } catch {
    return [];
  }
}

export function readAudit(): AuditLine[] {
  return load();
}

export function appendAudit(line: Omit<AuditLine, "at">): AuditLine {
  const full: AuditLine = { at: new Date().toISOString(), ...line };
  const rows = load();
  rows.push(full);
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(rows, null, 2));
  return full;
}

export function findLink(caseId: string): CreatedLink | undefined {
  return load()
    .slice()
    .reverse()
    .find((row) => row.caseId === caseId && row.link)?.link;
}
