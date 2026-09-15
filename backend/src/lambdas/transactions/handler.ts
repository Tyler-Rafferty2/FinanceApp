import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { Hono, Context } from 'hono'
import type { LambdaEvent, LambdaContext } from 'hono/aws-lambda'
import { handle } from 'hono/aws-lambda'
import { cors } from 'hono/cors'

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";

import { users, accounts, categories, transactions } from "../../db/schema.js";
import { HTTPException } from "hono/http-exception";
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

type Bindings = {
    event: LambdaEvent
    lambdaContext: LambdaContext
}

const app = new Hono<{ Bindings: Bindings }>().basePath('/transactions')

// API Gateway's OPTIONS MOCK integration handles the CORS preflight; this
// middleware puts the matching headers on the real GET/POST/PUT/DELETE
// responses so the browser accepts them too.
app.use('*', cors({ origin: process.env.ALLOWED_ORIGIN ?? '*' }))

// Connection is reused across warm Lambda invocations (created once at module
// scope below, not per-request) since RDS Proxy — the usual fix for Lambda's
// connection-per-container fanout under real concurrency — isn't free-tier
// eligible. Free-tier RDS has a low max_connections ceiling, so this only
// holds up at low/hobby traffic; if this ever sees real concurrent load,
// revisit with RDS Proxy or a pooler in front of Postgres.
function connect_db(): typeof db {
    const username = process.env.DB_USERNAME!;
    const password = process.env.DB_PASSWORD!;
    const dbHost = process.env.DB_HOST!; // "host:port"

    const [host, port] = dbHost.split(":");
    const connectionString = `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/financeapp`;

    console.log("connecting to", dbHost);
    const sql = postgres(connectionString, { max: 1, connect_timeout: 10, ssl: "require" });
    const db = drizzle(sql);

    return db
}

const db = connect_db()

async function resolveUser(c: Context<{ Bindings: Bindings }>) {
    const event = c.env.event as unknown as APIGatewayProxyEvent
    const claims = event.requestContext.authorizer?.claims
    const [user] = await db.select().from(users).where(eq(users.cognitoSub, claims.sub))
    return user ?? null
}

async function checkOwnership(user: typeof users.$inferSelect, accountId: typeof accounts.$inferSelect.id, categoryId: string | null | undefined) {
    const [account] = await db.select().from(accounts).where(and(eq(accounts.userId, user.id), eq(accounts.id, accountId))).limit(1)
    if (!account) return false

    if (categoryId != null) {
        const [category] = await db.select().from(categories).where(and(eq(categories.userId, user.id), eq(categories.id, categoryId))).limit(1)
        if (!category) return false
    }

    return true
}

app.get('/list', async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const userTransactions = await db.select().from(transactions).where(eq(transactions.userId, user.id))
    return c.json(userTransactions)
})

app.get('/:id', async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const id = c.req.param('id')
    const [userTransaction] = await db.select().from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.id, id))).limit(1)

    if (!userTransaction) throw new HTTPException(404, { message: "Transaction not found" })

    return c.json(userTransaction)
})

const createTransactionSchema = z.object({
    amount: z.string().min(1),
    description: z.string().min(1).optional(),
    accountId: z.string().min(1),
    categoryId: z.string().min(1).nullable().optional(),
    occurredAt: z.coerce.date(),
})

app.post('/create', zValidator('json', createTransactionSchema), async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const body = c.req.valid('json')

    if (!(await checkOwnership(user, body.accountId, body.categoryId))) throw new HTTPException(404, { message: "Transaction not found" })

    const source = "manual" as const

    const values = { userId: user.id, source: source, accountId: body.accountId, categoryId: body.categoryId, amount: body.amount, description: body.description, occurredAt: body.occurredAt }

    const [transaction] = await db.insert(transactions).values(values).returning()

    return c.json(transaction, 201)
})

const updateTransactionSchema = createTransactionSchema.partial()

app.put('/:id', zValidator('json', updateTransactionSchema), async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const id = c.req.param('id')
    const body = c.req.valid('json')

    if (body.accountId !== undefined) {
        if (!(await checkOwnership(user, body.accountId, body.categoryId))) throw new HTTPException(404, { message: "Transaction not found" })
    } else if (body.categoryId !== undefined) {
        const [userTransaction] = await db.select().from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.id, id))).limit(1)
        if (!userTransaction) throw new HTTPException(404, { message: "Transaction not found" })

        if (!(await checkOwnership(user, userTransaction.accountId, body.categoryId))) throw new HTTPException(404, { message: "Transaction not found" })
    }

    const [transaction] = await db.update(transactions)
        .set(body)
        .where(and(eq(transactions.id, id), eq(transactions.userId, user.id)))
        .returning()

    if (!transaction) throw new HTTPException(404, { message: "Transaction not found" })

    return c.json(transaction)
})

app.delete('/:id', async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const id = c.req.param('id')

    const [transaction] = await db.delete(transactions)
        .where(and(eq(transactions.userId, user.id), eq(transactions.id, id)))
        .returning()

    if (!transaction) throw new HTTPException(404, { message: "Transaction not found" })

    return c.json({ deleted: true })
})

app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    console.error(err)
    return c.json({ error: "internal error" }, 500)
})

export { app }
export const handler = handle(app)
