import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { Hono, Context } from 'hono'
import type { LambdaEvent, LambdaContext } from 'hono/aws-lambda'
import { handle } from 'hono/aws-lambda'

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";

import { users, categories } from "../../db/schema.js";
import { HTTPException } from "hono/http-exception";
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

type Bindings = {
    event: LambdaEvent
    lambdaContext: LambdaContext
}

const app = new Hono<{ Bindings: Bindings }>().basePath('/categories')

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

app.get('/list', async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const userCategories = await db.select().from(categories).where(eq(categories.userId, user.id))
    return c.json(userCategories)
})

app.get('/:id', async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const id = c.req.param('id')
    const [userCategory] = await db.select().from(categories).where(and(eq(categories.userId, user.id), eq(categories.id, id))).limit(1)

    if (!userCategory) throw new HTTPException(404, { message: "Category not found" })

    return c.json(userCategory)
})

const createCategorySchema = z.object({
    name: z.string().min(1),
    kind: z.enum(["income", "expense"]),
})

app.post('/create', zValidator('json', createCategorySchema), async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const body = c.req.valid('json')

    const values = { userId: user.id, kind: body.kind, name: body.name }
    const [category] = await db.insert(categories).values(values).returning()

    return c.json(category, 201)
})

const updateCategorySchema = createCategorySchema.partial()

app.put('/:id', zValidator('json', updateCategorySchema), async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const id = c.req.param('id')
    const body = c.req.valid('json')

    const [category] = await db.update(categories)
        .set(body)
        .where(and(eq(categories.id, id), eq(categories.userId, user.id)))
        .returning()

    if (!category) throw new HTTPException(404, { message: "Category not found" })

    return c.json(category)
})

app.delete('/:id', async (c) => {
    const user = await resolveUser(c)
    if (!user) throw new HTTPException(404, { message: "User not found" })

    const id = c.req.param('id')

    const [category] = await db.delete(categories)
        .where(and(eq(categories.userId, user.id), eq(categories.id, id)))
        .returning()

    if (!category) throw new HTTPException(404, { message: "Category not found" })

    return c.json({ deleted: true })
})

app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    console.error(err)
    return c.json({ error: "internal error" }, 500)
})

export { app }
export const handler = handle(app)
