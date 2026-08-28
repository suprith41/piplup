import { paidCaseIds, readLastBatch, readLedger } from "@/lib/recovery/ledger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const entries = readLedger().slice(-80).reverse();
  return Response.json({
    entries,
    paidCaseIds: paidCaseIds(),
    lastBatch: readLastBatch(),
  });
}
