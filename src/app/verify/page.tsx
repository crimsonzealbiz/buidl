import { redirect } from "next/navigation";
import { isAddress } from "@solana/kit";

async function go(form: FormData) {
  "use server";
  const a = String(form.get("attestation") ?? "").trim();
  redirect(isAddress(a) ? `/verify/${a}` : `/verify?error=${encodeURIComponent("Not a valid Solana address")}`);
}

export default async function VerifyIndex({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1>Verify a proof</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        Verification reads the attestation directly from Solana and checks it against the published issuer. You can
        also check an exported evidence file, or run the open-source CLI yourself:{" "}
        <code>npm run verify -- &lt;attestation&gt; --bundle export.json --issuer &lt;authority&gt;</code>.
      </p>
      {sp.error && <div className="flash error">{sp.error}</div>}
      <form action={go} className="stack card">
        <label>Attestation address<input name="attestation" required /></label>
        <button type="submit">Verify</button>
      </form>
    </>
  );
}
