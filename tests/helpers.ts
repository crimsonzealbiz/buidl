import { generateKeyPair, getAddressFromPublicKey, getBase58Decoder } from "@solana/kit";
import { openDb, type Db } from "@/db";
import { upsertGithubUser } from "@/lib/auth/session";

export async function testDb(): Promise<Db> {
  return openDb("memory://");
}

let nextGithubId = 1000;
/**
 * Test fixture: creates a user record as the OAuth callback would after a real
 * GitHub login. Not reachable from the app; the app only creates users from
 * GitHub's /user response.
 */
export async function fixtureUser(db: Db, login: string) {
  return upsertGithubUser(db, { id: nextGithubId++, login, name: login, avatar_url: null });
}

/** A real Ed25519 wallet keypair that can sign messages. */
export async function testWallet() {
  const kp = await generateKeyPair();
  const address = await getAddressFromPublicKey(kp.publicKey);
  return {
    address: address as string,
    async sign(message: string) {
      const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", kp.privateKey, new TextEncoder().encode(message)));
      return getBase58Decoder().decode(sig);
    },
  };
}
