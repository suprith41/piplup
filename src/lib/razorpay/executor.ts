import { appendLedger } from "../recovery/ledger.ts";
import { grantAdaptive } from "../recovery/policy.ts";
import { enrichWithReply } from "../recovery/reply.ts";
import { seedBatch } from "../recovery/seed.ts";
import { exposurePaise } from "../recovery/simulate.ts";
import type { RecoveryCase } from "../recovery/types.ts";
import { appendAudit, findLink, liveLinks, type AuditLine } from "./audit.ts";
import { createPaymentLink, isLinkCapError, TEST_MODE_LINK_CAP, type CreatedLink } from "./client.ts";

const LINK_MUTATIONS = new Set(["payment_link", "mandate_reauth"]);

/** Three cases the video can click: expired card, paused mandate, checkout drop. */
export const DEMO_CASE_IDS = ["rc_071", "rc_072", "rc_096"] as const;

export function caseById(id: string): RecoveryCase | undefined {
  return seedBatch().map(enrichWithReply).find((row) => row.id === id);
}

function logLink(line: Omit<AuditLine, "at">): AuditLine {
  const full = appendAudit(line);
  if (full.outcome !== "reused") {
    appendLedger({
      kind: "link",
      caseId: full.caseId,
      mutation: full.mutation,
      granted: full.granted,
      reason: full.reason,
      outcome: full.outcome,
      linkUrl: full.link?.shortUrl,
      error: full.error,
    });
  }
  return full;
}

export async function executeRecovery(
  caseId: string,
  options: { injectTimeout?: boolean; force?: boolean } = {},
): Promise<AuditLine> {
  const c = caseById(caseId);
  if (!c) {
    return logLink({
      caseId,
      mutation: "none",
      granted: false,
      reason: "Unknown case.",
      outcome: "refused",
      error: "case_not_found",
    });
  }

  const decision = grantAdaptive(c);

  if (!decision.allowed || !LINK_MUTATIONS.has(decision.mutation)) {
    return logLink({
      caseId,
      mutation: decision.mutation,
      granted: false,
      reason: decision.stopReason ?? decision.reason,
      outcome: "refused",
      error: "policy_denied_or_not_a_link",
    });
  }

  const existing = options.force ? undefined : findLink(caseId);
  if (existing) {
    return logLink({
      caseId,
      mutation: decision.mutation,
      granted: true,
      reason: "Idempotent reuse. Same case does not mint a second link.",
      outcome: "reused",
      link: existing,
    });
  }

  if (options.injectTimeout) {
    return logLink({
      caseId,
      mutation: decision.mutation,
      granted: true,
      reason: "Injected Razorpay timeout. No link created, no double charge.",
      outcome: "failed",
      error: "injected_timeout",
    });
  }

  try {
    const link = await createPaymentLink({
      amountPaise: exposurePaise(c),
      referenceId: `plp_${caseId}_${decision.mutation}_${Date.now().toString(36)}`.slice(0, 40),
      description:
        decision.mutation === "mandate_reauth"
          ? `Eureka Labs · restart AutoPay · ${c.customerName}`
          : `Eureka Labs · AI/ML course payment · ${c.customerName}`,
      customerName: c.customerName,
      notes: {
        case_id: c.id,
        mutation: decision.mutation,
        decline: c.declineCode,
        policy: "adaptive",
      },
    });

    return logLink({
      caseId,
      mutation: decision.mutation,
      granted: true,
      reason: decision.reason,
      outcome: "created",
      link,
    });
  } catch (error) {
    return logLink({
      caseId,
      mutation: decision.mutation,
      granted: true,
      reason: decision.reason,
      outcome: "failed",
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

export async function executeDemo(
  options: { injectTimeout?: boolean; force?: boolean } = {},
): Promise<AuditLine[]> {
  const rows: AuditLine[] = [];
  for (const id of DEMO_CASE_IDS) {
    rows.push(await executeRecovery(id, options));
  }
  return rows;
}

export function casesNeedingLinks(): Array<{ id: string; name: string; decline: string; mutation: string }> {
  return seedBatch()
    .map(enrichWithReply)
    .flatMap((c) => {
      const decision = grantAdaptive(c);
      if (!decision.allowed || !LINK_MUTATIONS.has(decision.mutation)) return [];
      return [
        {
          id: c.id,
          name: c.customerName,
          decline: c.declineCode,
          mutation: decision.mutation,
        },
      ];
    });
}

export async function executeGrantedLinks(
  options: { injectTimeout?: boolean } = {},
): Promise<{ rows: AuditLine[]; needed: number; cap: number; capped?: string }> {
  const needed = casesNeedingLinks();
  const rows: AuditLine[] = [];
  for (const row of needed) {
    const result = await executeRecovery(row.id, options);
    rows.push(result);
    if (result.outcome === "created") {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (result.outcome === "failed" && isLinkCapError(result.error)) {
      return {
        rows,
        needed: needed.length,
        cap: TEST_MODE_LINK_CAP,
        capped: result.error,
      };
    }
  }
  return { rows, needed: needed.length, cap: TEST_MODE_LINK_CAP };
}

export function describeLiveLinks(): Array<{
  id: string;
  name: string;
  decline: string;
  mutation: string;
  shortUrl: string;
}> {
  const names = new Map(seedBatch().map((c) => [c.id, { name: c.customerName, decline: c.declineCode }]));
  return liveLinks().map((row) => ({
    id: row.caseId,
    name: names.get(row.caseId)?.name ?? row.caseId,
    decline: names.get(row.caseId)?.decline ?? "",
    mutation: row.mutation,
    shortUrl: row.link.shortUrl,
  }));
}

export function describeDemoCases(): Array<{ id: string; name: string; decline: string; mutation: string }> {
  return DEMO_CASE_IDS.map((id) => {
    const c = caseById(id);
    const decision = c ? grantAdaptive(c) : undefined;
    return {
      id,
      name: c?.customerName ?? id,
      decline: c?.declineCode ?? "",
      mutation: decision?.mutation ?? "none",
    };
  });
}
