import {
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  fetchEncodedAccount,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type MaybeEncodedAccount,
  type TransactionSigner,
} from "@solana/kit";
import type { Cluster } from "../config";

export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const TESTNET_GENESIS_HASH = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";

/** What the proof code needs from a Solana cluster. */
export interface Ledger {
  readonly cluster: Cluster;
  getAccount(address: Address): Promise<MaybeEncodedAccount>;
  /** Signs and submits; resolves once confirmed. `onSigned` receives the signature before submission. */
  send(
    feePayer: TransactionSigner,
    instructions: Instruction[],
    onSigned?: (signature: string) => Promise<void>,
  ): Promise<string>;
  genesisHash(): Promise<string>;
  /** Balance in lamports. */
  balance(address: Address): Promise<bigint>;
}

export class TransactionFailedError extends Error {
  constructor(
    message: string,
    public readonly signature: string | null,
    public readonly logs: string[] = [],
  ) {
    super(message);
    this.name = "TransactionFailedError";
  }
}

/**
 * Refuses to operate against mainnet (or anything that is not the configured
 * cluster). Mainnet issuance requires separate authorization.
 */
export async function assertSafeCluster(ledger: Ledger) {
  const hash = await ledger.genesisHash();
  if (hash === MAINNET_GENESIS_HASH) throw new Error("Refusing to transact on Solana mainnet");
  if (ledger.cluster === "devnet" && hash !== DEVNET_GENESIS_HASH) {
    throw new Error(`SOLANA_RPC_URL is not devnet (genesis ${hash})`);
  }
  if (ledger.cluster === "localnet" && (hash === DEVNET_GENESIS_HASH || hash === TESTNET_GENESIS_HASH)) {
    throw new Error("SOLANA_CLUSTER=localnet but the RPC points at a public cluster");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** JSON-RPC backed ledger. Confirms by polling, so no websocket is needed. */
export class RpcLedger implements Ledger {
  private readonly rpc;
  constructor(
    public readonly cluster: Cluster,
    rpcUrl: string,
    private readonly pollMs = 1000,
  ) {
    this.rpc = createSolanaRpc(rpcUrl);
  }

  getAccount(address: Address) {
    return fetchEncodedAccount(this.rpc, address, { commitment: "confirmed" });
  }

  async genesisHash() {
    return this.rpc.getGenesisHash().send();
  }

  async balance(address: Address) {
    return (await this.rpc.getBalance(address, { commitment: "confirmed" }).send()).value;
  }

  async send(feePayer: TransactionSigner, instructions: Instruction[], onSigned?: (sig: string) => Promise<void>) {
    const { value: blockhash } = await this.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const tx = await pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
      (m) => signTransactionMessageWithSigners(m),
    );
    const signature = getSignatureFromTransaction(tx);
    await onSigned?.(signature);
    try {
      await this.rpc
        .sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", preflightCommitment: "confirmed" })
        .send();
    } catch (e) {
      const err = e as { message: string; context?: { logs?: string[] }; cause?: { context?: { logs?: string[] } } };
      throw new TransactionFailedError(err.message, signature, err.context?.logs ?? err.cause?.context?.logs ?? []);
    }
    for (;;) {
      const { value } = await this.rpc.getSignatureStatuses([signature]).send();
      const status = value[0];
      if (status?.err) throw new TransactionFailedError(`Transaction failed: ${JSON.stringify(status.err)}`, signature);
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
      const height = await this.rpc.getBlockHeight({ commitment: "confirmed" }).send();
      if (height > blockhash.lastValidBlockHeight) {
        throw new TransactionFailedError("Transaction expired before confirmation", signature);
      }
      await sleep(this.pollMs);
    }
  }
}
