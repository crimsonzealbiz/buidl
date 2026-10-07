import { activeWallet } from "@/lib/wallet/link";
import { WalletLinker } from "@/components/wallet-linker";
import { fmt } from "@/components/ui";
import { makeCtx, requireSession } from "@/server/session";

export default async function WalletPage() {
  const session = await requireSession();
  const { db } = await makeCtx(session);
  const wallet = await activeWallet(db, session.user.id);
  return (
    <>
      <h1>Link a Solana wallet</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        Your wallet signs a one-time message naming both your wallet and your GitHub account. The signature is
        verified on the server and included in every proof&apos;s evidence bundle, so anyone can re-check the link.
        Signing costs nothing and sends no transaction.
      </p>
      {wallet && (
        <div className="card">
          Currently linked: <span className="mono">{wallet.address}</span>{" "}
          <span className="muted">since {fmt(wallet.linkedAt)}</span>
          <p className="muted">Linking a different wallet replaces this one for future proofs.</p>
        </div>
      )}
      <WalletLinker />
    </>
  );
}
