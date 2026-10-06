import { describe, expect, it, vi } from "vitest";
import { config } from "../lead-finder.config";
import { runPipeline, type PipelineDeps } from "../src/lib/pipeline";
import { MemoryStore } from "../src/lib/store";
import { offlineChat } from "../src/sample/offline-chat";
import { sampleFetchNew } from "../src/sample/sample-posts";
import type { ChatFn } from "../src/lib/mistral";

const NOW = Date.UTC(2026, 9, 7, 6, 0, 0);

function setup(overrides: Partial<PipelineDeps> = {}) {
  const store = new MemoryStore();
  const sent: string[] = [];
  const chat = vi.fn(offlineChat) as unknown as ChatFn & ReturnType<typeof vi.fn>;
  const deps: PipelineDeps = {
    config,
    fetchNew: sampleFetchNew(NOW),
    chat,
    store,
    send: async (t) => void sent.push(t),
    now: () => NOW,
    ...overrides,
  };
  return { deps, store, sent, chat };
}

describe("pipeline on sample Reddit data", () => {
  it("fetches, filters, classifies, drafts and sends a ranked digest", async () => {
    const { deps, sent, store } = setup();
    const s = await runPipeline(deps);

    expect(s.errors).toEqual([]);
    expect(s.fetched).toBe(10);
    // for-hire, 30h-old, stickied, no-keyword rant and the ChatGPT rant are filtered before AI
    expect(s.passedFilter).toBe(5);
    expect(s.classified).toBe(5);
    expect(s.drafted).toBe(5);
    expect(s.notified).toBe(5);

    // header + 5 leads
    expect(sent).toHaveLength(6);
    expect(sent[0]).toContain("5 new Reddit leads");
    const scores = sent.slice(1).map((m) => Number(/#\d+ · (\d+)\/100/.exec(m)![1]));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    // Each entry has title, subreddit, age, score, type, reason, draft, link
    const first = sent[1];
    for (const bit of ["/100", "r/", "ago", "Client lead", "<i>", "<pre>", "https://www.reddit.com/r/"]) {
      expect(first).toContain(bit);
    }

    // Nothing filtered-out is ever sent
    const all = sent.join("\n");
    expect(all).not.toContain("[For Hire]");
    expect(all).not.toContain("gym");
    expect(all).not.toContain("10k MRR");
    expect(all).not.toContain("megathread");

    // No usernames stored
    for (const row of store.rows.values()) expect(JSON.stringify(row)).not.toContain("this_field_is_ignored");
  });

  it("never sends the same post twice across runs", async () => {
    const { deps, sent, chat } = setup();
    await runPipeline(deps);
    const callsAfterFirst = chat.mock.calls.length;
    const sentAfterFirst = sent.length;

    const s2 = await runPipeline(deps);
    expect(s2.alreadySeen).toBe(10);
    expect(s2.notified).toBe(0);
    expect(sent.length).toBe(sentAfterFirst);
    expect(chat.mock.calls.length).toBe(callsAfterFirst); // no AI spend on seen posts
  });

  it("respects AI call caps", async () => {
    const capped = { ...config, ai: { ...config.ai, maxClassifyCallsPerRun: 2, maxDraftCallsPerRun: 1 } };
    const { deps, chat } = setup({ config: capped });
    const s = await runPipeline(deps);
    expect(s.classified).toBe(2);
    expect(s.drafted).toBe(1);
    expect(chat.mock.calls.length).toBe(3);
    expect(s.skippedByCap).toBeGreaterThan(0);
  });

  it("puts unsent leads back if Telegram fails, so they go out next run (once)", async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 3) throw new Error("telegram down");
    };
    const { deps, sent } = setup({ send: flaky });
    const s1 = await runPipeline(deps);
    expect(s1.notified).toBe(1); // header ok, lead #1 ok, lead #2 failed
    expect(s1.errors.join()).toContain("telegram down");

    const s2 = await runPipeline({ ...deps, send: async (t) => void sent.push(t) });
    expect(s2.notified).toBe(4);
    const s3 = await runPipeline({ ...deps, send: async (t) => void sent.push(t) });
    expect(s3.notified).toBe(0);
  });

  it("keeps going when one subreddit fails and when the AI errors", async () => {
    const base = sampleFetchNew(NOW);
    let n = 0;
    const chat: ChatFn = async (m, o) => {
      if (o?.json && ++n === 1) throw new Error("mistral 500");
      return offlineChat(m, o);
    };
    const { deps } = setup({
      chat,
      fetchNew: async (sub, limit) => {
        if (sub === "automation") throw new Error("403");
        return base(sub, limit);
      },
    });
    const s = await runPipeline(deps);
    expect(s.errors.some((e) => e.includes("r/automation"))).toBe(true);
    expect(s.errors.some((e) => e.includes("mistral 500"))).toBe(true);
    expect(s.notified).toBeGreaterThan(0);
  });
});
