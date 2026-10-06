/**
 * Offline stand-in for Mistral, used by tests and `npm run run:sample` without an API key.
 * Deterministic keyword heuristics — just enough to exercise the full pipeline.
 */
import type { ChatFn } from "../lib/mistral";

export const offlineChat: ChatFn = async (messages, opts) => {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const text = user.toLowerCase();

  if (opts?.json) {
    const hiring = /(hiring|looking for someone|need someone|who builds|suggest developers|paid)/.test(text);
    const howTo = /(how do i|possible\?|what's the simplest|any template)/.test(text);
    const service = text.includes("chatbot") || text.includes("whatsapp")
      ? text.includes("n8n") ? "automation" : "chatbot"
      : text.includes("mvp") || text.includes("web app") ? "web app"
      : text.includes("website") ? "website"
      : text.includes("automate") ? "automation"
      : "other";
    const type = hiring ? "client_lead" : howTo ? "question_to_answer" : "irrelevant";
    const score = type === "client_lead" ? 88 : type === "question_to_answer" ? 70 : 10;
    const hiringSub = /subreddit: r\/(forhire|hireaprogrammer|jobbit|freelance_forhire)/.test(text);
    return JSON.stringify({
      type,
      score,
      service,
      reason: type === "irrelevant" ? "Not a buying signal or a question we can help with" : `Clear ${service} need with enough detail to reply`,
      promo_risk: hiringSub || hiring ? "low" : "medium",
      asks_for_provider: hiring,
    });
  }

  return [
    "We'd start by listing the exact questions or steps you want handled, then pick the simplest tool that covers them.",
    "",
    "For most small teams that means: a form or chat entry point, a small workflow that routes it, and a human hand-off when it's unsure.",
    "",
    "We're Smartvyn, you can see our work at https://smartvyn.vercel.app if useful. More at https://random-site.example.com 🚀",
  ].join("\n");
};
