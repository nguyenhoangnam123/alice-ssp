import type { Config } from "drizzle-kit";

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://ssp:ssp@localhost:5432/ssp",
  },
  strict: true,
  verbose: true,
} satisfies Config;
