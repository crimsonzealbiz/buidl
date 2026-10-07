import {
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
  decodeCredential,
  decodeSchema,
  getCreateCredentialInstructionAsync,
  getCreateSchemaInstructionAsync,
} from "@solana/attestation";
import type { Address, KeyPairSigner } from "@solana/kit";
import { PROOF_SCHEMA_DESCRIPTION, PROOF_SCHEMA_FIELDS, deriveIssuerAddresses } from "./sas-schema";
import { assertSafeCluster, type Ledger } from "../solana/ledger";

export type IssuerConfig = {
  credentialName: string;
  schemaName: string;
  schemaVersion: number;
};

export type IssuerAddresses = {
  program: Address;
  authority: Address;
  credential: Address;
  schema: Address;
};

export async function issuerAddresses(authority: Address, cfg: IssuerConfig): Promise<IssuerAddresses> {
  const { credential, schema } = await deriveIssuerAddresses({ authority, ...cfg });
  return { program: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS, authority, credential, schema };
}

/**
 * Creates the SAS credential and schema for the issuer if they do not exist
 * yet, and checks that existing ones match what this code expects.
 */
export async function ensureIssuerSetup(ledger: Ledger, issuer: KeyPairSigner, cfg: IssuerConfig) {
  await assertSafeCluster(ledger);
  const addrs = await issuerAddresses(issuer.address, cfg);
  const actions: string[] = [];

  const credAcc = await ledger.getAccount(addrs.credential);
  if (!credAcc.exists) {
    const ix = await getCreateCredentialInstructionAsync({
      payer: issuer,
      authority: issuer,
      credential: addrs.credential,
      name: cfg.credentialName,
      signers: [issuer.address],
    });
    actions.push(`created credential (${await ledger.send(issuer, [ix])})`);
  } else {
    const cred = decodeCredential(credAcc);
    if (cred.data.authority !== issuer.address) throw new Error("Credential exists with a different authority");
  }

  const schemaAcc = await ledger.getAccount(addrs.schema);
  if (!schemaAcc.exists) {
    const ix = await getCreateSchemaInstructionAsync({
      payer: issuer,
      authority: issuer,
      credential: addrs.credential,
      schema: addrs.schema,
      name: cfg.schemaName,
      description: PROOF_SCHEMA_DESCRIPTION,
      layout: PROOF_SCHEMA_FIELDS.map(([, t]) => t),
      fieldNames: PROOF_SCHEMA_FIELDS.map(([n]) => n),
    });
    actions.push(`created schema (${await ledger.send(issuer, [ix])})`);
  } else {
    const schema = decodeSchema(schemaAcc).data;
    const expectedNames = PROOF_SCHEMA_FIELDS.map(([n]) => n).join(",");
    const expectedLayout = PROOF_SCHEMA_FIELDS.map(([, t]) => t).join(",");
    if (schema.fieldNames.join(",") !== expectedNames || schema.layout.join(",") !== expectedLayout) {
      throw new Error("Existing schema layout does not match; bump SAS_SCHEMA_VERSION");
    }
    if (schema.isPaused) throw new Error("Schema is paused");
  }
  return { addresses: addrs, actions };
}

/** Rough upper bound for one attestation (rent for the account plus fees). */
export const MIN_ISSUER_LAMPORTS = 10_000_000n; // 0.01 SOL

export type IssuerHealth = {
  authority: string;
  balanceSol: number;
  credentialExists: boolean;
  schemaExists: boolean;
  problems: string[];
};

/** What an admin needs to know before a demo: is the issuer funded and set up? */
export async function issuerHealth(ledger: Ledger, authority: Address, cfg: IssuerConfig): Promise<IssuerHealth> {
  const addrs = await issuerAddresses(authority, cfg);
  const [lamports, cred, schema] = await Promise.all([
    ledger.balance(authority),
    ledger.getAccount(addrs.credential),
    ledger.getAccount(addrs.schema),
  ]);
  const problems: string[] = [];
  if (lamports < MIN_ISSUER_LAMPORTS) {
    problems.push(`Issuer wallet ${authority} has ${Number(lamports) / 1e9} SOL; fund it with devnet SOL`);
  }
  if (!cred.exists || !schema.exists) problems.push("Issuer credential/schema not created yet; run `npm run sas:setup`");
  return {
    authority,
    balanceSol: Number(lamports) / 1e9,
    credentialExists: cred.exists,
    schemaExists: schema.exists,
    problems,
  };
}
