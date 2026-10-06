/** A Reddit post as the tool sees it. No author / username is ever kept. */
export interface RedditPost {
  id: string; // fullname, e.g. t3_abc123
  subreddit: string;
  title: string;
  body: string; // selftext — used for filtering/AI only, never stored
  permalink: string; // absolute URL
  createdUtc: number; // seconds since epoch
  flair?: string | null;
  isSelf: boolean;
  stickied: boolean;
  over18: boolean;
}

export type PostType = "client_lead" | "question_to_answer" | "irrelevant";
export type PromoRisk = "low" | "medium" | "high";
export type LeadStatus = "new" | "replied" | "skipped";
export type Stage = "filtered_out" | "classified" | "drafted";

export const SERVICES = [
  "chatbot",
  "automation",
  "website",
  "web app",
  "mobile app",
  "AI integration",
] as const;
export type Service = (typeof SERVICES)[number] | "other";

export interface Classification {
  type: PostType;
  score: number;
  service: Service;
  reason: string;
  promo_risk: PromoRisk;
}

/** Row in the `posts` table. */
export interface StoredPost {
  id: string;
  subreddit: string;
  title: string;
  permalink: string;
  created_utc: string; // ISO
  stage: Stage;
  type: PostType | null;
  score: number | null;
  service: string | null;
  reason: string | null;
  promo_risk: PromoRisk | null;
  draft: string | null;
  status: LeadStatus;
  notified_at: string | null;
  first_seen_at?: string;
}

export interface RunSummary {
  fetched: number;
  alreadySeen: number;
  passedFilter: number;
  classified: number;
  aboveThreshold: number;
  drafted: number;
  notified: number;
  skippedByCap: number;
  errors: string[];
  dryRun: boolean;
}
