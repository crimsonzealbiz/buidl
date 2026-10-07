import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = path.join(process.cwd(), "drizzle");

/**
 * Opens a database. With DATABASE_URL set, connects to Postgres; otherwise
 * uses embedded PGlite (a file under .data/, or memory for "memory://").
 */
export async function openDb(url = process.env.DATABASE_URL): Promise<Db> {
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({ connectionString: url });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    return db as unknown as Db;
  }
  const dataDir = url === "memory://" ? undefined : (url ?? path.join(process.cwd(), ".data", "pglite"));
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return db as unknown as Db;
}

const globalForDb = globalThis as unknown as { __buidlDb?: Promise<Db> };

/** Process-wide database handle for the running app. */
export function getDb(): Promise<Db> {
  globalForDb.__buidlDb ??= openDb();
  return globalForDb.__buidlDb;
}

export { schema };
