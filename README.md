# Smartvyn Lead Finder

Finds fresh Reddit posts where someone needs a chatbot, automation, website or app, ranks them with Mistral, drafts a helpful reply in the Smartvyn voice, and sends the best ones to Telegram. A small password-protected dashboard lists recent leads with editable drafts and "replied / skipped" buttons.

**It never posts to Reddit.** It only reads. You review each draft, edit it, and post it yourself.

```
GitHub Actions (timer, every 3h) ──POST /api/run──▶ Vercel app (has all the keys)
   └─ read r/<sub>/new  (RSS now, official API once approved; read-only, polite pacing)
       └─ skip already-seen ids → cheap keyword/age/[For Hire] filter
           └─ Mistral classify (JSON mode, max 25 calls/run)
               └─ Mistral draft for score ≥ 60 (max 10 calls/run)
                   └─ Supabase (dedupe + status) → Telegram digest (top 8)
Vercel → /dashboard (password) → copy draft · mark replied · skip
```

**Where secrets live:** all keys go in **Vercel** only. GitHub is just a free timer that pokes your Vercel app every 3 hours, so it needs one shared password (`CRON_SECRET`) and your app's URL. Nothing else.

---

## Setup checklist (≈20 minutes)

1. **Supabase**: create the table (section 2).
2. **Telegram**: create the bot (section 3).
3. **Mistral**: get an API key at console.mistral.ai.
4. **Vercel**: deploy and add the environment variables (section 4).
5. **GitHub**: add `CRON_SECRET` + `APP_URL` (section 5).
6. **Reddit**: nothing needed to start (RSS mode). Apply for API access in parallel (section 1).

---

## 1. Reddit access: RSS now, official API later

### RSS mode (default, no keys)

With no Reddit keys set, the tool reads Reddit's public RSS feeds (`reddit.com/r/<sub>/new/.rss`). Reddit offers these for feed readers, and this tool reads them like one.

Without keys, Reddit allows about **1 request per minute**. So the tool combines subreddits (`r/a+b+c/new/.rss`, the 100 newest posts across them) into **3 requests per run** and waits the time Reddit asks for between them. A run takes about 2–3 minutes. `r/ChatGPT` is busy, so it gets its own request so it doesn't crowd out the others. You can change this under `keyless` in the config.

Things to know:
- RSS has no "pinned" or flair info. The 24-hour age filter and the `[For Hire]` title filter still cover most of that.
- **Reddit may block some networks.** If a run reports `403 … blocking this network`, Reddit is refusing that server. Check with `npm run run:check` from your Mac, and look at the run result in GitHub Actions.
- It isn't the official API, so Reddit could block or restrict it at any time. That's why it's worth applying for real access too.

### Official API (recommended, needs approval)

Since **November 2025** (Reddit's *Responsible Builder Policy*), every new API app needs manual approval. It can take a few weeks, and small projects are sometimes refused.

1. Use a **Reddit account for Smartvyn**, not your personal one.
2. Read the [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy).
3. Submit a request via [Reddit's Developer Support form](https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164). Be honest and specific, for example:
   > Read-only tool for a small software studio. Every 3 hours it reads `/new` from ~15 public subreddits (about 15 GET requests per run, ~120/day), using app-only OAuth with the `read` scope. It never posts, comments, votes or messages; a human reads and replies manually. No usernames are stored and no data is shared or resold. It supports our business, so please let us know what terms apply to commercial use.
4. Once approved, create a **script** app at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) (redirect uri: `http://localhost:8080`, not used).
5. In Vercel, add:
   - `REDDIT_CLIENT_ID`: the short string under the app name
   - `REDDIT_CLIENT_SECRET`
   - `REDDIT_USER_AGENT`: `web:smartvyn-lead-finder:1.0.0 (by /u/your_smartvyn_account)`

   Redeploy. The tool switches to the official API automatically when the ID and secret are present.

It uses app-only OAuth with scope `read`, so it never needs the account password, and the token can't post even if someone tried.

---

## 2. Supabase (free tier)

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste `supabase/schema.sql` → Run.
3. **Project Settings → API**:
   - Project URL → `SUPABASE_URL`
   - the **secret / service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (server-only)

Row Level Security is on with no policies, so the public anon key can't read anything.

The table stores the post id, subreddit, title, link, time, AI result, draft and your status. **No usernames or post bodies are stored.**

Free-tier projects pause after a week with no activity. Runs every 3 hours keep it awake.

---

## 3. Telegram bot (2 minutes)

1. In Telegram, open **@BotFather** → `/newbot` → pick a name (e.g. *Smartvyn Leads*) and a username ending in `bot`.
2. Copy the token → `TELEGRAM_BOT_TOKEN`.
3. Open your new bot and send it any message (e.g. `hi`). Bots can't message you first.
4. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser. Find `"chat":{"id": 123456789 ...}` → `TELEGRAM_CHAT_ID`.

Each run sends one short header, then one message per lead. The draft is in a code block, so **tapping it copies it** on mobile.

---

## 4. Vercel (app + all the keys)

1. Vercel → *Add New Project* → import `lead-finder` from GitHub (framework: Next.js, defaults are fine).
2. **Settings → Environment Variables**, add:

| Variable | What |
|---|---|
| `MISTRAL_API_KEY` | from console.mistral.ai |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | from section 3 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | from section 2 |
| `DASHBOARD_PASSWORD` | any password you choose |
| `SESSION_SECRET` | random string: `openssl rand -hex 32` |
| `CRON_SECRET` | another random string: `openssl rand -hex 32` |
| `DASHBOARD_URL` | optional: your app URL, adds an "Open dashboard" link in Telegram |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` / `REDDIT_USER_AGENT` | **later**, once Reddit approves (section 1) |

3. Deploy (or **Redeploy** after adding variables; Vercel only picks up new variables on a new deploy).
4. Open `https://<your-app>.vercel.app/dashboard` and log in.

A run can take 2–4 minutes (Reddit's pacing plus AI calls). The `/api/run` route allows up to 300 seconds, which Vercel's free plan supports.

Changing `DASHBOARD_PASSWORD` or `SESSION_SECRET` logs out every open session.

---

## 5. GitHub (just the timer)

**Why GitHub at all?** On Vercel's free plan, its built-in cron can only run **once a day**. GitHub Actions can run every 3 hours for free. GitHub doesn't do the work; it only calls your Vercel app.

Repo → **Settings → Secrets and variables → Actions**:
- **Secrets** tab → `CRON_SECRET`: the **same value** you put in Vercel.
- **Variables** tab → `APP_URL`: e.g. `https://smartvyn-leads.vercel.app` (no trailing slash).

Then **Actions → Reddit lead finder → Run workflow** to test. The run log shows the summary: how many posts were fetched, filtered, classified and sent.

Notes:
- Until both values are set, the workflow just skips with a warning. No failure emails.
- Times are UTC; IST is UTC+5:30. Edit the `cron:` line to change them.
- GitHub pauses scheduled workflows in repos with no commits for 60 days. If Telegram goes quiet, check the Actions tab.
- A separate **Tests** workflow runs on every push, including the check that no code can post to Reddit.

Any other cron service works too:
`curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/run`

---

## 6. Tuning: `lead-finder.config.ts`

Everything you'd want to change is in **one file**:

- `subreddits`: which subreddits to read (only these are ever fetched)
- `keywords`: a post must contain one of these to reach the AI
- `excludeTitlePatterns`: skips `[For Hire]` and other freelancer ads
- `scoreThreshold`: default `60`
- `ai.maxClassifyCallsPerRun` / `ai.maxDraftCallsPerRun`: cost caps (25 / 10)
- `digestSize`: leads per Telegram digest (8)
- `maxPostAgeHours`: default 24
- `brand`: name, portfolio link, services

Push the change; Vercel redeploys and the next run uses it.

---

## 7. Run it locally

```bash
npm install
npm test             # pipeline on sample data, RSS parsing, dedupe, caps, no-posting guard
npm run run:check    # REAL Reddit (RSS) + offline AI stand-in: does reading Reddit work from here? No keys needed.
npm run run:sample   # sample posts → real Mistral if MISTRAL_API_KEY is set → prints the digest
npm run run:dry      # REAL Reddit + real Mistral, nothing stored or sent
npm run run:once     # the real thing (needs every env var)
npm run dev          # dashboard at http://localhost:3000
```

For local runs, put keys in `.env.local` (copy `.env.example`) and load it, e.g. `node --env-file=.env.local --import tsx scripts/run.ts --dry-run`.

---

## 8. How the rules are enforced

| Rule | Where |
|---|---|
| Never posts, comments, votes or messages | `src/lib/reddit.ts` only sends GET requests for content. The single POST goes to the OAuth token URL with `scope=read`. `tests/no-posting.test.ts` scans the codebase for Reddit write endpoints and libraries and fails CI if any appear. |
| Polite reading | RSS mode: 3 combined requests per run, spaced by Reddit's own rate-limit headers (≈1/min). Official API: one request per subreddit, 1.1s apart. Honours `x-ratelimit-*` and `Retry-After`, sends a proper User-Agent, and only reads the configured subreddits (names validated). |
| Same post never sent twice | Every fetched id is stored. Leads are "claimed" with a conditional update (`notified_at IS NULL`) before sending, so two overlapping runs can't both send one. If Telegram fails mid-way, unsent leads are released for the next run. |
| No personal names | Author fields and RSS "submitted by /u/…" footers are dropped at parse time. Prompts forbid names and sign-offs; replies use "Smartvyn" / "we". |
| Draft rules | The prompt asks for helpful, short, human replies with no invented facts. Code then **enforces** links: none at all unless the post asks for a developer or recommendations (and promo risk isn't high), then at most one portfolio link. Emojis are stripped. |
| Prompt injection | Post text is wrapped as untrusted data; model output is validated and clamped before use. |
| Low AI cost | Seen-id check and keyword filter run first; hard caps per run; post body trimmed to 1,800 chars. |

---

## 9. Daily routine (≈15 min)

1. Open the Telegram digest (or the dashboard).
2. For each lead: open the post, read it fully, edit the draft so it sounds like you, and post it from the Smartvyn account.
3. Mark it **replied** or **skip** on the dashboard.

Tip: in subreddits marked *promo risk: high*, post only the helpful part. Leave out the portfolio even if the draft has it.
