/**
 * Test-mode Razorpay only. Keys stay in .env.local — never in the client bundle.
 * Test accounts can issue at most 30 Payment Links, so we create them one case
 * at a time after the policy grant, not for the whole batch.
 */

export interface CreatedLink {
  id: string;
  shortUrl: string;
  amountPaise: number;
  referenceId: string;
  status: string;
}

export function razorpayStatus(): { configured: boolean; testMode: boolean; keyPrefix: string } {
  const id = process.env.RAZORPAY_KEY_ID ?? "";
  const secret = process.env.RAZORPAY_KEY_SECRET ?? "";
  return {
    configured: Boolean(id && secret),
    testMode: id.startsWith("rzp_test_"),
    keyPrefix: id ? `${id.slice(0, 12)}…` : "",
  };
}

export async function createPaymentLink(input: {
  amountPaise: number;
  referenceId: string;
  description: string;
  customerName: string;
  notes: Record<string, string>;
}): Promise<CreatedLink> {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) {
    throw new Error("Razorpay keys missing. Copy .env.example to .env.local.");
  }
  if (!id.startsWith("rzp_test_")) {
    throw new Error("Live keys refused. Piplup only talks to Test Mode.");
  }

  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  const expireBy = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

  const res = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: "INR",
      accept_partial: false,
      reference_id: input.referenceId.slice(0, 40),
      description: input.description.slice(0, 2048),
      customer: {
        name: input.customerName,
        email: `${input.referenceId.replace(/[^a-z0-9]/gi, "").slice(0, 20)}@piplup.test`,
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
      expire_by: expireBy,
      notes: input.notes,
    }),
  });

  const body = (await res.json()) as {
    id?: string;
    short_url?: string;
    amount?: number;
    reference_id?: string;
    status?: string;
    error?: { description?: string; code?: string };
  };

  if (!res.ok || !body.id || !body.short_url) {
    throw new Error(body.error?.description ?? `Payment Link failed (${res.status})`);
  }

  return {
    id: body.id,
    shortUrl: body.short_url,
    amountPaise: body.amount ?? input.amountPaise,
    referenceId: body.reference_id ?? input.referenceId,
    status: body.status ?? "issued",
  };
}
