/**
 * READ-ONLY Reddit client.
 *
 * Safety design — this module is the ONLY place that talks to Reddit, and:
 *   • `redditGet()` hard-codes method "GET". There is no function that can
 *     send POST/PUT/PATCH/DELETE to a Reddit API host.
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

export interface RedditClientOptions {
  clientId?: string;
  clientSecret?: string;
  userAgent: string;
  mode?: "oauth" | "public";
  minRequestGapMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const SUBREDDIT_RE = /^[A-Za-z0-9_]{2,21}$/;

export class RedditReader {
  private token: { value: string; expiresAt: number } | null = null;
  private lastRequestAt = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly mode: "oauth" | "public";

  constructor(private readonly opts: RedditClientOptions) {
    if (!opts.userAgent || opts.userAgent.length < 10) {
      throw new Error("REDDIT_USER_AGENT is required (e.g. web:smartvyn-lead-finder:1.0.0 (by /u/yourname))");
    }
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.mode = opts.mode ?? (opts.clientId && opts.clientSecret ? "oauth" : "public");
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

  /** The only way this app reads Reddit content. GET, always. */
  private async redditGet(path: string): Promise<unknown> {
    // Politeness: keep a minimum gap between requests.
    const gap = this.opts.minRequestGapMs ?? 1100;
    const wait = this.lastRequestAt + gap - Date.now();
    if (wait > 0) await this.sleep(wait);

    const headers: Record<string, string> = { "User-Agent": this.opts.userAgent };
    let url: string;
    if (this.mode === "oauth") {
      headers.Authorization = `Bearer ${await this.getToken()}`;
      url = `${OAUTH_BASE}${path}`;
    } else {
      url = `${PUBLIC_BASE}${path.replace(/\?/, ".json?")}`;
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
        const retryAfter = Number(res.headers.get("retry-after")) || (attempt + 1) * 10;
        await this.sleep(Math.min(retryAfter, 120) * 1000);
        continue;
      }
      if (res.status === 401 && this.mode === "oauth") {
        this.token = null; // expired → refresh once
        headers.Authorization = `Bearer ${await this.getToken()}`;
        continue;
      }
      if (!res.ok) throw new Error(`Reddit GET ${path} → ${res.status}`);
      return res.json();
    }
    throw new Error(`Reddit GET ${path} → rate-limited after retries`);
  }

  /** Newest posts from one configured subreddit. */
  async fetchNew(subreddit: string, limit = 25): Promise<RedditPost[]> {
    if (!SUBREDDIT_RE.test(subreddit)) throw new Error(`Invalid subreddit name: ${subreddit}`);
    const n = Math.max(1, Math.min(100, limit));
    const data = (await this.redditGet(`/r/${subreddit}/new?limit=${n}&raw_json=1`)) as Listing;
    return parseListing(data);
  }
}

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

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}
