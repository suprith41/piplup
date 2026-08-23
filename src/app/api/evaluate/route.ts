import { evaluateBatch } from "@/lib/recovery/evaluate";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(evaluateBatch());
}
