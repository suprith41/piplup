import { paidCaseIds, readLastBatch, readLedger } from "@/lib/recovery/ledger";
import { customerNameFor } from "@/lib/recovery/seed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const entries = readLedger()
    .slice(-80)
    .reverse()
    .map((row) => ({ ...row, name: customerNameFor(row.caseId) }));
  return Response.json({
    entries,
    paidCaseIds: paidCaseIds(),
    lastBatch: readLastBatch(),
  });
}
