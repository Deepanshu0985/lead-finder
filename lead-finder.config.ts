/**
 * ─────────────────────────────────────────────────────────────
 *  Smartvyn Lead Finder — the ONE file you edit to tune things.
 * ─────────────────────────────────────────────────────────────
 *  Subreddits, keywords, score threshold, AI caps, brand info.
 *  Secrets never go here — they live in environment variables.
 */

export interface LeadFinderConfig {
  brand: { name: string; portfolioUrl: string; contactEmail: string; services: readonly string[]; audience: string };
  subreddits: readonly string[];
  keywords: readonly string[];
  excludeTitlePatterns: readonly RegExp[];
  maxPostAgeHours: number;
  scoreThreshold: number;
  postsPerSubreddit: number;
  ai: { model: string; maxClassifyCallsPerRun: number; maxDraftCallsPerRun: number; maxBodyChars: number };
  digestSize: number;
  dashboardDays: number;
}

export const config: LeadFinderConfig = {
  brand: {
    name: "Smartvyn",
    portfolioUrl: "https://smartvyn.vercel.app",
    contactEmail: "hello.smartvyn@gmail.com",
    services: [
      "AI chatbots",
      "AI automation",
      "websites",
      "full-stack web apps",
      "mobile apps",
    ],
    audience: "small businesses in India and abroad",
  },

  /** Subreddits to read (without the "r/"). Only these are ever fetched. */
  subreddits: [
    // hiring boards
    "forhire",
    "hireaprogrammer",
    "freelance_forhire",
    "jobbit",
    // business owners
    "smallbusiness",
    "Entrepreneur",
    "startups",
    "SaaS",
    "sweatystartup",
    // India
    "IndianStartups",
    "StartUpIndia",
    // automation / AI
    "automation",
    "n8n",
    "AI_Agents",
    "ChatGPT",
  ],

  /**
   * A post must contain at least one of these (title + body, case-insensitive)
   * to be sent to the AI. Plain words match whole words; phrases match as-is.
   */
  keywords: [
    "chatbot",
    "chat bot",
    "automate",
    "automation",
    "website",
    "web app",
    "developer",
    "dev",
    "programmer",
    "mvp",
    "app",
    "ai agent",
    "hire",
    "hiring",
    "looking for",
    "need someone",
    "need help",
    "freelancer",
    "whatsapp bot",
    "zapier",
    "n8n",
    "make.com",
    "crm",
    "lead follow-up",
    "follow up",
  ],

  /** Posts whose title matches any of these are skipped (other freelancers selling). */
  excludeTitlePatterns: [
    /\[\s*for\s*hire\s*\]/i,
    /\(\s*for\s*hire\s*\)/i,
    /^\s*for\s*hire\b/i,
    /\[\s*offer\s*\]/i,
    /\bhire me\b/i,
  ],

  /** Skip posts older than this. */
  maxPostAgeHours: 24,

  /** Leads at or above this score get a drafted reply and are sent to you. */
  scoreThreshold: 60,

  /** How many posts to request per subreddit per run (Reddit max is 100). */
  postsPerSubreddit: 25,

  /** Hard caps that keep Mistral costs low. */
  ai: {
    model: "mistral-small-latest",
    maxClassifyCallsPerRun: 25,
    maxDraftCallsPerRun: 10,
    /** Characters of the post body sent to the AI. */
    maxBodyChars: 1800,
  },

  /** How many leads go into each Telegram digest (top N by score). */
  digestSize: 8,

  /** Dashboard shows leads from the last N days. */
  dashboardDays: 7,
};
