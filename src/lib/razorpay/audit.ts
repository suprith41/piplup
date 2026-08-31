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

const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function findLink(caseId: string): CreatedLink | undefined {
  return liveLinks().find((row) => row.caseId === caseId)?.link;
}

export interface LiveLink {
  caseId: string;
  mutation: string;
  at: string;
  link: CreatedLink;
}

/** Latest unexpired Payment Link per case. Old reused audit rows are ignored. */
export function liveLinks(): LiveLink[] {
  const latest = new Map<string, LiveLink>();
  const now = Date.now();
  for (const row of load()) {
    if (row.outcome !== "created" || !row.link) continue;
    if (now - new Date(row.at).getTime() > LINK_TTL_MS) continue;
    latest.set(row.caseId, {
      caseId: row.caseId,
      mutation: row.mutation,
      at: row.at,
      link: row.link,
    });
  }
  return [...latest.values()].sort((a, b) => a.caseId.localeCompare(b.caseId));
}
