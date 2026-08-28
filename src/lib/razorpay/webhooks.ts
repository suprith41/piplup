import { createHmac, timingSafeEqual } from "crypto";
import { findLink } from "./audit.ts";
import { appendLedger, isCasePaid } from "../recovery/ledger.ts";

export interface PaidResult {
  caseId: string;
  paid: boolean;
  reason: string;
  reused: boolean;
}

function caseIdFromReference(referenceId?: string): string | undefined {
  if (!referenceId) return undefined;
  const match = referenceId.match(/rc_\d{3}/);
  return match?.[0];
}

export function resolvePaidCaseId(input: {
  caseId?: string;
  referenceId?: string;
  notes?: Record<string, string>;
}): string | undefined {
  return input.caseId || input.notes?.case_id || caseIdFromReference(input.referenceId);
}

export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Close a live recovery case after the customer pays the Payment Link.
 * Lab injector and the public webhook share this so the desk cannot drift.
 */
export function applyPaymentLinkPaid(input: {
  caseId?: string;
  referenceId?: string;
  notes?: Record<string, string>;
  source: "webhook" | "lab";
}): PaidResult {
  const caseId = resolvePaidCaseId(input);
  if (!caseId) {
    return { caseId: "", paid: false, reason: "No case_id on the Payment Link.", reused: false };
  }

  if (isCasePaid(caseId)) {
    appendLedger({
      kind: "webhook",
      caseId,
      mutation: "payment_link",
      granted: true,
      reason: "Already marked paid. Idempotent.",
      outcome: "paid",
      linkUrl: findLink(caseId)?.shortUrl,
    });
    return { caseId, paid: true, reason: "Already paid.", reused: true };
  }

  const link = findLink(caseId);
  appendLedger({
    kind: "webhook",
    caseId,
    mutation: "payment_link",
    granted: true,
    reason: input.source === "lab" ? "Lab marked the Payment Link paid." : "Razorpay payment_link.paid.",
    outcome: "paid",
    linkUrl: link?.shortUrl,
  });

  return { caseId, paid: true, reason: "Payment Link paid. Case closed.", reused: false };
}

export function parsePaymentLinkPaid(body: unknown): {
  caseId?: string;
  referenceId?: string;
  notes?: Record<string, string>;
} | null {
  if (!body || typeof body !== "object") return null;
  const event = body as {
    event?: string;
    payload?: {
      payment_link?: {
        entity?: {
          reference_id?: string;
          notes?: Record<string, string>;
        };
      };
    };
  };
  if (event.event !== "payment_link.paid") return null;
  const entity = event.payload?.payment_link?.entity;
  return {
    caseId: entity?.notes?.case_id,
    referenceId: entity?.reference_id,
    notes: entity?.notes,
  };
}
