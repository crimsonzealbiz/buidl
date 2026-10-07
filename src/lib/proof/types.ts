import type { proofs, wallets } from "@/db/schema";

export type Wallet = typeof wallets.$inferSelect;
export type Proof = typeof proofs.$inferSelect;
