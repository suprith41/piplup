import { recoveryAnalytics } from "@/lib/recovery/analytics";
import { preventionSummary } from "@/lib/recovery/prevent";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const asOf = Number(new URL(request.url).searchParams.get("asOfDay"));
  const analytics = Number.isFinite(asOf) && asOf > 0 ? recoveryAnalytics(undefined, asOf) : recoveryAnalytics();

  return Response.json({
    analytics,
    prevention: preventionSummary(),
  });
}
