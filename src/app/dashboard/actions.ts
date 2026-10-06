"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireLogin, SESSION_COOKIE } from "@/lib/auth";
import { storeFromEnv } from "@/lib/store";
import type { LeadStatus } from "@/lib/types";

const STATUSES: LeadStatus[] = ["new", "replied", "skipped"];

export async function setLeadStatus(formData: FormData) {
  await requireLogin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as LeadStatus;
  if (!/^t3_[a-z0-9]+$/i.test(id) || !STATUSES.includes(status)) return;
  await storeFromEnv().setStatus(id, status);
  revalidatePath("/dashboard");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
