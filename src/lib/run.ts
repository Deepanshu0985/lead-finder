/** Wire the pipeline to real services from environment variables. */
import { config } from "../../lead-finder.config";
import { createMistralChat, type ChatFn } from "./mistral";
import { runPipeline } from "./pipeline";
import { RedditReader } from "./reddit";
import { MemoryStore, storeFromEnv, type LeadStore } from "./store";
import { createTelegramSender, type SendFn } from "./telegram";
import type { RedditPost } from "./types";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

export interface RunOptions {
  dryRun?: boolean; // memory store + console output, nothing written or sent
  fetchNew?: (subreddit: string, limit: number) => Promise<RedditPost[]>;
  chat?: ChatFn;
  store?: LeadStore;
  send?: SendFn;
  log?: (msg: string) => void;
}

export async function runFromEnv(o: RunOptions = {}) {
  const fetchNew =
    o.fetchNew ??
    (() => {
      const reader = new RedditReader({
        clientId: process.env.REDDIT_CLIENT_ID,
        clientSecret: process.env.REDDIT_CLIENT_SECRET,
        userAgent: required("REDDIT_USER_AGENT"),
        mode: (process.env.REDDIT_MODE as "oauth" | "public" | undefined) || undefined,
        minRequestGapMs: config.redditMinRequestGapMs,
      });
      return (sub: string, limit: number) => reader.fetchNew(sub, limit);
    })();

  const chat = o.chat ?? createMistralChat({ apiKey: required("MISTRAL_API_KEY"), model: config.ai.model });
  const store = o.store ?? (o.dryRun ? new MemoryStore() : storeFromEnv());
  const send =
    o.send ??
    (o.dryRun
      ? async (text: string) => console.log(`\n──── Telegram (dry run) ────\n${text.replace(/<[^>]+>/g, "")}`)
      : createTelegramSender({ botToken: required("TELEGRAM_BOT_TOKEN"), chatId: required("TELEGRAM_CHAT_ID") }));

  return runPipeline({
    config,
    fetchNew,
    chat,
    store,
    send,
    dashboardUrl: process.env.DASHBOARD_URL || undefined,
    dryRun: o.dryRun,
    log: o.log ?? ((m) => console.log(`[lead-finder] ${m}`)),
  });
}
