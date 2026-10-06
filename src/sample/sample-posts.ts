/**
 * Sample Reddit data shaped like real /r/<sub>/new listings (only the fields we read).
 * Ages are relative so the fixtures never go stale. Usernames are deliberately absent.
 */
import { parseListing } from "../lib/reddit";
import type { RedditPost } from "../lib/types";

interface SamplePost {
  id: string;
  subreddit: string;
  title: string;
  selftext: string;
  ageMinutes: number;
  flair?: string;
  stickied?: boolean;
}

export const SAMPLE_POSTS: SamplePost[] = [
  {
    id: "s1clinic",
    subreddit: "smallbusiness",
    title: "Need a chatbot for my dental clinic website — who builds these?",
    selftext:
      "We get the same 20 questions every day (timings, fees, insurance, booking). I want a chatbot on our website and ideally WhatsApp that answers these and books appointments into our calendar. Budget is flexible for the right person. Looking for someone who has done this before.",
    ageMinutes: 45,
  },
  {
    id: "s2mvp",
    subreddit: "hireaprogrammer",
    title: "[Hiring] Developer to build MVP for a tutoring marketplace",
    selftext:
      "Non-technical founder. Need a web app MVP: tutor profiles, booking, Stripe payments, simple admin. Next.js preferred. Paid project, looking to start in 2 weeks. Please share past work.",
    ageMinutes: 120,
    flair: "Hiring",
  },
  {
    id: "s3followup",
    subreddit: "automation",
    title: "How do I automate my lead follow-up? Leads from website form sit for days",
    selftext:
      "Small agency here. Leads come in through a Webflow form into Google Sheets and nobody follows up for 2-3 days. What's the simplest way to auto-send a follow-up email and ping us on Slack? Not very technical.",
    ageMinutes: 200,
  },
  {
    id: "s4forhire",
    subreddit: "forhire",
    title: "[For Hire] Full stack developer — React, Node, AI chatbots, $25/hr",
    selftext: "I build websites, apps and chatbots. DM me for my portfolio.",
    ageMinutes: 30,
    flair: "For Hire",
  },
  {
    id: "s5old",
    subreddit: "Entrepreneur",
    title: "Looking for a developer to build an app for my gym",
    selftext: "Need a mobile app with memberships and class booking.",
    ageMinutes: 60 * 30, // 30h — too old
  },
  {
    id: "s6rant",
    subreddit: "Entrepreneur",
    title: "Finally hit 10k MRR after 3 years, here's what I learned",
    selftext: "Long post about persistence, cold email and pricing.",
    ageMinutes: 90,
  },
  {
    id: "s7n8n",
    subreddit: "n8n",
    title: "n8n workflow to auto-reply WhatsApp messages with AI — possible?",
    selftext:
      "Want an AI agent that reads incoming WhatsApp Business messages and replies using our FAQ doc, and hands off to a human if it can't answer. Is n8n the right tool? Any template?",
    ageMinutes: 300,
  },
  {
    id: "s8india",
    subreddit: "IndianStartups",
    title: "Need someone to build a website + booking for my cloud kitchen in Pune",
    selftext:
      "Want a simple website with menu, online ordering and WhatsApp order notifications. Paid. Please suggest developers or agencies who've done this.",
    ageMinutes: 75,
  },
  {
    id: "s9sticky",
    subreddit: "startups",
    title: "Weekly 'Looking for a developer' megathread",
    selftext: "Post your hiring needs here.",
    ageMinutes: 100,
    stickied: true,
  },
  {
    id: "s10chatgpt",
    subreddit: "ChatGPT",
    title: "ChatGPT keeps forgetting my instructions lol",
    selftext: "Anyone else? It's so annoying.",
    ageMinutes: 20,
  },
];

/** Build listings exactly like Reddit returns them and parse with the real parser. */
export function sampleListing(subreddit: string, nowMs = Date.now()) {
  return {
    kind: "Listing",
    data: {
      children: SAMPLE_POSTS.filter((p) => p.subreddit.toLowerCase() === subreddit.toLowerCase()).map((p) => ({
        kind: "t3",
        data: {
          id: p.id,
          name: `t3_${p.id}`,
          subreddit: p.subreddit,
          title: p.title,
          selftext: p.selftext,
          permalink: `/r/${p.subreddit}/comments/${p.id}/sample/`,
          created_utc: Math.floor(nowMs / 1000) - p.ageMinutes * 60,
          link_flair_text: p.flair ?? null,
          is_self: true,
          stickied: Boolean(p.stickied),
          over_18: false,
          author: "this_field_is_ignored",
        },
      })),
    },
  };
}

export function sampleFetchNew(nowMs = Date.now()) {
  return async (subreddits: string, _limit?: number): Promise<RedditPost[]> =>
    subreddits.split("+").flatMap((s) => parseListing(sampleListing(s, nowMs)));
}

/** The same sample posts as Reddit's Atom feed (/r/<sub>/new/.rss), escaped exactly like Reddit does it. */
export function sampleAtomFeed(subreddit: string, nowMs = Date.now()): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const entries = SAMPLE_POSTS.filter((p) => p.subreddit.toLowerCase() === subreddit.toLowerCase()).map((p) => {
    const url = `https://www.reddit.com/r/${p.subreddit}/comments/${p.id}/sample/`;
    const iso = new Date(nowMs - p.ageMinutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "+00:00");
    // Reddit double-escapes: post HTML has &quot; etc., then the whole HTML is escaped into <content>.
    const html =
      `<!-- SC_OFF --><div class="md"><p>${esc(p.selftext)}</p></div><!-- SC_ON --> &#32; submitted by &#32; ` +
      `<a href="https://www.reddit.com/user/sample_user_123"> /u/sample_user_123 </a> <br/> ` +
      `<span><a href="${url}">[link]</a></span> &#32; <span><a href="${url}">[comments]</a></span>`;
    return (
      `<entry><author><name>/u/sample_user_123</name><uri>https://www.reddit.com/user/sample_user_123</uri></author>` +
      `<category term="${p.subreddit}" label="r/${p.subreddit}"/><content type="html">${esc(html)}</content>` +
      `<id>t3_${p.id}</id><link href="${url}" /><updated>${iso}</updated><published>${iso}</published>` +
      `<title>${esc(p.title)}</title></entry>`
    );
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">` +
    `<category term="${subreddit}" label="r/${subreddit}"/><title>newest submissions : ${subreddit}</title>${entries.join("")}</feed>`
  );
}
