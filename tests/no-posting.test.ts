/**
 * Guard rail: no code path may write to Reddit.
 * Scans every source file. If someone adds a posting/commenting/voting/messaging endpoint
 * or a Reddit write library, this test fails the build.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "tests"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return SKIP_DIRS.has(name) ? [] : sourceFiles(full);
    return /\.(ts|tsx|js|mjs|cjs|json|ya?ml)$/.test(name) && name !== "package-lock.json" ? [full] : [];
  });
}

// Reddit write endpoints (posting, commenting, voting, messaging, moderating, editing).
const FORBIDDEN = [
  /\/api\/submit\b/i,
  /\/api\/comment\b/i,
  /\/api\/vote\b/i,
  /\/api\/compose\b/i,
  /\/api\/editusertext\b/i,
  /\/api\/del\b/i,
  /\/api\/save\b/i,
  /\/api\/hide\b/i,
  /\/api\/subscribe\b/i,
  /\/api\/report\b/i,
  /\/api\/sendreplies\b/i,
  /\/api\/read_message\b/i,
  /\/api\/block\b/i,
  /\bsnoowrap\b/i,
  /\bpraw\b/i,
  /\breddit-api\b/i,
  /scope=[^"'&\s]*(submit|edit|vote|privatemessages|identity|modposts)/i,
];

describe("read-only guarantee", () => {
  const files = sourceFiles(ROOT);

  it("found source files to scan", () => {
    expect(files.some((f) => f.endsWith(path.join("src", "lib", "reddit.ts")))).toBe(true);
  });

  it("contains no Reddit write endpoints or write-capable Reddit libraries", () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const re of FORBIDDEN) if (re.test(text)) hits.push(`${path.relative(ROOT, f)} matches ${re}`);
    }
    expect(hits).toEqual([]);
  });

  it("only reddit.ts talks to Reddit hosts", () => {
    const offenders = files.filter((f) => {
      if (f.endsWith(path.join("src", "lib", "reddit.ts"))) return false;
      const t = readFileSync(f, "utf8");
      return /oauth\.reddit\.com|reddit\.com\/api/i.test(t);
    });
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("reddit.ts has exactly one POST, and it goes to the OAuth token endpoint", () => {
    const t = readFileSync(path.join(ROOT, "src/lib/reddit.ts"), "utf8");
    const posts = t.match(/method:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/g) ?? [];
    expect(posts).toEqual(['method: "POST"']);
    const idx = t.indexOf('method: "POST"');
    expect(t.slice(Math.max(0, idx - 120), idx)).toContain("fetchImpl(TOKEN_URL");
    expect(t).toContain('const TOKEN_URL = "https://www.reddit.com/api/v1/access_token"');
    expect(t).toContain("scope=read");
  });
});
