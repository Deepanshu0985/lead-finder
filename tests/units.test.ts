import { describe, expect, it, vi } from "vitest";
import { config } from "../lead-finder.config";
import { parseClassification, sanitizeDraft } from "../src/lib/ai";
import { createMistralChat } from "../src/lib/mistral";
import { buildKeywordMatcher, prefilter } from "../src/lib/prefilter";
import { parseListing, RedditReader } from "../src/lib/reddit";
import { escapeHtml, formatLead } from "../src/lib/telegram";
import { sampleListing } from "../src/sample/sample-posts";
import type { RedditPost } from "../src/lib/types";

const NOW = Date.UTC(2026, 9, 7, 6, 0, 0);
const post = (o: Partial<RedditPost>): RedditPost => ({
  id: "t3_x",
  subreddit: "smallbusiness",
  title: "",
  body: "",
  permalink: "https://www.reddit.com/r/x/comments/x/",
  createdUtc: NOW / 1000 - 600,
  isSelf: true,
  stickied: false,
  over18: false,
  ...o,
});
const opts = { keywords: config.keywords, excludeTitlePatterns: config.excludeTitlePatterns, maxPostAgeHours: 24, nowMs: NOW };

describe("prefilter", () => {
  it("matches whole words, not substrings", () => {
    const m = buildKeywordMatcher(["app", "looking for"]);
    expect(m("I need an app for my shop")).toBe("app");
    expect(m("we have 3 apps")).toBe("app");
    expect(m("I'm so happy today")).toBeNull();
    expect(m("Looking For a dev")).toBe("looking for");
  });
  it("skips [For Hire], old, stickied and keyword-less posts", () => {
    const { passed, rejected } = prefilter(
      [
        post({ id: "a", title: "[For Hire] React dev available" }),
        post({ id: "b", title: "Need a chatbot", createdUtc: NOW / 1000 - 25 * 3600 }),
        post({ id: "c", title: "Need a chatbot", stickied: true }),
        post({ id: "d", title: "My cat is cute" }),
        post({ id: "e", title: "Need someone to automate invoicing" }),
        post({ id: "f", title: "Dev available", flair: "For Hire" }),
      ],
      opts,
    );
    expect(passed.map((p) => p.id)).toEqual(["e"]);
    expect(Object.fromEntries(rejected.map((r) => [r.post.id, r.reason]))).toEqual({
      a: "for_hire",
      b: "too_old",
      c: "stickied",
      d: "no_keyword",
      f: "for_hire",
    });
  });
});

describe("AI output handling", () => {
  it("validates and clamps classification JSON", () => {
    const c = parseClassification('{"type":"client_lead","score":140,"service":"Chatbot","reason":"x","promo_risk":"low","asks_for_provider":true}');
    expect(c).toMatchObject({ type: "client_lead", score: 100, service: "chatbot", promo_risk: "low", asks_for_provider: true });
    const bad = parseClassification('Sure! {"type":"weird","score":"abc","service":"blockchain"}');
    expect(bad).toMatchObject({ type: "irrelevant", score: 0, service: "other", promo_risk: "medium", asks_for_provider: false });
    expect(parseClassification('{"type":"irrelevant","score":90}').score).toBe(40);
  });

  it("strips all links/emails/emojis when links aren't allowed", () => {
    const out = sanitizeDraft(
      "Use Zapier for this 🚀🔥.\n\nWe built similar. See https://smartvyn.vercel.app for more. Mail hello.smartvyn@gmail.com.",
      { allowLink: false, portfolioUrl: "https://smartvyn.vercel.app" },
    );
    expect(out).toBe("Use Zapier for this.\n\nWe built similar.");
  });

  it("keeps at most one portfolio link when allowed, drops other links", () => {
    const out = sanitizeDraft(
      "Happy to help. Our work: https://smartvyn.vercel.app. Also https://smartvyn.vercel.app again. Try https://evil.example.com too.",
      { allowLink: true, portfolioUrl: "https://smartvyn.vercel.app" },
    );
    expect(out.match(/smartvyn\.vercel\.app/g)).toHaveLength(1);
    expect(out).not.toContain("evil");
  });
});

describe("Mistral client", () => {
  it("retries on 429 with backoff, then succeeds, and asks for JSON mode", async () => {
    const bodies: string[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      if (++n < 3) return new Response("rate limited", { status: 429 });
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    }) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    const chat = createMistralChat({ apiKey: "k", model: "mistral-small-latest", fetchImpl, sleep });
    expect(await chat([{ role: "user", content: "hi" }], { json: true })).toBe('{"ok":true}');
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(JSON.parse(bodies[0])).toMatchObject({ model: "mistral-small-latest", response_format: { type: "json_object" } });
  });
  it("gives up after max retries", async () => {
    const fetchImpl = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    const chat = createMistralChat({ apiKey: "k", model: "m", fetchImpl, sleep: async () => {}, maxRetries: 2 });
    await expect(chat([{ role: "user", content: "x" }])).rejects.toThrow(/failed after 3 attempts/);
  });
});

describe("Reddit reader (read-only)", () => {
  it("gets an app-only read token, then only GETs listings with the User-Agent", async () => {
    const calls: Array<{ url: string; method: string; ua: string; body?: string }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      calls.push({ url, method: String(init.method), ua: h["User-Agent"], body: init.body as string | undefined });
      if (url.includes("access_token")) return Response.json({ access_token: "tok", expires_in: 3600 });
      return Response.json(sampleListing("smallbusiness", NOW), { headers: { "x-ratelimit-remaining": "99", "x-ratelimit-reset": "300" } });
    }) as unknown as typeof fetch;

    const r = new RedditReader({ clientId: "id", clientSecret: "sec", userAgent: "web:test-app:1.0 (by /u/test)", fetchImpl, sleep: async () => {} });
    const posts = await r.fetchNew("smallbusiness", 25);
    await r.fetchNew("smallbusiness", 25);

    expect(posts).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://www.reddit.com/api/v1/access_token", method: "POST" });
    expect(calls[0].body).toBe("grant_type=client_credentials&scope=read");
    expect(calls.slice(1).every((c) => c.method === "GET" && c.url.startsWith("https://oauth.reddit.com/r/smallbusiness/new"))).toBe(true);
    expect(calls.filter((c) => c.url.includes("access_token"))).toHaveLength(1); // token cached
    expect(calls.every((c) => c.ua === "web:test-app:1.0 (by /u/test)")).toBe(true);
  });

  it("rejects bad subreddit names and requires a User-Agent", async () => {
    const r = new RedditReader({ userAgent: "web:test-app:1.0 (by /u/test)", mode: "public", fetchImpl: (async () => Response.json({})) as unknown as typeof fetch });
    await expect(r.fetchNew("../../api/submit")).rejects.toThrow(/Invalid subreddit/);
    expect(() => new RedditReader({ userAgent: "" })).toThrow(/USER_AGENT/);
  });

  it("drops author fields when parsing", () => {
    const [p] = parseListing(sampleListing("n8n", NOW));
    expect(JSON.stringify(p)).not.toContain("this_field_is_ignored");
    expect(p.permalink.startsWith("https://www.reddit.com/r/n8n/comments/")).toBe(true);
  });
});

describe("Telegram formatting", () => {
  it("escapes HTML and stays under Telegram's limit", () => {
    expect(escapeHtml("<b>&")).toBe("&lt;b&gt;&amp;");
    const msg = formatLead(
      {
        id: "t3_a",
        subreddit: "smallbusiness",
        title: "Need <script> bot",
        permalink: "https://www.reddit.com/r/x/comments/a/",
        created_utc: new Date(NOW - 3_600_000).toISOString(),
        stage: "drafted",
        type: "client_lead",
        score: 90,
        service: "chatbot",
        reason: "clear need",
        promo_risk: "low",
        draft: "x".repeat(10_000),
        status: "new",
        notified_at: null,
      },
      1,
      NOW,
    );
    expect(msg.length).toBeLessThan(4096);
    expect(msg).toContain("Need &lt;script&gt; bot");
    expect(msg).toContain("1h ago");
  });
});
