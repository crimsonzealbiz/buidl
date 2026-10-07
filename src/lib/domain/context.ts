import type { Db } from "@/db";
import type { GithubClient } from "../github/client";
import type { User } from "../auth/session";
import { adminLogins } from "../config";

export type Ctx = {
  db: Db;
  github: GithubClient;
  now: () => Date;
};

export function isPlatformAdmin(user: User): boolean {
  return adminLogins().includes(user.githubLogin.toLowerCase());
}
