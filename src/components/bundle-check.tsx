"use client";

import { useState } from "react";
import type { Check } from "@/lib/proof/verify";

export function BundleCheck({ attestation }: { attestation: string }) {
  const [result, setResult] = useState<{ valid: boolean; checks: Check[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    try {
      const body = JSON.parse(await file.text());
      const res = await fetch(`/api/verify/${attestation}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Verification failed");
      setResult(json);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card">
      <label>
        Evidence export (.json)
        <input type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {error && <div className="flash error">{error}</div>}
      {result && (
        <>
          <div className={`flash ${result.valid ? "ok" : "error"}`}>
            {result.valid ? "The evidence file matches the onchain proof exactly." : "The evidence file does not match the onchain proof."}
          </div>
          <table>
            <tbody>
              {result.checks.map((c) => (
                <tr key={c.name}><td><span className={`badge ${c.ok ? "ok" : "bad"}`}>{c.ok ? "pass" : "fail"}</span></td><td>{c.name}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
