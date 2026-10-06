/**
 * CLI runner. Used by GitHub Actions and for local testing.
 *
 *   npm run run:once     → real run (Reddit + Mistral + Supabase + Telegram)
 *   npm run run:dry      → real Reddit + Mistral, but in-memory store and console output
 *   npm run run:sample   → sample Reddit data, real Mistral if MISTRAL_API_KEY is set
 *                          (else a canned offline model), console output only
 */
import { runFromEnv } from "../src/lib/run";
import { sampleFetchNew } from "../src/sample/sample-posts";
import { offlineChat } from "../src/sample/offline-chat";

async function main() {
  const args = new Set(process.argv.slice(2));
  const sample = args.has("--sample");
  const dryRun = sample || args.has("--dry-run");

  if (sample) {
    console.log(
      process.env.MISTRAL_API_KEY
        ? "Sample mode: fixture Reddit posts + REAL Mistral, nothing stored or sent.\n"
        : "Sample mode: fixture Reddit posts + offline canned model (set MISTRAL_API_KEY to use Mistral).\n",
    );
  }

  const summary = await runFromEnv({
    dryRun,
    fetchNew: sample ? sampleFetchNew() : undefined,
    chat: sample && !process.env.MISTRAL_API_KEY ? offlineChat : undefined,
  });

  console.log("\nSummary:", summary);
  // Partial errors (one subreddit down) shouldn't fail the job; total failure should.
  if (summary.fetched === 0 && summary.errors.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
