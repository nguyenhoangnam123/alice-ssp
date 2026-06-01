import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://ssp:ssp@localhost:5432/ssp";

const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

// Reuse the connection across hot reloads in dev.
const client = globalForDb.pgClient ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== "production") {
  globalForDb.pgClient = client;
}

export const db = drizzle(client, { schema });
export { schema };
