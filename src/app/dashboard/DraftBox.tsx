"use client";
import { useState } from "react";

/** Editable draft + copy button. Edits stay in the browser; you post on Reddit yourself. */
export function DraftBox({ draft }: { draft: string }) {
  const [text, setText] = useState(draft);
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  return (
    <div className="draft">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(14, Math.max(5, text.split("\n").length + 2))} />
      <div className="row">
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setState("done");
            } catch {
              setState("fail");
            }
            setTimeout(() => setState("idle"), 1800);
          }}
        >
          {state === "done" ? "Copied ✓" : state === "fail" ? "Copy failed — select manually" : "Copy draft"}
        </button>
        {text !== draft && (
          <button type="button" className="btn ghost" onClick={() => setText(draft)}>
            Reset
          </button>
        )}
        <span className="muted small">{text.trim().split(/\s+/).filter(Boolean).length} words</span>
      </div>
    </div>
  );
}
