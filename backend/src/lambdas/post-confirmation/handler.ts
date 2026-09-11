import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import { users, categories } from "../../db/schema.js";
import type { PostConfirmationConfirmSignUpTriggerEvent } from "aws-lambda";

export async function handler(event: PostConfirmationConfirmSignUpTriggerEvent) {
    const username = process.env.DB_USERNAME!;
    const password = process.env.DB_PASSWORD!;
    const dbHost = process.env.DB_HOST!; // "host:port"

    const [host, port] = dbHost.split(":");
    const connectionString = `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/financeapp`;

    console.log("connecting to", dbHost);
    const sql = postgres(connectionString, { max: 1, connect_timeout: 10, ssl: "require" });
    const db = drizzle(sql);

    const sub = event.request.userAttributes.sub
    const email = event.request.userAttributes.email
    const name = event.request.userAttributes.name

    const [newUser] = await db.insert(users).values({
        cognitoSub: sub,
        email,
        name,
    }).returning();

    await db.insert(categories).values([
        { userId: newUser.id, kind: "expense", name: "Groceries" },
        { userId: newUser.id, kind: "expense", name: "Rent" },
        { userId: newUser.id, kind: "expense", name: "Utilities" },
        { userId: newUser.id, kind: "expense", name: "Transportation" },
        { userId: newUser.id, kind: "expense", name: "Dining Out" },
        { userId: newUser.id, kind: "income", name: "Salary" },
    ]);

    await sql.end();


    return event;
}