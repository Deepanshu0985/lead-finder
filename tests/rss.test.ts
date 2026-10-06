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
