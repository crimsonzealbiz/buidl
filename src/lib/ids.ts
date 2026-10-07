import { randomBytes } from "node:crypto";

export function newId(): string {
  return randomBytes(12).toString("base64url");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
