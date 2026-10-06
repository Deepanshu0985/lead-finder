# Smartvyn Lead Finder

Finds fresh Reddit posts where someone needs a chatbot, automation, website or app, ranks them with Mistral, drafts a helpful reply in the Smartvyn voice, and sends the best ones to Telegram. A small password-protected dashboard lists recent leads with editable drafts and "replied / skipped" buttons.

**It never posts to Reddit.** It only reads. You review each draft, edit it, and post it yourself.

```
GitHub Actions (every 3h)
   └─ fetch r/<sub>/new  (read-only, ~1 req/sec, 15 requests per run)
       └─ skip already-seen ids → cheap keyword/age/[For Hire] filter
           └─ Mistral classify (JSON mode, max 25 calls/run)
               └─ Mistral draft for score ≥ 60 (max 10 calls/run)
                   └─ Supabase (dedupe + status) → Telegram digest (top 8)
Vercel → /dashboard (password) → copy draft · mark replied · skip
```

---

## 1. Before anything: Reddit API access (read this)

Reddit changed its rules in **November 2025** (the *Responsible Builder Policy*). The old "go to reddit.com/prefs/apps and click *create app*" flow no longer gives you working credentials on its own. **Every new app now needs manual approval from Reddit**, and approval isn't guaranteed — small projects are sometimes refused.

Steps:

1. **Use a Reddit account for Smartvyn**, not your personal one. The policy asks that the app account is used only for the app.
2. Read the [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy).
3. Submit a request through [Reddit's Developer Support form](https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164). Be specific and honest. Something like:
   > Read-only tool for a small software studio. Every 3 hours it reads `/new` from ~15 public subreddits (about 15 GET requests per run, ~120/day), using app-only OAuth with the `read` scope. It never posts, comments, votes or messages; a human reads and replies manually. No usernames are stored and no data is shared or resold. Data is kept only to avoid showing the same post twice.
4. **Commercial use:** Reddit's Data API terms treat commercial use separately. This tool supports your business, so say that plainly in the request and ask what terms apply. Don't skip this — it's the main risk to the account.
5. Once approved, create the app at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps):
   - type: **script**
   - redirect uri: `http://localhost:8080` (required field; not used)
   - **Client ID** = the short string under the app name → `REDDIT_CLIENT_ID`
   - **Secret** → `REDDIT_CLIENT_SECRET`
6. Set `REDDIT_USER_AGENT` in Reddit's format, using the Smartvyn account's username:
   `web:smartvyn-lead-finder:1.0.0 (by /u/your_smartvyn_account)`

The tool uses **app-only OAuth with scope `read`**, so it never needs the account password and the token can't post even if someone tried.

> **Fallback while you wait:** `REDDIT_MODE=public` reads the public `.json` listings with no keys. Reddit blocks many unauthenticated requests from cloud servers (including GitHub Actions), so expect 403s. It's mainly useful from your own laptop with `npm run run:dry`.

---

## 2. Telegram bot (2 minutes)

1. In Telegram, open **@BotFather** → `/newbot` → pick a name (e.g. *Smartvyn Leads*) and a username ending in `bot`.
2. Copy the token → `TELEGRAM_BOT_TOKEN`.
3. Open your new bot and send it any message (e.g. `hi`). Bots can't message you first.
4. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser. Find `"chat":{"id": 123456789 ...}` → `TELEGRAM_CHAT_ID`.

Each run sends one short header, then one message per lead. The draft is inside a code block, so **tapping it copies it** on mobile.

---

## 3. Supabase (free tier)

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste `supabase/schema.sql` → Run.
3. **Project Settings → API**:
   - Project URL → `SUPABASE_URL`
   - the **secret / service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (server-only; never put it in browser code)

Row Level Security is on with no policies, so the public anon key can't read anything. Only the server key can.

The table stores the post id, subreddit, title, link, time, AI result, draft and your status. **No usernames or post bodies are stored.**

Free-tier projects pause after a week with no activity. Runs every 3 hours keep it awake.

---

## 4. Environment variables

Copy `.env.example` → `.env.local` for local use. Never commit it.

| Variable | Used by | What |
|---|---|---|
| `MISTRAL_API_KEY` | runner | from console.mistral.ai |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | runner | from step 1 |
| `REDDIT_USER_AGENT` | runner | `web:smartvyn-lead-finder:1.0.0 (by /u/…)` |
| `REDDIT_MODE` | runner | `oauth` (default) or `public` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | runner | from step 2 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | both | from step 3 |
| `DASHBOARD_PASSWORD` | dashboard | your login password |
| `SESSION_SECRET` | dashboard | long random string: `openssl rand -hex 32` |
| `DASHBOARD_URL` | runner | optional; adds an "Open dashboard" link in Telegram |
| `CRON_SECRET` | dashboard | optional; protects `/api/run` |

Changing `DASHBOARD_PASSWORD` or `SESSION_SECRET` logs out every open session.

---

## 5. Deploy

### Dashboard → Vercel

1. Push this folder to a **private** GitHub repo.
2. Vercel → *Add New Project* → import the repo (framework: Next.js, defaults are fine).
3. Add these env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DASHBOARD_PASSWORD`, `SESSION_SECRET` (+ `CRON_SECRET` and the runner vars if you want `/api/run` to work).
4. Deploy → open `https://<project>.vercel.app/dashboard`.

### Schedule → GitHub Actions

**Why not Vercel Cron?** On Vercel's free Hobby plan, cron jobs can run at most **once a day**, and a schedule like "every 3 hours" fails at deploy time. GitHub Actions schedules are free and have no 60-second function limit, so the runner lives there.

1. GitHub repo → **Settings → Secrets and variables → Actions**.
2. **Secrets:** `MISTRAL_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. **Variables** (optional): `DASHBOARD_URL`, `REDDIT_MODE`.
4. **Actions** tab → *Reddit lead finder* → **Run workflow** to test now.

The workflow (`.github/workflows/lead-finder.yml`) runs every 3 hours, runs the tests first (including the no-posting check), and never runs two copies at once. To change the timing, edit the `cron:` line. Times are UTC; IST is UTC+5:30.

GitHub turns off scheduled workflows in repos with no commits for 60 days. If the Telegram messages stop, check the Actions tab and re-enable it.

**Other ways to trigger a run:** any external cron service can call
`curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<project>.vercel.app/api/run`.
On Vercel Hobby, a function has a short time limit, so the GitHub Actions runner is more reliable.

---

## 6. Tuning: `lead-finder.config.ts`

Everything you'd want to change is in **one file**:

- `subreddits` — which subreddits to read (only these are ever fetched)
- `keywords` — a post must contain one of these to reach the AI
- `excludeTitlePatterns` — skips `[For Hire]` and other freelancer ads
- `scoreThreshold` — default `60`
- `ai.maxClassifyCallsPerRun` / `ai.maxDraftCallsPerRun` — cost caps (25 / 10)
- `digestSize` — leads per Telegram digest (8)
- `maxPostAgeHours` — default 24
- `brand` — name, portfolio link, services

Push the change and the next run uses it.

---

## 7. Run it locally

```bash
npm install
npm test             # 20 tests: pipeline on sample data, dedupe, caps, no-posting guard
npm run run:sample   # sample Reddit posts → real Mistral if MISTRAL_API_KEY is set → prints the digest
npm run run:dry      # REAL Reddit + Mistral, but nothing stored or sent; prints the digest
npm run run:once     # the real thing (needs every env var)
npm run dev          # dashboard at http://localhost:3000
```

`run:sample` works with no keys at all (it uses a small offline stand-in for Mistral), so you can see the whole flow end to end first.

---

## 8. How the rules are enforced

| Rule | Where |
|---|---|
| Never posts, comments, votes or messages | `src/lib/reddit.ts` has only GET for content; the single POST goes to the OAuth token URL with `scope=read`. `tests/no-posting.test.ts` scans the codebase for Reddit write endpoints and write libraries and fails the build if any appear. |
| Polite reading | ~1.1s gap between requests, honours `x-ratelimit-*` and `Retry-After`, proper User-Agent, only configured subreddits (names validated). |
| Same post never sent twice | Every fetched id is stored. Leads are "claimed" with a conditional update (`notified_at IS NULL`) before sending, so even two overlapping runs can't both send it. If Telegram fails mid-way, unsent leads are released for the next run. |
| No personal names | Reddit author fields are dropped at parse time; prompts forbid names and sign-offs; branding is "Smartvyn" / "we". |
| Draft rules | Prompt asks for helpful, short, human replies with no invented facts. Code then **enforces** links: no links/emails at all unless the post asks for a developer or recommendations (and promo risk isn't high), then at most one portfolio link. Emojis are stripped. |
| Prompt injection | Post text is wrapped as untrusted data; model output is validated and clamped before use. |
| Low AI cost | Seen-id check and keyword filter run first; hard caps per run; post body trimmed to 1,800 chars. |

---

## 9. Daily routine (≈15 min)

1. Open the Telegram digest (or the dashboard).
2. For each lead: open the post, read it fully, edit the draft so it sounds like you, post it from the Smartvyn account.
3. Mark it **replied** or **skip** on the dashboard.

Tip: in subreddits marked *promo risk: high*, post the helpful part only. Leave out the portfolio even if the draft has it.
