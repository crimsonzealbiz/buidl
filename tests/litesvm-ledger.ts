import path from "node:path";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getSignatureFromTransaction,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS } from "@solana/attestation";
import { TransactionFailedError, type Ledger } from "@/lib/solana/ledger";

const SAS_SO = path.join(import.meta.dirname, "..", "vendor", "sas", "solana_attestation_service.so");

/**
 * An in-process Solana runtime with the real SAS program loaded. Transactions
 * are executed by the actual program, not simulated by this test code.
 */
export class LiteSvmLedger implements Ledger {
  readonly cluster = "localnet" as const;
  readonly svm = new LiteSVM();
  constructor() {
    this.svm.addProgramFromFile(SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS, SAS_SO);
  }
  fund(addr: Address, sol = 10n) {
    this.svm.airdrop(addr, lamports(sol * 1_000_000_000n));
  }
  async getAccount(address: Address) {
    return this.svm.getAccount(address);
  }
  async balance(address: Address) {
    return this.svm.getBalance(address) ?? 0n;
  }
  async genesisHash() {
    return "litesvm-local";
  }
  async send(feePayer: TransactionSigner, instructions: Instruction[], onSigned?: (s: string) => Promise<void>) {
    const tx = await pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(feePayer, m),
      (m) => this.svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
      (m) => appendTransactionMessageInstructions(instructions, m),
      (m) => signTransactionMessageWithSigners(m),
    );
    const signature = getSignatureFromTransaction(tx);
    await onSigned?.(signature);
    const res = this.svm.sendTransaction(tx);
    if (res instanceof FailedTransactionMetadata) {
      throw new TransactionFailedError(String(res.err()), signature, res.meta().logs());
    }
    this.svm.expireBlockhash();
    return signature;
  }
}
