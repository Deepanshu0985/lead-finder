/** Wire the pipeline to real services from environment variables. */
import { config } from "../../lead-finder.config";
import { createMistralChat, type ChatFn } from "./mistral";
import { runPipeline } from "./pipeline";
import { planRequests, RedditReader, type RedditMode } from "./reddit";

const DEFAULT_USER_AGENT = "web:smartvyn-lead-finder:1.0.0 (Smartvyn read-only lead finder)";
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
  let requestPlan: Array<{ subreddits: string; limit: number }> | undefined;
  const fetchNew =
    o.fetchNew ??
    (() => {
      const reader = new RedditReader({
        clientId: process.env.REDDIT_CLIENT_ID,
        clientSecret: process.env.REDDIT_CLIENT_SECRET,
        userAgent: process.env.REDDIT_USER_AGENT || DEFAULT_USER_AGENT,
        // oauth when keys are set, otherwise rss. Override with REDDIT_MODE=oauth|rss|public.
        mode: (process.env.REDDIT_MODE as RedditMode | undefined) || undefined,
      });
      requestPlan = planRequests(reader.mode, config.subreddits, {
        busy: config.keyless.busySubreddits,
        groupSize: config.keyless.groupSize,
        perSubredditLimit: config.postsPerSubreddit,
      });
      (o.log ?? console.log)(`[lead-finder] Reddit mode: ${reader.mode}, ${requestPlan.length} requests`);
      return (subs: string, limit: number) => reader.fetchNew(subs, limit);
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
    requestPlan,
    chat,
    store,
    send,
    dashboardUrl: process.env.DASHBOARD_URL || undefined,
    dryRun: o.dryRun,
    log: o.log ?? ((m) => console.log(`[lead-finder] ${m}`)),
  });
}
