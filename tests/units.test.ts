import { describe, expect, it } from "vitest";
import { signState, verifySignedState } from "@/lib/auth/session";
import { exchangeGithubCode, githubAuthorizeUrl } from "@/lib/auth/github-oauth";
import { parseGithubEvidenceUrl, parseRepoRef } from "@/lib/github/client";
import { canonicalJson } from "@/lib/proof/canonical";
import { computeStats } from "@/lib/proof/stats";
import { buildLinkMessage, parseLinkMessage } from "@/lib/wallet/link";
import { clip, proofNonce } from "@/lib/proof/sas-schema";

describe("OAuth state", () => {
  it("accepts only the state bound to this browser's signed cookie", () => {
    const cookie = signState("abc", "secret");
    expect(verifySignedState(cookie, "abc", "secret")).toBe(true);
    expect(verifySignedState(cookie, "abd", "secret")).toBe(false);
    expect(verifySignedState(cookie, "abc", "other-secret")).toBe(false);
    expect(verifySignedState(undefined, "abc", "secret")).toBe(false);
  });
  it("requests the minimal scope", () => {
    const u = new URL(githubAuthorizeUrl({ clientId: "id", redirectUri: "http://x/cb", state: "s" }));
    expect(u.searchParams.get("scope")).toBe("read:user");
    expect(u.searchParams.get("state")).toBe("s");
  });
  it("surfaces GitHub's error instead of inventing a token", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: "bad_verification_code" }), { status: 200 });
    await expect(
      exchangeGithubCode({ clientId: "a", clientSecret: "b", code: "c", redirectUri: "d" }, fetchImpl),
    ).rejects.toThrow(/bad_verification_code/);
  });
});

describe("GitHub references", () => {
  it("parses repository refs", () => {
    expect(parseRepoRef("owner/name")).toEqual({ owner: "owner", name: "name" });
    expect(parseRepoRef("https://github.com/o/r.git")).toEqual({ owner: "o", name: "r" });
    expect(parseRepoRef("https://gitlab.com/o/r")).toBeNull();
  });
  it("parses commit and PR URLs only from github.com", () => {
    expect(parseGithubEvidenceUrl("https://github.com/o/r/commit/ABCDEF1")).toEqual({ type: "commit", owner: "o", name: "r", sha: "abcdef1" });
    expect(parseGithubEvidenceUrl("https://github.com/o/r/pull/12")).toEqual({ type: "pull", owner: "o", name: "r", number: 12 });
    expect(parseGithubEvidenceUrl("https://evil.example/o/r/commit/abcdef1")).toBeNull();
  });
});

describe("proof encoding", () => {
  it("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 1, x: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, { x: 2, y: 1 }] }, b: 1 }));
    expect(canonicalJson({ a: "é" })).toBe('{"a":"é"}');
  });
  it("nonces are deterministic per contribution", () => {
    expect(proofNonce("c1")).toBe(proofNonce("c1"));
    expect(proofNonce("c1")).not.toBe(proofNonce("c2"));
  });
  it("clips on UTF-8 character boundaries", () => {
    expect(new TextEncoder().encode(clip("é".repeat(40), 9)).length).toBeLessThanOrEqual(9);
    expect(clip("short")).toBe("short");
  });
  it("publishes only the stats a reviewer selected", () => {
    const inputs = { evidenceKinds: ["document", "commit", "document"], authorVerifiedEvidence: 0, teammateConfirmations: 2, teamSize: 3, demoUrl: null };
    expect(computeStats(["teammate_confirmations", "evidence_kinds"], inputs)).toEqual(["evidence_kinds=commit,document", "teammate_confirmations=2"]);
    expect(computeStats([], inputs)).toEqual([]);
  });
  it("link messages round-trip and reject edits", () => {
    const f = { domain: "d", address: "11111111111111111111111111111111", githubLogin: "a", githubId: 7, nonce: "n", issuedAt: "i", expiresAt: "e" };
    const m = buildLinkMessage(f);
    expect(parseLinkMessage(m)).toEqual(f);
    expect(parseLinkMessage(m + "\nextra")).toBeNull();
  });
});
