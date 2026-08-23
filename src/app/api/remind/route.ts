import { quotaSnapshot } from "@/lib/email/quota";
import { DEMO_INBOXES, mailStatus, sendReminders } from "@/lib/email/send";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ...mailStatus(),
    inboxes: DEMO_INBOXES,
    quota: quotaSnapshot(DEMO_INBOXES.map((row) => row.email)),
    maxPerPerson: 20,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { emails?: string[] };
  try {
    const results = await sendReminders(body.emails ?? []);
    return Response.json({ results });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "send failed" },
      { status: 400 },
    );
  }
}
