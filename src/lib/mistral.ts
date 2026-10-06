/** Minimal Mistral chat client (REST) with retry + exponential backoff on 429/5xx. */

const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface MistralOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

export type ChatFn = (messages: ChatMessage[], opts?: { json?: boolean; temperature?: number; maxTokens?: number }) => Promise<string>;

export function createMistralChat(o: MistralOptions): ChatFn {
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = o.maxRetries ?? 5;

  return async (messages, opts = {}) => {
    const body = JSON.stringify({
      model: o.model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 600,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    });

    let lastErr = "";
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${o.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body,
        });
      } catch (e) {
        lastErr = `network: ${(e as Error).message}`;
        await sleep(backoff(attempt));
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after"));
        lastErr = `HTTP ${res.status}`;
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
        continue;
      }
      if (!res.ok) {
        throw new Error(`Mistral HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("Mistral returned no content");
      return content;
    }
    throw new Error(`Mistral failed after ${maxRetries + 1} attempts (${lastErr})`);
  };
}

/** 1s, 2s, 4s, 8s, 16s (+ jitter), capped at 30s. */
function backoff(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 400);
}
