import { redirect } from "next/navigation";
import { isAddress } from "@solana/kit";

async function go(form: FormData) {
  "use server";
  const a = String(form.get("attestation") ?? "").trim();
  redirect(isAddress(a) ? `/verify/${a}` : `/verify?error=${encodeURIComponent("That is not a valid Solana address")}`);
}

export default async function VerifyIndex({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">Verify</div>
          <h1>Verify a proof</h1>
          <p className="lead-sm">Check whether a Proof of Build is authentic and was issued by the expected authority.</p>
        </div>
      </div>
      {sp.error && <div className="flash error">{sp.error}</div>}
      <form action={go} className="stack action-panel">
        <label>Attestation address<input name="attestation" required placeholder="Found on the Proof of Build page" /></label>
        <button type="submit" className="button arrow">Verify proof</button>
      </form>
      <p className="trust-note">
        Verification checks an already issued credential: that it exists on Solana, was issued under the trusted issuer
        and schema, and matches its evidence record. It confirms what the issuer attested, not the work itself.
      </p>
      <details className="advanced">
        <summary>Advanced: verify independently with the open-source CLI</summary>
        <p className="muted">Trusts only the chain, the issuer authority you pass, and the exported evidence file.</p>
        <pre>npm run verify -- &lt;attestation&gt; --bundle export.json --issuer &lt;issuer authority&gt; [--rpc &lt;url&gt;]</pre>
        <p className="muted">The issuer authority is published at <a href="/api/issuer">/api/issuer</a>.</p>
      </details>
    </>
  );
}
