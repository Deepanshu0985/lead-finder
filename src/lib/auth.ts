/** Tiny password gate for the dashboard: an HMAC-signed cookie, no user accounts. */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "slf_session";

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Buffer.from(sig).toString("hex");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/** Token changes whenever the password or secret changes → old sessions die automatically. */
export async function expectedToken(): Promise<string> {
  const password = process.env.DASHBOARD_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret) throw new Error("DASHBOARD_PASSWORD and SESSION_SECRET must be set");
  return hmacHex(secret, `dashboard:${password}`);
}

export async function isLoggedIn(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return timingSafeEqualStr(token, await expectedToken());
}

export async function requireLogin(): Promise<void> {
  if (!(await isLoggedIn())) redirect("/login");
}

export async function checkPassword(input: string): Promise<boolean> {
  const password = process.env.DASHBOARD_PASSWORD ?? "";
  if (!password) return false;
  return timingSafeEqualStr(input, password);
}
