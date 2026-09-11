import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

export async function handler() {
  const username = process.env.DB_USERNAME!;
  const password = process.env.DB_PASSWORD!;
  const dbHost = process.env.DB_HOST!; // "host:port"

  const [host, port] = dbHost.split(":");
  const connectionString = `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/financeapp`;

  console.log("connecting to", dbHost);
  const sql = postgres(connectionString, { max: 1, connect_timeout: 10, ssl: "require" });
  const db = drizzle(sql);

  console.log("running migrations");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrations complete");

  console.log("querying")
  const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
  console.log("query complete")
  sql.end();

  return { status: "ok", rows: rows };
}
