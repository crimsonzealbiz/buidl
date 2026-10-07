/**
 * Browser end-to-end run of the core flow against a running app.
 *
 * Real: the Next.js app and its OAuth/session code, wallet signatures (ed25519
 * keys held by this script, exposed to the page through a Wallet Standard
 * wallet), the Solana validator and SAS program, verification and export.
 * Stubbed: GitHub (OAuth identity provider + REST API), because GitHub is not
 * reachable from the development sandbox. See docs/progress.md.
 *
 * Prereqs: a local validator (npm run localnet), the issuer set up on it
 * (npm run sas:setup), and the app started with the env printed by
 * scripts/e2e.sh, which runs all of this.
 */
import http from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { generateKeyPair, getAddressFromPublicKey } from "@solana/kit";
import { GithubStub } from "../github-stub";

const APP = process.env.E2E_APP_URL ?? "http://127.0.0.1:3100";
const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 4010);
const SHOTS = process.env.E2E_SHOTS ?? path.join(process.cwd(), ".data", "e2e-shots");
mkdirSync(SHOTS, { recursive: true });

// ---------- GitHub stub (identity provider + REST) ----------
const gh = new GithubStub();
const people: Record<string, number> = { olivia: 501, rex: 502, alice: 503, bob: 504 };
const repo = gh.addRepo({ id: 9001, owner: "team-x", name: "proofs-app", createdAt: "2026-01-01T00:00:00Z" });
gh.commit(repo, people.alice, "2026-01-02T00:00:00Z"); // pre-existing work

const stub = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://127.0.0.1:${STUB_PORT}`);
  const body = await new Promise<string>((r) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => r(b));
  });
  const send = (status: number, json: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(json));
  };
  if (url.pathname === "/login/oauth/authorize") {
    const as = /(?:^|; )as=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    if (!as || !(as in people)) return send(401, { error: "not signed in at stub IdP" });
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", `code-${as}`);
    back.searchParams.set("state", url.searchParams.get("state")!);
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (url.pathname === "/login/oauth/access_token") {
    const code = JSON.parse(body || "{}").code as string;
    return send(200, { access_token: `tok-${code.replace(/^code-/, "")}`, token_type: "bearer" });
  }
  if (url.pathname === "/user") {
    const login = (req.headers.authorization ?? "").replace("Bearer tok-", "");
    if (!(login in people)) return send(401, { message: "Bad credentials" });
    return send(200, { id: people[login], login, name: login[0].toUpperCase() + login.slice(1), avatar_url: null });
  }
  const r = await gh.fetch(url.toString());
  res.writeHead(r.status, { "content-type": "application/json" });
  res.end(await r.text());
});

// ---------- helpers ----------
let shot = 0;
async function snap(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${String(++shot).padStart(2, "0")}-${name}.png`), fullPage: true });
}

/** Clicks a server-action submit and waits for the action round-trip and re-render. */
async function submit(target: Page | ReturnType<Page["locator"]>, selector: string, page?: Page) {
  const p = page ?? (target as Page);
  await Promise.all([
    p.waitForResponse((r) => r.request().method() === "POST" && r.url().startsWith(APP), { timeout: 60_000 }),
    target.locator(selector).first().click(),
  ]);
  await p.waitForLoadState("networkidle");
}

async function expectFlash(page: Page, kind: "ok" | "error", re: RegExp) {
  const want = page.locator(`.flash.${kind}`, { hasText: re }).first();
  const other = page.locator(`.flash.${kind === "ok" ? "error" : "ok"}`).first();
  const outcome = await Promise.race([
    want.waitFor({ timeout: 45_000 }).then(() => "want" as const),
    other.waitFor({ timeout: 45_000 }).then(() => "other" as const),
  ]).catch(() => "timeout" as const);
  if (outcome !== "want") {
    await snap(page, "FAILED");
    const seen = await page.locator(".flash").allTextContents();
    throw new Error(`Expected ${kind} flash ${re}; saw ${JSON.stringify(seen)} at ${page.url()}`);
  }
  return (await want.textContent()) ?? "";
}

async function login(browser: Awaited<ReturnType<typeof chromium.launch>>, who: string) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addCookies([{ name: "as", value: who, url: `http://127.0.0.1:${STUB_PORT}` }]);
  const page = await ctx.newPage();
  await page.goto(APP);
  await page.getByRole("link", { name: "Sign in with GitHub" }).first().click();
  await page.waitForURL(/\/dashboard/);
  return { ctx, page };
}

/** Registers a Wallet Standard wallet whose key lives in this process (real ed25519). */
async function installWallet(ctx: BrowserContext) {
  const kp = await generateKeyPair();
  const address = await getAddressFromPublicKey(kp.publicKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  await ctx.exposeFunction("__e2eSign", async (bytes: number[]) =>
    Array.from(new Uint8Array(await crypto.subtle.sign("Ed25519", kp.privateKey, Uint8Array.from(bytes)))),
  );
  // Passed as a string: tsx-transpiled functions reference helpers that do not exist in the page.
  await ctx.addInitScript(`(() => {
    const account = {
      address: ${JSON.stringify(address)},
      publicKey: Uint8Array.from(${JSON.stringify(Array.from(pub))}),
      chains: ["solana:devnet", "solana:localnet"],
      features: ["solana:signMessage"],
    };
    const wallet = {
      version: "1.0.0",
      name: "E2E Test Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      chains: account.chains,
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signMessage": {
          version: "1.0.0",
          signMessage: async ({ message }) => {
            const sig = await window.__e2eSign(Array.from(message));
            return [{ signedMessage: message, signature: Uint8Array.from(sig) }];
          },
        },
      },
    };
    const cb = (api) => api.register(wallet);
    window.addEventListener("wallet-standard:app-ready", (e) => cb(e.detail));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb }));
  })();`);
  return address as string;
}

const isoLocal = (d: Date) => d.toISOString().slice(0, 16);

// ---------- the flow ----------
async function main() {
  await new Promise<void>((r) => stub.listen(STUB_PORT, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    // Identity: everyone signs in through the OAuth flow.
    const olivia = await login(browser, "olivia");
    const rex = await login(browser, "rex");
    const alice = await login(browser, "alice");
    const bob = await login(browser, "bob");
    await snap(alice.page, "dashboard-after-github-login");

    // Organizer creates the event and adds a reviewer.
    await olivia.page.goto(`${APP}/events`);
    await olivia.page.fill('input[name="name"]', "Solana Summer Hack");
    await olivia.page.fill('input[name="slug"]', "solana-summer");
    await olivia.page.fill('textarea[name="description"]', "A weekend of building on Solana.");
    await olivia.page.fill('input[name="startsAt"]', isoLocal(new Date(Date.now() - 3600_000)));
    await olivia.page.fill('input[name="endsAt"]', isoLocal(new Date(Date.now() + 2 * 86400_000)));
    await olivia.page.fill('input[name="submissionDeadline"]', isoLocal(new Date(Date.now() + 86400_000)));
    await submit(olivia.page, 'button:has-text("Create event")');
    await expectFlash(olivia.page, "ok", /Event created/);
    await olivia.page.fill('input[name="login"]', "rex");
    await submit(olivia.page, 'button:has-text("Add staff")');
    await expectFlash(olivia.page, "ok", /rex is now a reviewer/);

    // Organizer edits settings: team size, chain, prizes.
    await olivia.page.click("summary:has-text('Edit event settings')");
    await olivia.page.fill('input[name="maxTeamSize"]', "2");
    await olivia.page.fill('textarea[name="prizes"]', "Grand prize | $5,000\nBest design | $1,000");
    await submit(olivia.page, 'button:has-text("Save changes")');
    await expectFlash(olivia.page, "ok", /Event updated/);
    await olivia.page.locator("text=Grand prize").first().waitFor();

    // Alice: register, team, repository baseline.
    const ev = `${APP}/events/solana-summer`;
    await alice.page.goto(ev);
    await submit(alice.page, 'button:has-text("Register for this event")');
    await expectFlash(alice.page, "ok", /Registered/);
    await alice.page.fill('input[name="name"]', "Team X");
    await submit(alice.page, 'button:has-text("Create team")');
    await expectFlash(alice.page, "ok", /Team created/);
    const joinCode = (await alice.page.locator("text=Join code for teammates").locator(".mono").textContent())!.trim();
    await alice.page.fill('input[name="repo"]', "team-x/proofs-app");
    await submit(alice.page, 'button:has-text("Register repository")');
    await expectFlash(alice.page, "ok", /baseline/);
    const aliceSha = gh.commit(repo, people.alice); // work during the event

    // Bob joins with the code.
    await bob.page.goto(ev);
    await submit(bob.page, 'button:has-text("Register for this event")');
    await bob.page.fill('input[name="code"]', joinCode);
    await submit(bob.page, 'button:has-text("Join")');
    await expectFlash(bob.page, "ok", /Joined Team X/);

    // Product submission.
    await alice.page.goto(ev);
    await alice.page.fill('input[name="productName"]', "ProofKit");
    await alice.page.fill('textarea[name="summary"]', "Wallet-native proof of who built what at hackathons.");
    await alice.page.fill('input[name="demoUrl"]', "https://proofkit.example");
    await submit(alice.page, 'button:has-text("Submit product")');
    await expectFlash(alice.page, "ok", /Submission saved/);

    // Alice: engineering contribution with GitHub-verified commit evidence.
    await alice.page.selectOption('select[name="category"]', "engineering");
    await alice.page.fill('input[name="title"]', "Attestation pipeline");
    await alice.page.fill('textarea[name="description"]', "Built the issuance pipeline and the independent verifier for proofs.");
    await submit(alice.page, 'button:has-text("Save and add evidence")');
    await expectFlash(alice.page, "ok", /Contribution saved/);
    await alice.page.selectOption('select[name="kind"]', "commit");
    await alice.page.fill('input[name="url"]', `https://github.com/team-x/proofs-app/commit/${aliceSha}`);
    await alice.page.fill('textarea[name="description"]', "Issuer service and verifier");
    await submit(alice.page, 'button:has-text("Add evidence")');
    await expectFlash(alice.page, "ok", /authorship verified/);
    await submit(alice.page, 'button:has-text("Submit for review")');
    await expectFlash(alice.page, "ok", /Submitted for review/);
    const aliceContribUrl = alice.page.url().split("?")[0];
    await snap(alice.page, "engineering-contribution-submitted");

    // Bob: design contribution with non-code evidence.
    await bob.page.goto(ev);
    await bob.page.selectOption('select[name="category"]', "design");
    await bob.page.fill('input[name="title"]', "Product and interaction design");
    await bob.page.fill('textarea[name="description"]', "Designed the proof card, verification page and onboarding; ran interviews.");
    await submit(bob.page, 'button:has-text("Save and add evidence")');
    await bob.page.selectOption('select[name="kind"]', "design_file");
    await bob.page.fill('input[name="url"]', "https://www.figma.com/file/abc/proofkit");
    await bob.page.fill('textarea[name="description"]', "Final screens in Figma");
    await submit(bob.page, 'button:has-text("Add evidence")');
    await expectFlash(bob.page, "ok", /Evidence added/);
    await submit(bob.page, 'button:has-text("Submit for review")');
    await expectFlash(bob.page, "ok", /Submitted for review/);
    const bobContribUrl = bob.page.url().split("?")[0];

    // Alice corroborates Bob.
    await alice.page.goto(bobContribUrl);
    await alice.page.fill('textarea[name="statement"]', "Bob designed every screen we shipped.");
    await submit(alice.page, 'button:has-text("Confirm")');
    await expectFlash(alice.page, "ok", /Confirmation recorded/);

    // Reviewer approves Alice (with stats) and rejects nothing; approves Bob.
    await rex.page.goto(`${ev}/review`);
    await snap(rex.page, "review-queue");
    const aliceCard = rex.page.locator("section.card", { hasText: "Attestation pipeline" });
    await aliceCard.locator('textarea[name="rationale"]').fill("Verified commit implements the issuer and verifier as described.");
    await aliceCard.locator('input[value="github_authorship_verified"]').check();
    await aliceCard.locator('input[value="evidence_items"]').check();
    await submit(aliceCard, 'button:has-text("Record decision")', rex.page);
    await expectFlash(rex.page, "ok", /approved/);
    const bobCard = rex.page.locator("section.card", { hasText: "Product and interaction design" });
    await bobCard.locator('textarea[name="rationale"]').fill("The Figma file shows the shipped design; teammate corroborates.");
    await bobCard.locator('input[value="evidence_kinds"]').check();
    await submit(bobCard, 'button:has-text("Record decision")', rex.page);
    await expectFlash(rex.page, "ok", /approved/);

    // Bob has no wallet: issuing is blocked.
    await bob.page.goto(bobContribUrl);
    if (!(await bob.page.locator("text=must link a wallet").count())) throw new Error("Expected wallet requirement for Bob");

    // Alice links a wallet by signing, then issues her proof.
    const aliceWallet = await installWallet(alice.ctx);
    await alice.page.goto(`${APP}/wallet`);
    await alice.page.click('button:has-text("Sign with E2E Test Wallet")');
    await expectFlash(alice.page, "ok", new RegExp(`Linked ${aliceWallet}`));
    await alice.page.goto(aliceContribUrl);
    await submit(alice.page, 'button:has-text("Issue proof")');
    await expectFlash(alice.page, "ok", /Proof confirmed onchain/);
    await snap(alice.page, "proof-confirmed");

    // Proof page → export → independent verification with the exported file.
    await alice.page.locator("a.mono").first().click();
    await alice.page.waitForURL(/\/proofs\//);
    await snap(alice.page, "proof-page");
    const proofUrl = alice.page.url().split("?")[0];
    const [download] = await Promise.all([
      alice.page.waitForEvent("download"),
      alice.page.click('a:has-text("Download evidence")'),
    ]);
    const exportPath = path.join(SHOTS, "evidence-export.json");
    await download.saveAs(exportPath);
    const exported = JSON.parse(readFileSync(exportPath, "utf8"));
    if (exported.bundle.holder.wallet !== aliceWallet) throw new Error("Export names the wrong wallet");

    const anon = await browser.newContext();
    const vp = await anon.newPage();
    await vp.goto(`${APP}/verify/${exported.proof.attestation}`);
    await expectFlash(vp, "ok", /Valid/);
    await vp.setInputFiles('input[type="file"]', exportPath);
    await vp.locator("text=matches the onchain proof exactly").waitFor({ timeout: 20_000 });
    await snap(vp, "independent-verification");

    // Opportunity: eligibility from verified proofs.
    await olivia.page.goto(`${APP}/opportunities`);
    await olivia.page.fill('input[name="title"]', "Demo Day: engineering track");
    await olivia.page.fill('textarea[name="description"]', "Present at demo day. Requires a verified engineering proof.");
    await olivia.page.selectOption('select[name="eventId"]', { label: "Solana Summer Hack" });
    await olivia.page.check('input[name="categories"][value="engineering"]');
    await submit(olivia.page, 'button:has-text("Create")');
    await expectFlash(olivia.page, "ok", /Opportunity created/);
    await olivia.page.click("text=Demo Day: engineering track");
    await olivia.page.waitForURL(/\/opportunities\/[^/?]+$/);
    const oppUrl = olivia.page.url();

    await bob.page.goto(oppUrl);
    await bob.page.locator(".flash.warn", { hasText: "Needs 1 verified proof" }).waitFor();
    await alice.page.goto(oppUrl);
    await alice.page.locator("text=You are eligible.").waitFor();
    await submit(alice.page, 'button:has-text("Apply")');
    await expectFlash(alice.page, "ok", /eligibility was verified onchain/);
    await snap(alice.page, "opportunity-applied");

    // Organizer revokes the proof; it stops verifying.
    await olivia.page.goto(proofUrl);
    await olivia.page.click("summary:has-text('Revoke this proof')");
    await olivia.page.fill('textarea[name="reason"]', "Approved by mistake during the e2e run.");
    await submit(olivia.page, 'button:has-text("Revoke proof")');
    await expectFlash(olivia.page, "ok", /revoked onchain/);
    await snap(olivia.page, "proof-revoked");
    await vp.goto(`${APP}/verify/${exported.proof.attestation}`);
    await expectFlash(vp, "error", /Not a valid/);

    console.log(JSON.stringify({ result: "PASS", attestation: exported.proof.attestation, tx: exported.proof.transaction, screenshots: SHOTS }));
  } finally {
    await browser.close();
    stub.close();
  }
}

main().catch((e) => {
  console.error("E2E FAIL:", e);
  process.exit(1);
});
