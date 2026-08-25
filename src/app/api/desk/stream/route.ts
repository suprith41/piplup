import { actOnCase, ingressFor, nightQueue } from "@/lib/autopilot/engine";
import { EUREKA } from "@/lib/merchant/eureka";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pace(index: number): number {
  if (index < 3) return 720;
  if (index < 10) return 280;
  if (index < 24) return 90;
  return 28;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const live = url.searchParams.get("live") !== "0";
  const notify = url.searchParams.get("notify") === "1";
  const encoder = new TextEncoder();
  const queue = nightQueue();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        send({
          type: "hello",
          merchant: EUREKA.name,
          operator: EUREKA.operator,
          cohort: EUREKA.cohort,
          cycle: EUREKA.cycle,
          cases: queue.length,
        });

        for (let i = 0; i < queue.length; i += 1) {
          if (request.signal.aborted) break;
          const c = queue[i];
          send(ingressFor(c));
          await sleep(pace(i));
          if (request.signal.aborted) break;
          const event = await actOnCase(c.id, live, { notify });
          send({ type: "decision", event, index: i + 1, total: queue.length });
        }

        if (!request.signal.aborted) {
          send({ type: "done", cases: queue.length });
        }
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "stream failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
