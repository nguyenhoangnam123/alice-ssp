import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://ssp:ssp@localhost:5432/ssp";

async function main() {
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle/migrations" });
  await sql.end();
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
