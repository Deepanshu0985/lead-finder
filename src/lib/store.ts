/** Storage: Supabase in production, in-memory for tests and dry runs. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LeadStatus, StoredPost } from "./types";

const msg = (e: { message?: string; code?: string; details?: string }) =>
  e.message || e.details || e.code || "network error (check SUPABASE_URL)";

export interface LeadStore {
  /** Which of these ids have we ever seen? */
  seenIds(ids: string[]): Promise<Set<string>>;
  /** Insert rows; existing ids are left untouched (never overwritten). */
  insertNew(rows: StoredPost[]): Promise<void>;
  /** Update fields of one row. */
  update(id: string, patch: Partial<StoredPost>): Promise<void>;
  /** Drafted leads not yet sent to Telegram, newest-first within score. */
  unnotifiedLeads(minScore: number, sinceIso: string, limit: number): Promise<StoredPost[]>;
  /** Atomically claim rows as notified; returns only the ids this call actually claimed. */
  claimNotified(ids: string[], atIso: string): Promise<string[]>;
  /** For the dashboard. */
  recentLeads(sinceIso: string, minScore: number): Promise<StoredPost[]>;
  setStatus(id: string, status: LeadStatus): Promise<void>;
}

// ───────────────────────── Supabase ─────────────────────────

export class SupabaseStore implements LeadStore {
  private db: SupabaseClient;
  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async seenIds(ids: string[]) {
    const seen = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { data, error } = await this.db.from("posts").select("id").in("id", chunk);
      if (error) throw new Error(`Supabase seenIds: ${msg(error)}`);
      for (const r of data ?? []) seen.add(r.id as string);
    }
    return seen;
  }

  async insertNew(rows: StoredPost[]) {
    if (!rows.length) return;
    const { error } = await this.db.from("posts").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`Supabase insert: ${msg(error)}`);
  }

  async update(id: string, patch: Partial<StoredPost>) {
    const { error } = await this.db
      .from("posts")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`Supabase update: ${msg(error)}`);
  }

  async unnotifiedLeads(minScore: number, sinceIso: string, limit: number) {
    const { data, error } = await this.db
      .from("posts")
      .select("*")
      .eq("stage", "drafted")
      .eq("status", "new")
      .is("notified_at", null)
      .gte("score", minScore)
      .gte("created_utc", sinceIso)
      .order("score", { ascending: false })
      .order("created_utc", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Supabase unnotified: ${msg(error)}`);
    return (data ?? []) as StoredPost[];
  }

  async claimNotified(ids: string[], atIso: string) {
    if (!ids.length) return [];
    // Conditional update = only rows still unnotified get claimed, so two overlapping runs can't both send.
    const { data, error } = await this.db
      .from("posts")
      .update({ notified_at: atIso, updated_at: atIso })
      .in("id", ids)
      .is("notified_at", null)
      .select("id");
    if (error) throw new Error(`Supabase claim: ${msg(error)}`);
    return (data ?? []).map((r) => r.id as string);
  }

  async recentLeads(sinceIso: string, minScore: number) {
    const { data, error } = await this.db
      .from("posts")
      .select("*")
      .eq("stage", "drafted")
      .gte("score", minScore)
      .gte("first_seen_at", sinceIso)
      .order("first_seen_at", { ascending: false })
      .order("score", { ascending: false })
      .limit(200);
    if (error) throw new Error(`Supabase recent: ${msg(error)}`);
    return (data ?? []) as StoredPost[];
  }

  async setStatus(id: string, status: LeadStatus) {
    await this.update(id, { status });
  }
}

// ───────────────────────── In-memory ─────────────────────────

export class MemoryStore implements LeadStore {
  rows = new Map<string, StoredPost>();

  async seenIds(ids: string[]) {
    return new Set(ids.filter((id) => this.rows.has(id)));
  }
  async insertNew(rows: StoredPost[]) {
    for (const r of rows) {
      if (!this.rows.has(r.id)) this.rows.set(r.id, { first_seen_at: new Date().toISOString(), ...r });
    }
  }
  async update(id: string, patch: Partial<StoredPost>) {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, ...patch });
  }
  async unnotifiedLeads(minScore: number, sinceIso: string, limit: number) {
    return [...this.rows.values()]
      .filter((r) => r.stage === "drafted" && r.status === "new" && !r.notified_at && (r.score ?? 0) >= minScore && r.created_utc >= sinceIso)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.created_utc.localeCompare(a.created_utc))
      .slice(0, limit);
  }
  async claimNotified(ids: string[], atIso: string) {
    const claimed: string[] = [];
    for (const id of ids) {
      const r = this.rows.get(id);
      if (r && !r.notified_at) {
        r.notified_at = atIso;
        claimed.push(id);
      }
    }
    return claimed;
  }
  async recentLeads(sinceIso: string, minScore: number) {
    return [...this.rows.values()]
      .filter((r) => r.stage === "drafted" && (r.score ?? 0) >= minScore && (r.first_seen_at ?? "") >= sinceIso)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }
  async setStatus(id: string, status: LeadStatus) {
    await this.update(id, { status });
  }
}

export function storeFromEnv(): LeadStore {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return new SupabaseStore(url, key);
}
