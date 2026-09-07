import { defineConfig } from "drizzle-kit";

// DATABASE_URL comes from a local .env file (gitignored) — see README note
// in this directory for how to build it from the Terraform/Secrets Manager
// outputs after `terraform apply`.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
