/** Cheap, free checks that run before any AI call. */
import type { RedditPost } from "./types";

export interface PrefilterOptions {
  keywords: readonly string[];
  excludeTitlePatterns: readonly RegExp[];
  maxPostAgeHours: number;
  nowMs?: number;
}

export type RejectReason = "too_old" | "for_hire" | "no_keyword" | "stickied" | "nsfw" | "removed";

export function buildKeywordMatcher(keywords: readonly string[]): (text: string) => string | null {
  const patterns = keywords.map((kw) => {
    const k = kw.toLowerCase().trim();
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Whole-word for single words (so "app" doesn't hit "happy"); plural "s" allowed.
    const isWord = /^[a-z0-9]+$/.test(k);
    return { kw, re: new RegExp(isWord ? `\\b${escaped}s?\\b` : escaped, "i") };
  });
  return (text) => patterns.find((p) => p.re.test(text))?.kw ?? null;
}

export function checkPost(post: RedditPost, opts: PrefilterOptions, match: (t: string) => string | null): RejectReason | null {
  const now = opts.nowMs ?? Date.now();
  if (post.stickied) return "stickied";
  if (post.over18) return "nsfw";
  if (post.body === "[removed]" || post.body === "[deleted]") return "removed";
  const ageHours = (now - post.createdUtc * 1000) / 3_600_000;
  if (ageHours > opts.maxPostAgeHours) return "too_old";

  const flair = post.flair ?? "";
  if (opts.excludeTitlePatterns.some((re) => re.test(post.title) || re.test(flair))) return "for_hire";
  if (/^\s*for\s*hire\s*$/i.test(flair)) return "for_hire";

  if (!match(`${post.title}\n${post.body}`)) return "no_keyword";
  return null;
}

export function prefilter(posts: RedditPost[], opts: PrefilterOptions) {
  const match = buildKeywordMatcher(opts.keywords);
  const passed: RedditPost[] = [];
  const rejected: Array<{ post: RedditPost; reason: RejectReason }> = [];
  for (const post of posts) {
    const reason = checkPost(post, opts, match);
    if (reason) rejected.push({ post, reason });
    else passed.push(post);
  }
  return { passed, rejected };
}

export function ageLabel(createdUtcSeconds: number, nowMs = Date.now()): string {
  const mins = Math.max(0, Math.round((nowMs - createdUtcSeconds * 1000) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
