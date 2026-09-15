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

beforeEach(() => {
    resetQueue()
})

describe('GET /categories/list', () => {
    it('404s when no user row matches the claims', async () => {
        queueResult([]) // resolveUser's select finds nothing
        const res = await app.request('/categories/list', {}, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(404)
    })

    it('returns the categories belonging to the resolved user', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([{ id: 'cat-1', userId: 'user-1', kind: 'expense', name: 'Groceries' }]) // list query
        const res = await app.request('/categories/list', {}, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([{ id: 'cat-1', userId: 'user-1', kind: 'expense', name: 'Groceries' }])
    })
})

describe('GET /categories/:id', () => {
    it('404s when nothing matched (wrong id or not this user\'s category)', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([]) // select().where().limit() found nothing
        const res = await app.request('/categories/cat-999', {}, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(404)
    })

    it('returns the matching category', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([{ id: 'cat-1', userId: 'user-1', kind: 'expense', name: 'Groceries' }])
        const res = await app.request('/categories/cat-1', {}, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ id: 'cat-1', userId: 'user-1', kind: 'expense', name: 'Groceries' })
    })
})

describe('POST /categories/create', () => {
    it('rejects a body with an invalid kind', async () => {
        queueResult([fakeUser])
        const res = await app.request('/categories/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Groceries', kind: 'not-a-real-kind' }),
        }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(400)
    })

    it('creates a category and returns 201', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([{ id: 'cat-1', userId: 'user-1', kind: 'expense', name: 'Groceries' }]) // insert().returning()
        const res = await app.request('/categories/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Groceries', kind: 'expense' }),
        }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(201)
        expect(await res.json()).toMatchObject({ id: 'cat-1', name: 'Groceries', kind: 'expense' })
    })
})

describe('PUT /categories/:id', () => {
    it('404s when nothing matched (wrong id or not this user\'s category)', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([]) // update().returning() found nothing
        const res = await app.request('/categories/cat-999', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Renamed' }),
        }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(404)
    })

    it('updates and returns the category', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([{ id: 'cat-1', userId: 'user-1', kind: 'expense', name: 'Renamed' }]) // update().returning()
        const res = await app.request('/categories/cat-1', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Renamed' }),
        }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ id: 'cat-1', name: 'Renamed' })
    })
})

describe('DELETE /categories/:id', () => {
    it('404s when nothing matched (wrong id or not this user\'s category)', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([]) // delete().returning() found nothing
        const res = await app.request('/categories/cat-999', { method: 'DELETE' }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(404)
    })

    it('deletes and confirms', async () => {
        queueResult([fakeUser]) // resolveUser
        queueResult([{ id: 'cat-1', userId: 'user-1', kind: 'expense', name: 'Groceries' }]) // delete().returning()
        const res = await app.request('/categories/cat-1', { method: 'DELETE' }, { event: eventWithClaims({ sub: 'sub-123' }) })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ deleted: true })
    })
})
