import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

export async function handler(event?: { action?: string; sql?: string }) {
  const username = process.env.DB_USERNAME!;
  const password = process.env.DB_PASSWORD!;
  const dbHost = process.env.DB_HOST!; // "host:port"

  const [host, port] = dbHost.split(":");
  const connectionString = `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/financeapp`;

  console.log("connecting to", dbHost);
  const sql = postgres(connectionString, { max: 1, connect_timeout: 10, ssl: "require" });
  const db = drizzle(sql);

  if (event?.action === "query" && event?.sql) {
    console.log("running ad-hoc query");
    const rows = await sql.unsafe(event.sql);
    await sql.end();
    console.log("query complete");
    return { status: "ok", rows };
  }

  console.log("running migrations");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrations complete");

  await sql.end();

  return { status: "ok" };
}
