import { describe, expect, it } from "vitest";
import { htmlToText, parseAtomFeed, RedditReader } from "../src/lib/reddit";
import { SAMPLE_POSTS, sampleAtomFeed } from "../src/sample/sample-posts";

const NOW = Date.UTC(2026, 9, 7, 6, 0, 0);

describe("RSS mode", () => {
  it("parses Reddit's Atom feed into posts, with no usernames", () => {
    const posts = parseAtomFeed(sampleAtomFeed("smallbusiness", NOW), "smallbusiness");
    expect(posts).toHaveLength(1);
    const [p] = posts;
    const src = SAMPLE_POSTS.find((s) => s.id === "s1clinic")!;
    expect(p.id).toBe("t3_s1clinic");
    expect(p.subreddit).toBe("smallbusiness");
    expect(p.title).toBe(src.title);
    expect(p.body).toBe(src.selftext);
    expect(p.createdUtc).toBe(Math.floor(NOW / 1000) - src.ageMinutes * 60);
    expect(p.permalink).toBe("https://www.reddit.com/r/smallbusiness/comments/s1clinic/sample/");
    expect(JSON.stringify(p)).not.toContain("sample_user_123");
    expect(JSON.stringify(p)).not.toContain("submitted by");
  });

  it("decodes Reddit's double-escaped HTML and keeps line breaks", () => {
    const text = htmlToText('<div class="md"><p>We need a &quot;bot&quot; &amp; site</p><ul><li>one</li><li>two</li></ul></div> &#32; submitted by &#32; <a>/u/x</a>');
    expect(text).toBe('We need a "bot" & site\n- one\n- two');
  });

  it("only cuts the real footer, not a mention of 'submitted by' in the post", () => {
    const text = htmlToText("<p>The form is submitted by customers daily</p> &#32; submitted by &#32; <a>/u/x</a>");
    expect(text).toBe("The form is submitted by customers daily");
  });

  it("is the default without keys, GETs the .rss URL with the User-Agent, and explains a 403", async () => {
    const calls: Array<{ url: string; method: string; ua: string }> = [];
    let status = 200;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: String(init.method), ua: (init.headers as Record<string, string>)["User-Agent"] });
      return new Response(status === 200 ? sampleAtomFeed("n8n", NOW) : "blocked", { status });
    }) as unknown as typeof fetch;
    const r = new RedditReader({ userAgent: "web:test-app:1.0 (by /u/test)", fetchImpl, sleep: async () => {} });
    expect(r.mode).toBe("rss");
    const posts = await r.fetchNew("n8n", 25);
    expect(posts.map((p) => p.id)).toEqual(["t3_s7n8n"]);
    expect(calls[0]).toEqual({ url: "https://www.reddit.com/r/n8n/new/.rss?limit=25", method: "GET", ua: "web:test-app:1.0 (by /u/test)" });
    status = 403;
    await expect(r.fetchNew("n8n", 25)).rejects.toThrow(/403.*blocking this network/);
  });
});

import { planRequests } from "../src/lib/reddit";
import { config } from "../lead-finder.config";

describe("keyless request planning + rate limits", () => {
  it("combines subreddits into a few requests, busy ones alone; one per sub with the API", () => {
    const plan = planRequests("rss", config.subreddits, { busy: ["ChatGPT"], groupSize: 7, perSubredditLimit: 25 });
    expect(plan).toHaveLength(3);
    expect(plan[0]).toEqual({ subreddits: "ChatGPT", limit: 100 });
    expect(plan.flatMap((p) => p.subreddits.split("+")).sort()).toEqual([...config.subreddits].sort());
    expect(planRequests("oauth", config.subreddits, { busy: [], groupSize: 7, perSubredditLimit: 25 })).toHaveLength(15);
  });

  it("waits for Reddit's reset before the next request (not after the last), and retries a 429", async () => {
    const sleeps: number[] = [];
    let call = 0;
    const fetchImpl = (async () => {
      call++;
      const headers = { "x-ratelimit-used": "1", "x-ratelimit-remaining": "0.0", "x-ratelimit-reset": "50" };
      if (call === 2) return new Response("", { status: 429, headers: { ...headers, "x-ratelimit-reset": "10" } });
      return new Response(sampleAtomFeed("n8n", NOW), { status: 200, headers });
    }) as unknown as typeof fetch;
    const r = new RedditReader({ userAgent: "web:test-app:1.0 (by /u/test)", fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
    await r.fetchNew("n8n", 100); // 1st: ok, budget used up
    expect(sleeps).toEqual([]); // no sleep after a request
    await r.fetchNew("n8n+automation", 100); // waits ~51s, gets 429, waits ~11s, ok
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThan(49_000);
    expect(sleeps[1]).toBeGreaterThan(9_000);
    expect(call).toBe(3);
  });

  it("pipeline runs on combined requests and ignores subreddits that aren't configured", async () => {
    const { runPipeline } = await import("../src/lib/pipeline");
    const { MemoryStore } = await import("../src/lib/store");
    const { offlineChat } = await import("../src/sample/offline-chat");
    const { sampleFetchNew } = await import("../src/sample/sample-posts");
    const base = sampleFetchNew(NOW);
    const sent: string[] = [];
    const s = await runPipeline({
      config,
      fetchNew: async (subs, limit) => [
        ...(await base(subs, limit)),
        { id: "t3_zzz", subreddit: "notconfigured", title: "Need a chatbot developer, paid", body: "", permalink: "https://www.reddit.com/r/x/comments/zzz/", createdUtc: NOW / 1000 - 60, isSelf: true, stickied: false, over18: false },
      ],
      requestPlan: planRequests("rss", config.subreddits, { busy: ["ChatGPT"], groupSize: 7, perSubredditLimit: 25 }),
      chat: offlineChat,
      store: new MemoryStore(),
      send: async (t) => void sent.push(t),
      now: () => NOW,
    });
    expect(s.fetched).toBe(10);
    expect(s.notified).toBe(5);
    expect(sent.join()).not.toContain("notconfigured");
  });
});
