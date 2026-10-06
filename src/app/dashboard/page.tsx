import Link from "next/link";
import { config } from "../../../lead-finder.config";
import { requireLogin } from "@/lib/auth";
import { ageLabel } from "@/lib/prefilter";
import { storeFromEnv } from "@/lib/store";
import type { LeadStatus, StoredPost } from "@/lib/types";
import { logout, setLeadStatus } from "./actions";
import { DraftBox } from "./DraftBox";

export const dynamic = "force-dynamic";

const FILTERS = ["new", "replied", "skipped", "all"] as const;
type Filter = (typeof FILTERS)[number];

const TYPE_LABEL: Record<string, string> = { client_lead: "Client lead", question_to_answer: "Question" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireLogin();
  const sp = await searchParams;
  const filter: Filter = (FILTERS as readonly string[]).includes(sp.status ?? "") ? (sp.status as Filter) : "new";

  let leads: StoredPost[] = [];
  let loadError: string | null = null;
  try {
    const since = new Date(Date.now() - config.dashboardDays * 86_400_000).toISOString();
    leads = await storeFromEnv().recentLeads(since, config.scoreThreshold);
  } catch (e) {
    loadError = (e as Error).message;
  }

  const counts = { new: 0, replied: 0, skipped: 0, all: leads.length };
  for (const l of leads) counts[l.status]++;
  const shown = (filter === "all" ? leads : leads.filter((l) => l.status === filter)).sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || b.created_utc.localeCompare(a.created_utc),
  );

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Smartvyn Leads</h1>
          <p className="muted small">
            Last {config.dashboardDays} days · score ≥ {config.scoreThreshold} · read-only, you post manually
          </p>
        </div>
        <form action={logout}>
          <button className="btn ghost" type="submit">Log out</button>
        </form>
      </header>

      <nav className="tabs">
        {FILTERS.map((f) => (
          <Link key={f} href={`/dashboard?status=${f}`} className={f === filter ? "tab active" : "tab"}>
            {f[0].toUpperCase() + f.slice(1)} <span className="count">{counts[f]}</span>
          </Link>
        ))}
      </nav>

      {loadError && <p className="error card">Couldn&apos;t load leads: {loadError}</p>}
      {!loadError && shown.length === 0 && <p className="muted card">Nothing here yet.</p>}

      <ul className="list">
        {shown.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}
      </ul>
    </main>
  );
}

function LeadCard({ lead }: { lead: StoredPost }) {
  const created = Math.floor(new Date(lead.created_utc).getTime() / 1000);
  const tone = (lead.score ?? 0) >= 85 ? "hot" : (lead.score ?? 0) >= 70 ? "warm" : "ok";
  return (
    <li className="card lead">
      <div className="lead-head">
        <span className={`score ${tone}`}>{lead.score}</span>
        <div className="lead-title">
          <a href={lead.permalink} target="_blank" rel="noopener noreferrer">{lead.title}</a>
          <div className="meta">
            <span>r/{lead.subreddit}</span>
            <span>{ageLabel(created)}</span>
            <span className="pill">{TYPE_LABEL[lead.type ?? ""] ?? lead.type}</span>
            <span className="pill">{lead.service}</span>
            <span className={`pill risk-${lead.promo_risk}`}>promo risk: {lead.promo_risk}</span>
            {lead.status !== "new" && <span className={`pill st-${lead.status}`}>{lead.status}</span>}
          </div>
        </div>
      </div>
      <p className="reason">{lead.reason}</p>
      {lead.draft && <DraftBox draft={lead.draft} />}
      <div className="row actions">
        <a className="btn" href={lead.permalink} target="_blank" rel="noopener noreferrer">Open on Reddit ↗</a>
        {(["replied", "skipped", "new"] as LeadStatus[])
          .filter((s) => s !== lead.status)
          .map((s) => (
            <form key={s} action={setLeadStatus}>
              <input type="hidden" name="id" value={lead.id} />
              <input type="hidden" name="status" value={s} />
              <button className={`btn ${s === "replied" ? "ok" : "ghost"}`} type="submit">
                {s === "replied" ? "Mark replied" : s === "skipped" ? "Skip" : "Back to new"}
              </button>
            </form>
          ))}
      </div>
    </li>
  );
}
