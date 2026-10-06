-- Smartvyn Lead Finder schema. Run once in Supabase → SQL Editor.
-- One row per Reddit post the tool has ever seen, so nothing is processed or sent twice.
-- No Reddit usernames or personal names are stored.

create table if not exists public.posts (
  id            text primary key,            -- Reddit fullname, e.g. t3_abc123
  subreddit     text not null,
  title         text not null,
  permalink     text not null,               -- https://www.reddit.com/r/.../comments/...
  created_utc   timestamptz not null,
  stage         text not null default 'filtered_out'
                check (stage in ('filtered_out', 'classified', 'drafted')),
  type          text check (type in ('client_lead', 'question_to_answer', 'irrelevant')),
  score         integer check (score between 0 and 100),
  service       text,
  reason        text,
  promo_risk    text check (promo_risk in ('low', 'medium', 'high')),
  draft         text,
  status        text not null default 'new'
                check (status in ('new', 'replied', 'skipped')),
  notified_at   timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists posts_leads_idx
  on public.posts (score desc, created_utc desc)
  where stage = 'drafted';

create index if not exists posts_unnotified_idx
  on public.posts (notified_at)
  where notified_at is null and stage = 'drafted';

-- Lock the table down: only the server (service-role key) can touch it.
alter table public.posts enable row level security;
-- (No policies = anon/authenticated keys get nothing. Service role bypasses RLS.)

-- Housekeeping: drop filtered-out rows after 14 days to stay small on the free tier.
-- Run manually or via pg_cron if you enable it:
-- delete from public.posts where stage = 'filtered_out' and first_seen_at < now() - interval '14 days';
