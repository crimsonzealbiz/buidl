import { createSolanaRpc, lamports, type Address } from "@solana/kit";
import { RpcLedger, type Ledger } from "@/lib/solana/ledger";
import { LiteSvmLedger } from "./litesvm-ledger";

export type TestLedger = { name: string; ledger: Ledger; fund: (a: Address) => Promise<void> };

/** LiteSVM always; a live local validator too when LOCALNET_RPC_URL is set. */
export function testLedgerKinds(): string[] {
  return process.env.LOCALNET_RPC_URL ? ["litesvm", "localnet-rpc"] : ["litesvm"];
}

export async function makeTestLedger(kind: string): Promise<TestLedger> {
  if (kind === "litesvm") {
    const l = new LiteSvmLedger();
    return { name: kind, ledger: l, fund: async (a) => l.fund(a) };
  }
  const url = process.env.LOCALNET_RPC_URL!;
  const rpc = createSolanaRpc(url);
  const ledger = new RpcLedger("localnet", url, 250);
  return {
    name: kind,
    ledger,
    fund: async (a) => {
      const sig = await rpc.requestAirdrop(a, lamports(10_000_000_000n), { commitment: "confirmed" }).send();
      for (let i = 0; i < 60; i++) {
        const { value } = await rpc.getSignatureStatuses([sig]).send();
        if (value[0]?.confirmationStatus === "confirmed" || value[0]?.confirmationStatus === "finalized") return;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error("airdrop not confirmed");
    },
  };
}
