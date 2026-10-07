import { describe, expect, it } from "vitest";
import { activeWallet, completeLink, createLinkChallenge, parseLinkMessage, verifyWalletSignature } from "@/lib/wallet/link";
import { fixtureUser, testDb, testWallet } from "./helpers";

describe("signed wallet linkage", () => {
  it("links a wallet only with a valid signature over the issued challenge", async () => {
    const db = await testDb();
    const alice = await fixtureUser(db, "alice");
    const w = await testWallet();
    const ch = await createLinkChallenge(db, alice, w.address, "buidl.test");
    expect(ch.message).toContain(`Wallet: ${w.address}`);
    expect(ch.message).toContain(`GitHub: alice (id ${alice.githubId})`);

    const linked = await completeLink(db, alice, ch.nonce, await w.sign(ch.message));
    expect(linked.address).toBe(w.address);
    expect((await activeWallet(db, alice.id))?.address).toBe(w.address);
    // The stored message + signature can be re-verified by anyone.
    expect(await verifyWalletSignature(linked.address, linked.message, linked.signature)).toBe(true);
    expect(parseLinkMessage(linked.message)?.githubId).toBe(alice.githubId);
  });

  it("rejects a signature from a different wallet", async () => {
    const db = await testDb();
    const alice = await fixtureUser(db, "alice");
    const w = await testWallet();
    const attacker = await testWallet();
    const ch = await createLinkChallenge(db, alice, w.address, "buidl.test");
    await expect(completeLink(db, alice, ch.nonce, await attacker.sign(ch.message))).rejects.toThrow(/Signature/);
    expect(await activeWallet(db, alice.id)).toBeNull();
  });

  it("rejects a signature over a different message", async () => {
    const db = await testDb();
    const alice = await fixtureUser(db, "alice");
    const w = await testWallet();
    const ch = await createLinkChallenge(db, alice, w.address, "buidl.test");
    await expect(completeLink(db, alice, ch.nonce, await w.sign(ch.message + " "))).rejects.toThrow(/Signature/);
  });

  it("does not allow replaying or using another user's challenge, or expired challenges", async () => {
    const db = await testDb();
    const alice = await fixtureUser(db, "alice");
    const bob = await fixtureUser(db, "bob");
    const w = await testWallet();
    const ch = await createLinkChallenge(db, alice, w.address, "buidl.test");
    const sig = await w.sign(ch.message);
    await expect(completeLink(db, bob, ch.nonce, sig)).rejects.toThrow(/Unknown/);
    await completeLink(db, alice, ch.nonce, sig);
    await expect(completeLink(db, alice, ch.nonce, sig)).rejects.toThrow(/already used/);

    const ch2 = await createLinkChallenge(db, alice, w.address, "buidl.test", new Date(Date.now() - 3600_000));
    await expect(completeLink(db, alice, ch2.nonce, await w.sign(ch2.message))).rejects.toThrow(/expired/);
  });

  it("prevents one wallet from being linked to two identities", async () => {
    const db = await testDb();
    const alice = await fixtureUser(db, "alice");
    const bob = await fixtureUser(db, "bob");
    const w = await testWallet();
    const a = await createLinkChallenge(db, alice, w.address, "buidl.test");
    await completeLink(db, alice, a.nonce, await w.sign(a.message));
    const b = await createLinkChallenge(db, bob, w.address, "buidl.test");
    await expect(completeLink(db, bob, b.nonce, await w.sign(b.message))).rejects.toThrow(/another identity/);
  });

  it("linking a new wallet revokes the previous one", async () => {
    const db = await testDb();
    const alice = await fixtureUser(db, "alice");
    const w1 = await testWallet();
    const w2 = await testWallet();
    const c1 = await createLinkChallenge(db, alice, w1.address, "buidl.test");
    await completeLink(db, alice, c1.nonce, await w1.sign(c1.message));
    const c2 = await createLinkChallenge(db, alice, w2.address, "buidl.test");
    await completeLink(db, alice, c2.nonce, await w2.sign(c2.message));
    expect((await activeWallet(db, alice.id))?.address).toBe(w2.address);
  });
});
