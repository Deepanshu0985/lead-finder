/**
 * READ-ONLY Reddit client.
 *
 * Three ways to read, all read-only:
 *   • "oauth"  — official Data API, app-only token (needs Reddit's approval + keys). Best.
 *   • "rss"    — Reddit's public RSS/Atom feeds (no keys). Default when no keys are set.
 *   • "public" — unauthenticated .json listings. Usually blocked (403) now; kept as a fallback.
 *
 * Safety design — this module is the ONLY place that talks to Reddit, and:
 *   • `redditGet()` hard-codes method "GET". There is no function that can
 *     send POST/PUT/PATCH/DELETE to a Reddit content endpoint.
 *   • The single POST in this file goes to the OAuth *token* endpoint
 *     (www.reddit.com/api/v1/access_token) to obtain an app-only read token.
 *     It cannot post, comment, vote or message.
 *   • The token is requested with scope "read" only.
 *   • Paths are built from the configured subreddit list only.
 *   • tests/no-posting.test.ts scans the whole codebase to keep it this way.
 */
import type { RedditPost } from "./types";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const OAUTH_BASE = "https://oauth.reddit.com";
const PUBLIC_BASE = "https://www.reddit.com";

export type RedditMode = "oauth" | "rss" | "public";

export interface RedditClientOptions {
  clientId?: string;
  clientSecret?: string;
  userAgent: string;
  mode?: RedditMode;
  minRequestGapMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const SUBREDDIT_RE = /^[A-Za-z0-9_]{2,21}$/;

/** Gentler pacing for the keyless modes. */
const DEFAULT_GAP: Record<RedditMode, number> = { oauth: 1100, rss: 3000, public: 3000 };

export class RedditReader {
  private token: { value: string; expiresAt: number } | null = null;
  private lastRequestAt = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  readonly mode: RedditMode;

  constructor(private readonly opts: RedditClientOptions) {
    if (!opts.userAgent || opts.userAgent.length < 10) {
      throw new Error("REDDIT_USER_AGENT is required (e.g. web:smartvyn-lead-finder:1.0.0 (by /u/yourname))");
    }
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.mode = opts.mode ?? (opts.clientId && opts.clientSecret ? "oauth" : "rss");
    if (!["oauth", "rss", "public"].includes(this.mode)) {
      throw new Error(`REDDIT_MODE must be oauth, rss or public (got "${this.mode}")`);
    }
    if (this.mode === "oauth" && !(opts.clientId && opts.clientSecret)) {
      throw new Error("REDDIT_MODE=oauth needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET");
    }
  }

  /** App-only OAuth token, scope=read. */
  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(TOKEN_URL, {
      method: "POST", // token endpoint only — not a content endpoint
      headers: {
        Authorization: `Basic ${basic}`,
        "User-Agent": this.opts.userAgent,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=read",
    });
    if (!res.ok) {
      throw new Error(`Reddit token request failed: ${res.status} ${await safeText(res)}`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!json.access_token) throw new Error(`Reddit token error: ${json.error ?? "no access_token"}`);
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  /** The only way this app reads Reddit content. GET, always. Returns the raw body text. */
  private async redditGet(subreddit: string, limit: number): Promise<string> {
    // Politeness: keep a minimum gap between requests.
    const gap = this.opts.minRequestGapMs ?? DEFAULT_GAP[this.mode];
    const wait = this.lastRequestAt + gap - Date.now();
    if (wait > 0) await this.sleep(wait);

    const headers: Record<string, string> = { "User-Agent": this.opts.userAgent };
    let url: string;
    if (this.mode === "oauth") {
      headers.Authorization = `Bearer ${await this.getToken()}`;
      url = `${OAUTH_BASE}/r/${subreddit}/new?limit=${limit}&raw_json=1`;
    } else if (this.mode === "rss") {
      headers.Accept = "application/atom+xml, application/xml;q=0.9";
      url = `${PUBLIC_BASE}/r/${subreddit}/new/.rss?limit=${limit}`;
    } else {
      url = `${PUBLIC_BASE}/r/${subreddit}/new.json?limit=${limit}&raw_json=1`;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      this.lastRequestAt = Date.now();
      const res = await this.fetchImpl(url, { method: "GET", headers });

      // Respect Reddit's rate-limit headers.
      const remaining = Number(res.headers.get("x-ratelimit-remaining"));
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      if (Number.isFinite(remaining) && remaining < 5 && Number.isFinite(reset)) {
        await this.sleep(Math.min(reset, 120) * 1000);
      }

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || (attempt + 1) * 15;
        await this.sleep(Math.min(retryAfter, 120) * 1000);
        continue;
      }
      if (res.status === 401 && this.mode === "oauth") {
        this.token = null; // expired → refresh once
        headers.Authorization = `Bearer ${await this.getToken()}`;
        continue;
      }
      if (res.status === 403) {
        throw new Error(
          `Reddit returned 403 for r/${subreddit} in ${this.mode} mode — Reddit is blocking this network for keyless access` +
            (this.mode === "oauth" ? "" : ". Use REDDIT_MODE=oauth once your API access is approved, or run from another network."),
        );
      }
      if (!res.ok) throw new Error(`Reddit GET r/${subreddit} (${this.mode}) → ${res.status}`);
      return res.text();
    }
    throw new Error(`Reddit GET r/${subreddit} → rate-limited after retries`);
  }

  /** Newest posts from one configured subreddit. */
  async fetchNew(subreddit: string, limit = 25): Promise<RedditPost[]> {
    if (!SUBREDDIT_RE.test(subreddit)) throw new Error(`Invalid subreddit name: ${subreddit}`);
    const n = Math.max(1, Math.min(100, limit));
    const body = await this.redditGet(subreddit, n);
    if (this.mode === "rss") return parseAtomFeed(body, subreddit);
    return parseListing(JSON.parse(body) as Listing);
  }
}

// ───────────────────────── JSON listings ─────────────────────────

interface Listing {
  data?: { children?: Array<{ kind: string; data: Record<string, unknown> }> };
}

/** Convert a Reddit listing into RedditPost[]. Drops author fields on purpose. */
export function parseListing(listing: Listing): RedditPost[] {
  const children = listing?.data?.children ?? [];
  return children
    .filter((c) => c.kind === "t3")
    .map((c) => {
      const d = c.data;
      const permalink = String(d.permalink ?? "");
      return {
        id: String(d.name ?? `t3_${d.id}`),
        subreddit: String(d.subreddit ?? ""),
        title: String(d.title ?? ""),
        body: String(d.selftext ?? ""),
        permalink: permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`,
        createdUtc: Number(d.created_utc ?? 0),
        flair: (d.link_flair_text as string | null) ?? null,
        isSelf: Boolean(d.is_self),
        stickied: Boolean(d.stickied),
        over18: Boolean(d.over_18),
      } satisfies RedditPost;
    });
}

// ───────────────────────── RSS / Atom ─────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return m ? m[1] : null;
}

function attr(xml: string, name: string, attribute: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*\\b${attribute}="([^"]*)"`, "i").exec(xml);
  return m ? decodeEntities(m[1]) : null;
}

/** Turn the post's HTML into plain text, cutting Reddit's "submitted by /u/…" footer (no usernames kept). */
export function htmlToText(html: string): string {
  let h = html;
  // Use the LAST "submitted by" so a post that mentions the phrase isn't cut short.
  const footers = [...h.matchAll(/(?:&#32;|\s)*submitted by(?:&#32;|\s)/gi)];
  if (footers.length) h = h.slice(0, footers[footers.length - 1].index);
  h = h.replace(/<!--[\s\S]*?-->/g, "");
  h = h.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d|tr|blockquote|pre)>/gi, "\n");
  h = h.replace(/<li\b[^>]*>/gi, "- ");
  h = h.replace(/<[^>]+>/g, "");
  return decodeEntities(h)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parse Reddit's Atom feed for /r/<sub>/new/.rss.
 * RSS doesn't carry "stickied", NSFW or flair, so those default to false/null.
 */
export function parseAtomFeed(xml: string, fallbackSubreddit: string): RedditPost[] {
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const posts: RedditPost[] = [];
  for (const e of entries) {
    const rawId = (tag(e, "id") ?? "").trim();
    if (!/^t3_[a-z0-9]+$/i.test(rawId)) continue; // posts only (comments are t1_)
    const link = attr(e, "link", "href") ?? "";
    const published = tag(e, "published") ?? tag(e, "updated") ?? "";
    const createdMs = Date.parse(published.trim());
    if (!Number.isFinite(createdMs)) continue;
    const subreddit = attr(e, "category", "term") ?? fallbackSubreddit;
    const contentRaw = tag(e, "content") ?? "";
    // <content type="html"> is entity-escaped HTML: decode once to get HTML, then strip tags.
    const body = htmlToText(decodeEntities(contentRaw));
    posts.push({
      id: rawId,
      subreddit,
      title: decodeEntities((tag(e, "title") ?? "").trim()),
      body,
      permalink: link.startsWith("http") ? link : `https://www.reddit.com${link}`,
      createdUtc: Math.floor(createdMs / 1000),
      flair: null,
      isSelf: true,
      stickied: false,
      over18: false,
    });
  }
  return posts;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}
