import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, gte, lte } from "drizzle-orm";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

import { users, categories, transactions } from "../../db/schema.js";

function connect_db(): typeof db {
    const username = process.env.DB_USERNAME!;
    const password = process.env.DB_PASSWORD!;
    const dbHost = process.env.DB_HOST!; // "host:port"

    const [host, port] = dbHost.split(":");
    const connectionString = `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/financeapp`;

    console.log("connecting to", dbHost);
    const sql = postgres(connectionString, { max: 1, connect_timeout: 10, ssl: "require" });
    const db = drizzle(sql);

    return db;
}

const db = connect_db();
const sqs = new SQSClient({});

type CategoryTotal = { categoryName: string; kind: "income" | "expense" | "uncategorized"; total: number };

export async function handler() {
    const weekEnd = new Date();
    const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    const rows = await db
        .select({
            userId: users.id,
            email: users.email,
            categoryName: categories.name,
            categoryKind: categories.kind,
            amount: transactions.amount,
        })
        .from(transactions)
        .innerJoin(users, eq(users.id, transactions.userId))
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .where(and(gte(transactions.occurredAt, weekStart), lte(transactions.occurredAt, weekEnd)));

    // Users with zero transactions that week are skipped entirely rather than
    // sent an empty digest — an empty email isn't useful and this Lambda has
    // no way to know a user exists without at least one row to join through.
    const byUser = new Map<string, { email: string; categories: Map<string, CategoryTotal> }>();

    for (const row of rows) {
        if (!byUser.has(row.userId)) {
            byUser.set(row.userId, { email: row.email, categories: new Map() });
        }
        const user = byUser.get(row.userId)!;

        const key = row.categoryName ?? "__uncategorized__";
        const existing = user.categories.get(key);
        const amount = Number(row.amount);

        if (existing) {
            existing.total += amount;
        } else {
            user.categories.set(key, {
                categoryName: row.categoryName ?? "Uncategorized",
                kind: row.categoryKind ?? "uncategorized",
                total: amount,
            });
        }
    }

    let enqueued = 0;
    for (const [userId, data] of byUser) {
        const message = {
            type: "digest" as const,
            userId,
            email: data.email,
            weekStart: weekStart.toISOString(),
            weekEnd: weekEnd.toISOString(),
            categories: Array.from(data.categories.values()).map((c) => ({
                ...c,
                total: c.total.toFixed(2),
            })),
        };

        await sqs.send(
            new SendMessageCommand({
                QueueUrl: process.env.NOTIFICATION_QUEUE_URL!,
                MessageBody: JSON.stringify(message),
            })
        );
        enqueued++;
    }

    console.log(`digest complete: ${enqueued} user message(s) enqueued`);
    return { status: "ok", usersEnqueued: enqueued };
}
