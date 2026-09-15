import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { Hono, Context } from 'hono'
import type { LambdaEvent, LambdaContext } from 'hono/aws-lambda'
import { handle } from 'hono/aws-lambda'

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";

import { users, accounts } from "../../db/schema.js";
import { HTTPException } from "hono/http-exception";
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

type Bindings = {
    event: LambdaEvent
    lambdaContext: LambdaContext
}

const app = new Hono<{ Bindings: Bindings }>().basePath('/accounts')

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

app.get('/user', async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    return c.json({ userId: user.id })
})

// List all accounts belonging to the user.
app.get('/list', async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })
    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, user.id))
    return c.json(userAccounts)
})

// Get one account by id, scoped to the user — 404 whether it doesn't
// exist or belongs to someone else.
app.get('/:id', async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const id = c.req.param('id')
    const [userAccount] = await db.select().from(accounts).where(and(eq(accounts.userId, user.id), eq(accounts.id, id))).limit(1)

    if (!userAccount) throw new HTTPException(404, { message: "Account not found" })

    return c.json(userAccount)
})

const createAccountSchema = z.object({
    name: z.string().min(1),
    type: z.enum(["checking", "savings", "credit_card", "cash", "investment"]),
    institution: z.string().optional(),
})

// Create a new account for the user (type/institution/name from the body).
app.post('/create', zValidator('json', createAccountSchema), async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const body = c.req.valid('json')

    const values = { userId: user.id, type: body.type, name: body.name, institution: body.institution }
    const [account] = await db.insert(accounts).values(values).returning()

    return c.json(account, 201)
})

const updateAccountSchema = createAccountSchema.partial()

// Update an account by id, scoped to the user.
app.put('/:id', zValidator('json', updateAccountSchema), async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const id = c.req.param('id')
    const body = c.req.valid('json')

    const [account] = await db.update(accounts)
        .set(body)
        .where(and(eq(accounts.id, id), eq(accounts.userId, user.id)))
        .returning()

    if (!account) throw new HTTPException(404, { message: "Account not found" })

    return c.json(account)
})

// Delete an account by id, scoped to the user.
app.delete('/:id', async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const id = c.req.param('id')

    const [account] = await db.delete(accounts)
        .where(and(eq(accounts.userId, user.id), eq(accounts.id, id)))
        .returning()

    if (!account) throw new HTTPException(404, { message: "Account not found" })

    return c.json({ deleted: true })
})

app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    console.error(err)
    return c.json({ error: "internal error" }, 500)
})

export { app }
export const handler = handle(app)