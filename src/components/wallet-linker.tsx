"use client";

import { useEffect, useState } from "react";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { getBase58Decoder } from "@solana/kit";

type SignMessageFeature = {
  "solana:signMessage": {
    signMessage(input: { account: WalletAccount; message: Uint8Array }): Promise<{ signature: Uint8Array }[]>;
  };
};
type ConnectFeature = { "standard:connect": { connect(): Promise<{ accounts: readonly WalletAccount[] }> } };

function canSign(w: Wallet) {
  return "solana:signMessage" in w.features && "standard:connect" in w.features && w.chains.some((c) => c.startsWith("solana:"));
}

export function WalletLinker() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [status, setStatus] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const api = getWallets();
    const refresh = () => setWallets(api.get().filter(canSign));
    refresh();
    const offs = [api.on("register", refresh), api.on("unregister", refresh)];
    return () => offs.forEach((off) => off());
  }, []);

  async function link(wallet: Wallet) {
    setBusy(true);
    setStatus(null);
    try {
      const { accounts } = await (wallet.features as unknown as ConnectFeature)["standard:connect"].connect();
      const account = accounts[0];
      if (!account) throw new Error("The wallet did not share an account");
      const chRes = await fetch("/api/wallet/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: account.address }),
      });
      const ch = await chRes.json();
      if (!chRes.ok) throw new Error(ch.error ?? "Could not create a challenge");
      const [out] = await (wallet.features as unknown as SignMessageFeature)["solana:signMessage"].signMessage({
        account,
        message: new TextEncoder().encode(ch.message),
      });
      const signature = getBase58Decoder().decode(out.signature);
      const linkRes = await fetch("/api/wallet/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nonce: ch.nonce, signature }),
      });
      const linked = await linkRes.json();
      if (!linkRes.ok) throw new Error(linked.error ?? "Linking failed");
      setStatus({ tone: "ok", text: `Linked ${linked.address}` });
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setStatus({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      {wallets.length === 0 ? (
        <p className="flash warn">
          No Solana wallet that supports message signing was detected in this browser. Install a Wallet Standard
          wallet (for example Phantom, Solflare or Backpack) and reload.
        </p>
      ) : (
        <div className="row">
          {wallets.map((w) => (
            <button key={w.name} disabled={busy} onClick={() => link(w)}>
              Sign with {w.name}
            </button>
          ))}
        </div>
      )}
      {status && <div className={`flash ${status.tone}`}>{status.text}</div>}
    </div>
  );
}
