import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, expectedToken, isLoggedIn, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  if (!(await checkPassword(password))) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    redirect("/login?error=1");
  }
  (await cookies()).set(SESSION_COOKIE, await expectedToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/dashboard");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isLoggedIn()) redirect("/dashboard");
  const { error } = await searchParams;
  return (
    <main className="login">
      <form action={login} className="card login-card">
        <h1>Smartvyn Leads</h1>
        <p className="muted">Private dashboard</p>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
        {error && <p className="error">Wrong password.</p>}
        <button type="submit" className="btn primary">Sign in</button>
      </form>
    </main>
  );
}
