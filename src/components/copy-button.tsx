"use client";

import { useState } from "react";

/** Copies `text` (or, when it starts with "/", the absolute URL of that path). */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  async function copy() {
    const value = text.startsWith("/") ? `${window.location.origin}${text}` : text;
    try {
      await navigator.clipboard.writeText(value);
      setState("done");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1800);
  }
  return (
    <button type="button" className="secondary" onClick={copy}>
      {state === "done" ? "Copied ✓" : state === "failed" ? "Copy blocked by browser" : label}
    </button>
  );
}
