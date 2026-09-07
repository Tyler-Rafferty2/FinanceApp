import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

export async function handler() {
  const username = process.env.DB_USERNAME!;
  const password = process.env.DB_PASSWORD!;
  const dbHost = process.env.DB_HOST!; // "host:port"

  const [host, port] = dbHost.split(":");
  const connectionString = `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/scheduler`;

  console.log("connecting to", dbHost);
  const sql = postgres(connectionString, { max: 1, connect_timeout: 10, ssl: "require" });
  const db = drizzle(sql);

  console.log("running migrations");
  await migrate(db, { migrationsFolder: "./drizzle" });
  await sql.end();
  console.log("migrations complete");

  return { status: "ok" };
}
