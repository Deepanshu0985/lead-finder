/** Telegram delivery: one short header + one message per lead (easy to copy on a phone). */
import { ageLabel } from "./prefilter";
import type { StoredPost } from "./types";

const LIMIT = 4000; // Telegram hard limit is 4096 chars

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TYPE_LABEL: Record<string, string> = {
  client_lead: "Client lead",
  question_to_answer: "Question to answer",
  irrelevant: "Irrelevant",
};

export function formatHeader(count: number, dashboardUrl?: string): string {
  const lines = [`<b>Smartvyn — ${count} new Reddit lead${count === 1 ? "" : "s"}</b>`, "Review, edit, then post yourself."];
  if (dashboardUrl) lines.push(`<a href="${escapeHtml(dashboardUrl)}">Open dashboard</a>`);
  return lines.join("\n");
}

export function formatLead(p: StoredPost, rank: number, nowMs = Date.now()): string {
  const created = Math.floor(new Date(p.created_utc).getTime() / 1000);
  const meta = [
    `<b>#${rank} · ${p.score}/100 · ${TYPE_LABEL[p.type ?? ""] ?? p.type}</b>`,
    `<b>${escapeHtml(p.title)}</b>`,
    `r/${escapeHtml(p.subreddit)} · ${ageLabel(created, nowMs)} · ${escapeHtml(p.service ?? "other")} · promo risk: ${p.promo_risk ?? "?"}`,
    `<i>${escapeHtml(p.reason ?? "")}</i>`,
    `<a href="${escapeHtml(p.permalink)}">Open post</a>`,
    "",
    "<b>Draft reply</b> (tap to copy):",
  ].join("\n");

  const budget = LIMIT - meta.length - 30;
  let draft = escapeHtml(p.draft ?? "");
  if (draft.length > budget) draft = draft.slice(0, budget).replace(/&[a-z]*$/i, "") + "…";
  return `${meta}\n<pre>${draft}</pre>`;
}

export interface TelegramOptions {
  botToken: string;
  chatId: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function createTelegramSender(o: TelegramOptions) {
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return async function send(text: string): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetchImpl(`https://api.telegram.org/bot${o.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: o.chatId,
          text,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        }),
      });
      if (res.ok) {
        await sleep(400); // stay well under Telegram's per-chat limit
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { parameters?: { retry_after?: number }; description?: string };
      if (res.status === 429) {
        await sleep(((body.parameters?.retry_after ?? 3) + 1) * 1000);
        continue;
      }
      throw new Error(`Telegram ${res.status}: ${body.description ?? "unknown error"}`);
    }
    throw new Error("Telegram: rate-limited after retries");
  };
}

export type SendFn = (text: string) => Promise<void>;
