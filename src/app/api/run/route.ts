/**
 * Trigger a run over HTTP. Protected by CRON_SECRET.
 * The GitHub Actions workflow runs the CLI directly (no timeout worries); this route is
 * for manual triggers, external cron services, or Vercel Cron on a paid plan.
 */
import { timingSafeEqualStr } from "@/lib/auth";
import { runFromEnv } from "@/lib/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runFromEnv();
    return Response.json(summary);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle; // Vercel Cron sends GET with Authorization: Bearer $CRON_SECRET
export const POST = handle;
