import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";

import { users, plaidItems, accounts, transactions } from "../../db/schema.js";

function connect_db(): ReturnType<typeof drizzle> {
    const username = process.env.DB_USERNAME!;
    const password = process.env.DB_PASSWORD!;
    const dbHost = process.env.DB_HOST!;

    const [host, port] = dbHost.split(":");
    const connectionString = `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/financeapp`;

    const sql = postgres(connectionString, { max: 1, connect_timeout: 10, ssl: "require" });
    return drizzle(sql);
}

const db = connect_db();

type AccountType = "checking" | "savings" | "credit_card" | "cash" | "investment";

type ItemCreatedMessage = {
    type: "item_created";
    cognitoSub: string;
    plaidItemId: string;
    institutionName: string | null;
    accounts: { plaidAccountId: string; name: string; type: AccountType }[];
};

type PlaidTransaction = {
    transaction_id: string;
    account_id: string;
    amount: number;
    name: string;
    date: string;
};

type TransactionsSyncedMessage = {
    type: "transactions_synced";
    cognitoSub: string;
    plaidItemId: string;
    added: PlaidTransaction[];
    modified: PlaidTransaction[];
    removed: { transaction_id: string }[];
};

async function handleItemCreated(message: ItemCreatedMessage) {
    const [user] = await db.select().from(users).where(eq(users.cognitoSub, message.cognitoSub));
    if (!user) throw new Error(`no users row for cognitoSub ${message.cognitoSub} yet`);

    let [item] = await db.insert(plaidItems)
        .values({ userId: user.id, plaidItemId: message.plaidItemId, institutionName: message.institutionName })
        .onConflictDoNothing({ target: plaidItems.plaidItemId })
        .returning();

    if (!item) {
        [item] = await db.select().from(plaidItems).where(eq(plaidItems.plaidItemId, message.plaidItemId));
    }

    for (const account of message.accounts) {
        await db.insert(accounts)
            .values({
                userId: user.id,
                type: account.type,
                institution: message.institutionName,
                name: account.name,
                plaidItemId: item.id,
                plaidAccountId: account.plaidAccountId,
            })
            .onConflictDoNothing({ target: accounts.plaidAccountId });
    }
}

async function upsertTransaction(txn: PlaidTransaction) {
    const [account] = await db.select().from(accounts).where(eq(accounts.plaidAccountId, txn.account_id));
    if (!account) {
        console.warn(`no local account for plaid account ${txn.account_id}, skipping transaction ${txn.transaction_id}`);
        return;
    }

    await db.insert(transactions)
        .values({
            userId: account.userId,
            accountId: account.id,
            categoryId: null,
            amount: txn.amount.toFixed(2),
            description: txn.name,
            occurredAt: new Date(txn.date),
            source: "plaid",
            plaidTransactionId: txn.transaction_id,
        })
        .onConflictDoUpdate({
            target: transactions.plaidTransactionId,
            // categoryId intentionally excluded — don't clobber a user's
            // manual categorization on a re-sync.
            set: {
                amount: txn.amount.toFixed(2),
                description: txn.name,
                occurredAt: new Date(txn.date),
            },
        });
}

async function handleTransactionsSynced(message: TransactionsSyncedMessage) {
    for (const txn of [...message.added, ...message.modified]) {
        await upsertTransaction(txn);
    }
    for (const removed of message.removed) {
        await db.delete(transactions).where(eq(transactions.plaidTransactionId, removed.transaction_id));
    }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

    for (const record of event.Records) {
        try {
            const message = JSON.parse(record.body);
            if (message.type === "item_created") {
                await handleItemCreated(message);
            } else if (message.type === "transactions_synced") {
                await handleTransactionsSynced(message);
            } else {
                console.log("skipping unrecognized message type", message.type);
            }
        } catch (err) {
            console.error("failed to process message", record.messageId, err);
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }

    return { batchItemFailures };
}
