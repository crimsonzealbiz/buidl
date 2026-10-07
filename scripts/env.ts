import { existsSync } from "node:fs";

/** Loads .env / .env.local for CLI scripts (Next.js loads them for the app). */
for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);
