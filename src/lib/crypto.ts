import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

/**
 * Key for encrypting secrets at rest: TOKEN_ENCRYPTION_KEY (32 bytes, base64)
 * if set, otherwise derived from SESSION_SECRET. Rotating either makes
 * existing ciphertexts unreadable (users simply sign in again).
 */
function key(): Buffer {
  const explicit = process.env.TOKEN_ENCRYPTION_KEY;
  if (explicit) {
    const k = Buffer.from(explicit, "base64");
    if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    return k;
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET (or TOKEN_ENCRYPTION_KEY) is required to encrypt tokens");
  return createHash("sha256").update(`buidl/token-encryption/v1/${secret}`).digest();
}

/** AES-256-GCM. Output: "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** Returns null when the value cannot be decrypted (wrong key, tampered, or malformed). */
export function decryptSecret(value: string): string | null {
  const [v, iv, tag, ct] = value.split(".");
  if (v !== VERSION || !iv || !tag || ct === undefined) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
