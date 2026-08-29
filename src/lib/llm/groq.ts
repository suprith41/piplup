/**
 * Groq is the translator, not the cashier.
 * Only live voice hits this. The 112-case harness never does.
 */

export function groqStatus(): { configured: boolean; model: string } {
  return {
    configured: Boolean(process.env.GROQ_API_KEY),
    model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
  };
}

export async function groqChat(options: {
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: groqStatus().model,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 180,
        response_format: options.json ? { type: "json_object" } : undefined,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ],
      }),
    });

    if (!res.ok) return null;
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
