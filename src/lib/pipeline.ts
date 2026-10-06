/** One run: fetch → pre-filter → classify → draft → notify. All deps injected so it's testable. */
import type { LeadFinderConfig } from "../../lead-finder.config";
import { classifyPost, draftReply, type ClassificationResult } from "./ai";
import type { ChatFn } from "./mistral";
import { prefilter } from "./prefilter";
import type { LeadStore } from "./store";
import { formatHeader, formatLead, type SendFn } from "./telegram";
import type { RedditPost, RunSummary, StoredPost } from "./types";

export interface PipelineDeps {
  config: LeadFinderConfig;
  /** Read-only fetcher (RedditReader.fetchNew, or a fixture loader in tests). Accepts "a+b+c". */
  fetchNew: (subreddits: string, limit: number) => Promise<RedditPost[]>;
  /** Which requests to make. Default: one per configured subreddit. */
  requestPlan?: Array<{ subreddits: string; limit: number }>;
  chat: ChatFn;
  store: LeadStore;
  send: SendFn;
  dashboardUrl?: string;
  now?: () => number;
  log?: (msg: string) => void;
  dryRun?: boolean;
  aiConcurrency?: number;
}

function baseRow(p: RedditPost): StoredPost {
  return {
    id: p.id,
    subreddit: p.subreddit,
    title: p.title.slice(0, 300),
    permalink: p.permalink,
    created_utc: new Date(p.createdUtc * 1000).toISOString(),
    stage: "filtered_out",
    type: null,
    score: null,
    service: null,
    reason: null,
    promo_risk: null,
    draft: null,
    status: "new",
    notified_at: null,
  };
}

async function mapPool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function runPipeline(d: PipelineDeps): Promise<RunSummary> {
  const cfg = d.config;
  const now = d.now ?? Date.now;
  const log = d.log ?? (() => {});
  const conc = d.aiConcurrency ?? 2;
  const s: RunSummary = {
    fetched: 0,
    alreadySeen: 0,
    passedFilter: 0,
    classified: 0,
    aboveThreshold: 0,
    drafted: 0,
    notified: 0,
    skippedByCap: 0,
    errors: [],
    dryRun: Boolean(d.dryRun),
  };

  // 1. Fetch (sequential = polite). One bad request doesn't kill the run.
  const plan = d.requestPlan ?? cfg.subreddits.map((sub) => ({ subreddits: sub, limit: cfg.postsPerSubreddit }));
  const allowed = new Set(cfg.subreddits.map((x) => x.toLowerCase()));
  const byId = new Map<string, RedditPost>();
  for (const req of plan) {
    try {
      const posts = await d.fetchNew(req.subreddits, req.limit);
      let kept = 0;
      for (const p of posts) {
        if (!allowed.has(p.subreddit.toLowerCase())) continue; // only configured subreddits
        byId.set(p.id, p);
        kept++;
      }
      log(`r/${req.subreddits}: ${kept} posts`);
    } catch (e) {
      s.errors.push(`fetch r/${req.subreddits}: ${(e as Error).message}`);
      log(`r/${req.subreddits}: ERROR ${(e as Error).message}`);
    }
  }
  const all = [...byId.values()];
  s.fetched = all.length;

  // 2. Skip anything seen before.
  const seen = await d.store.seenIds(all.map((p) => p.id));
  s.alreadySeen = seen.size;
  const fresh = all.filter((p) => !seen.has(p.id));

  // 3. Cheap pre-filter.
  const { passed, rejected } = prefilter(fresh, {
    keywords: cfg.keywords,
    excludeTitlePatterns: cfg.excludeTitlePatterns,
    maxPostAgeHours: cfg.maxPostAgeHours,
    nowMs: now(),
  });
  s.passedFilter = passed.length;
  await d.store.insertNew(rejected.map((r) => baseRow(r.post)));

  // 4. Classify — newest first, capped.
  passed.sort((a, b) => b.createdUtc - a.createdUtc);
  const toClassify = passed.slice(0, cfg.ai.maxClassifyCallsPerRun);
  s.skippedByCap += passed.length - toClassify.length; // left unseen → retried next run

  const classified = await mapPool(toClassify, conc, async (post) => {
    try {
      const c = await classifyPost(d.chat, post, cfg);
      await d.store.insertNew([
        { ...baseRow(post), stage: "classified", type: c.type, score: c.score, service: c.service, reason: c.reason, promo_risk: c.promo_risk },
      ]);
      return { post, c };
    } catch (e) {
      s.errors.push(`classify ${post.id}: ${(e as Error).message}`);
      return null; // not stored → retried next run
    }
  });
  const ok = classified.filter((x): x is { post: RedditPost; c: ClassificationResult } => x !== null);
  s.classified = ok.length;

  // 5. Draft replies for good leads — best first, capped.
  const good = ok.filter((x) => x.c.type !== "irrelevant" && x.c.score >= cfg.scoreThreshold).sort((a, b) => b.c.score - a.c.score);
  s.aboveThreshold = good.length;
  const toDraft = good.slice(0, cfg.ai.maxDraftCallsPerRun);
  s.skippedByCap += good.length - toDraft.length;

  await mapPool(toDraft, conc, async ({ post, c }) => {
    try {
      const draft = await draftReply(d.chat, post, c, cfg);
      if (!draft) throw new Error("empty draft");
      await d.store.update(post.id, { stage: "drafted", draft });
      s.drafted++;
    } catch (e) {
      s.errors.push(`draft ${post.id}: ${(e as Error).message}`);
    }
  });

  // 6. Notify — only leads never sent before.
  const sinceIso = new Date(now() - cfg.maxPostAgeHours * 3_600_000).toISOString();
  const pending = await d.store.unnotifiedLeads(cfg.scoreThreshold, sinceIso, cfg.digestSize);
  if (pending.length) {
    const atIso = new Date(now()).toISOString();
    const claimedIds = new Set(await d.store.claimNotified(pending.map((p) => p.id), atIso));
    const toSend = pending.filter((p) => claimedIds.has(p.id));
    if (toSend.length) {
      const sent = new Set<string>();
      try {
        await d.send(formatHeader(toSend.length, d.dashboardUrl));
        for (const [i, lead] of toSend.entries()) {
          await d.send(formatLead(lead, i + 1, now()));
          sent.add(lead.id);
        }
      } catch (e) {
        s.errors.push(`telegram: ${(e as Error).message}`);
        // Release unsent leads so the next run can deliver them.
        for (const lead of toSend) if (!sent.has(lead.id)) await d.store.update(lead.id, { notified_at: null });
      }
      s.notified = sent.size;
    }
  }

  log(`done: ${JSON.stringify(s)}`);
  return s;
}
