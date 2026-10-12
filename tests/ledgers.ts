import { createKeyPairSignerFromBytes, createSolanaRpc, lamports, type Address, type KeyPairSigner } from "@solana/kit";
import { RpcLedger, type Ledger } from "@/lib/solana/ledger";

export type TestLedger = { name: string; ledger: Ledger; fund: (a: Address) => Promise<void> };

/** LiteSVM ships native builds for Linux and macOS only. */
export const litesvmSupported = process.platform === "linux" || process.platform === "darwin";

/**
 * LiteSVM where it runs; a live local validator too when LOCALNET_RPC_URL is
 * set; devnet (opt-in, with a pre-funded issuer) when `devnet` is allowed and
 * DEVNET_TEST_ISSUER_SECRET is set.
 */
export function testLedgerKinds(opts: { devnet?: boolean } = {}): string[] {
  const kinds: string[] = [];
  if (litesvmSupported) kinds.push("litesvm");
  if (process.env.LOCALNET_RPC_URL) kinds.push("localnet-rpc");
  if (opts.devnet && process.env.DEVNET_TEST_ISSUER_SECRET) kinds.push("devnet");
  return kinds;
}

/** The pre-funded issuer for devnet runs (solana-keygen JSON array). */
export async function devnetIssuer(): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(process.env.DEVNET_TEST_ISSUER_SECRET!)));
}

export async function makeTestLedger(kind: string): Promise<TestLedger> {
  if (kind === "litesvm") {
    // Imported lazily so platforms without a LiteSVM build can still load this module.
    const { LiteSvmLedger } = await import("./litesvm-ledger");
    const l = new LiteSvmLedger();
    return { name: kind, ledger: l, fund: async (a) => l.fund(a) };
  }
  if (kind === "devnet") {
    const ledger = new RpcLedger("devnet", process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com", 500);
    return {
      name: kind,
      ledger,
      fund: async () => {
        throw new Error("devnet runs use the pre-funded DEVNET_TEST_ISSUER_SECRET; nothing else is funded");
      },
    };
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
