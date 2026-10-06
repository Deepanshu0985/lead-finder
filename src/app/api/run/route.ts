/**
 * Trigger a run over HTTP. Protected by CRON_SECRET.
 * GitHub Actions calls this every 3 hours, so all real secrets live only in Vercel.
 */
import { timingSafeEqualStr } from "@/lib/auth";
import { runFromEnv } from "@/lib/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Hobby allows up to 300s with Fluid compute (on by default)

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
