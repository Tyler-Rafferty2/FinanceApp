import { describe, it, expect, vi, beforeEach } from 'vitest'

// connect_db() runs at import time (module scope), so these need real-looking
// values before handler.ts is ever imported — they're never actually used
// since postgres.js connects lazily and drizzle itself is mocked below.
process.env.DB_USERNAME = 'test'
process.env.DB_PASSWORD = 'test'
process.env.DB_HOST = 'localhost:5432'

// A fake Drizzle query builder: every method just returns itself so calls
// chain (select().from().where()...), and awaiting the chain resolves to
// the next value queued with `queueResult`, in call order.
const { mockDb, queueResult, resetQueue } = vi.hoisted(() => {
    let results: unknown[] = []
    const builder: any = {
        select: () => builder,
        from: () => builder,
        where: () => builder,
        limit: () => builder,
        insert: () => builder,
        values: () => builder,
        update: () => builder,
        set: () => builder,
        delete: () => builder,
        returning: () => builder,
        then: (resolve: (v: unknown) => void) => resolve(results.shift() ?? []),
    }
    return {
        mockDb: builder,
        queueResult: (val: unknown) => results.push(val),
        resetQueue: () => { results = [] },
    }
})

vi.mock('postgres', () => ({ default: () => ({}) }))
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: () => mockDb }))

const { app } = await import('./handler.js')

function eventWithClaims(claims: Record<string, unknown> | undefined) {
    return {
        requestContext: {
            authorizer: claims ? { claims } : undefined,
        },
    }
}

const fakeUser = { id: 'user-1', cognitoSub: 'sub-123', name: 'Test', email: 't@example.com' }
const fakeAccount = { id: 'acct-1', userId: 'user-1', type: 'checking', name: 'Checking' }
const fakeCategory = { id: 'cat-1', userId: 'user-1', kind: 'expense', name: 'Groceries' }
const fakeTransaction = {
    id: 'txn-1',
    userId: 'user-1',
    accountId: 'acct-1',
    categoryId: 'cat-1',
    amount: '10.00',
    description: 'Coffee',
    occurredAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    source: 'manual',
}

beforeEach(() => {
    resetQueue()
})

describe('GET /transactions/list', () => {
    it('404s when no user row matches the claims', async () => {
        queueResult([]) // resolveUser's select finds nothing
        const res = await app.request('/transactions/list', {}, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(404)
    })

    it('returns the transactions belonging to the resolved user', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([fakeTransaction]) // list query
        const res = await app.request('/transactions/list', {}, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([fakeTransaction])
    })
})

describe('GET /transactions/:id', () => {
    it('404s when nothing matched (wrong id or not this user\'s transaction)', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([]) // select().where().limit() found nothing
        const res = await app.request('/transactions/txn-999', {}, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(404)
    })

    it('returns the matching transaction', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([fakeTransaction])
        const res = await app.request('/transactions/txn-1', {}, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(fakeTransaction)
    })
})

describe('POST /transactions/create', () => {
    it('rejects a body missing required fields', async () => {
        queueResult([fakeUser])
        const res = await app.request('/transactions/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: '10.00' }),
        }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(400)
    })

    it('404s when accountId does not belong to the user', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([]) // checkOwnership's accounts lookup finds nothing
        const res = await app.request('/transactions/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: '10.00',
                accountId: 'acct-someone-elses',
                occurredAt: '2026-01-01T00:00:00.000Z',
            }),
        }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(404)
    })

    it('404s when categoryId does not belong to the user', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([fakeAccount]) // checkOwnership's accounts lookup succeeds
        queueResult([]) // checkOwnership's categories lookup finds nothing
        const res = await app.request('/transactions/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: '10.00',
                accountId: 'acct-1',
                categoryId: 'cat-someone-elses',
                occurredAt: '2026-01-01T00:00:00.000Z',
            }),
        }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(404)
    })

    it('creates a transaction and returns 201, forcing source to manual', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([fakeAccount]) // checkOwnership's accounts lookup
        queueResult([fakeCategory]) // checkOwnership's categories lookup
        queueResult([fakeTransaction]) // insert().returning()
        const res = await app.request('/transactions/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: '10.00',
                accountId: 'acct-1',
                categoryId: 'cat-1',
                occurredAt: '2026-01-01T00:00:00.000Z',
                source: 'plaid', // should be ignored — server always writes "manual"
            }),
        }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(201)
        expect(await res.json()).toMatchObject({ id: 'txn-1', source: 'manual' })
    })
})

describe('PUT /transactions/:id', () => {
    it('404s when the new accountId does not belong to the user', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([]) // checkOwnership's accounts lookup finds nothing
        const res = await app.request('/transactions/txn-1', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: 'acct-someone-elses' }),
        }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(404)
    })

    it('404s when the transaction itself does not exist, updating only categoryId', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([]) // fetch existing transaction finds nothing
        const res = await app.request('/transactions/txn-999', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoryId: 'cat-1' }),
        }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(404)
    })

    it('updates and returns the transaction when nothing reference-related changed', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([{ ...fakeTransaction, description: 'Updated' }]) // update().returning()
        const res = await app.request('/transactions/txn-1', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: 'Updated' }),
        }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ id: 'txn-1', description: 'Updated' })
    })
})

describe('DELETE /transactions/:id', () => {
    it('404s when nothing matched (wrong id or not this user\'s transaction)', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([]) // delete().returning() found nothing
        const res = await app.request('/transactions/txn-999', { method: 'DELETE' }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(404)
    })

    it('deletes and confirms', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([fakeTransaction]) // delete().returning()
        const res = await app.request('/transactions/txn-1', { method: 'DELETE' }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ deleted: true })
    })
})
