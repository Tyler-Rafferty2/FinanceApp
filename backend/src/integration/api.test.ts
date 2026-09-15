// Integration tests against the REAL deployed API (API Gateway + Cognito
// authorizer + Lambdas + RDS) — not mocked, unlike the unit tests under
// src/lambdas/*/handler.test.ts. Run with `npm run test:integration`.
//
// Required env vars:
//   API_BASE_URL       - e.g. https://<id>.execute-api.<region>.amazonaws.com/dev
//   TEST_USER_EMAIL     } a confirmed Cognito user's credentials
//   TEST_USER_PASSWORD  }
// Optional (enables the cross-user ownership-rejection test):
//   TEST_USER2_EMAIL / TEST_USER2_PASSWORD - a second confirmed Cognito user
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getIdToken } from './cognito.js'

const BASE_URL = process.env.API_BASE_URL
const USER1_EMAIL = process.env.TEST_USER_EMAIL
const USER1_PASSWORD = process.env.TEST_USER_PASSWORD
const USER2_EMAIL = process.env.TEST_USER2_EMAIL
const USER2_PASSWORD = process.env.TEST_USER2_PASSWORD

const hasUser1 = Boolean(BASE_URL && USER1_EMAIL && USER1_PASSWORD)
const hasUser2 = Boolean(USER2_EMAIL && USER2_PASSWORD)

async function call(token: string | null, path: string, init: RequestInit = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...init.headers,
        },
    })
    const body = res.status === 204 ? null : await res.json().catch(() => null)
    return { status: res.status, body }
}

describe.skipIf(!hasUser1)('accounts/categories/transactions API', () => {
    let user1Token: string
    let user2Token: string | null = null

    const createdAccountIds: string[] = []
    const createdCategoryIds: string[] = []
    const createdTransactionIds: string[] = []

    beforeAll(async () => {
        user1Token = await getIdToken(USER1_EMAIL!, USER1_PASSWORD!)
        if (hasUser2) {
            user2Token = await getIdToken(USER2_EMAIL!, USER2_PASSWORD!)
        }
    })

    afterAll(async () => {
        // Best-effort cleanup so repeated runs don't pile up test data.
        for (const id of createdTransactionIds) {
            await call(user1Token, `/transactions/${id}`, { method: 'DELETE' })
        }
        for (const id of createdAccountIds) {
            await call(user1Token, `/accounts/${id}`, { method: 'DELETE' })
        }
        for (const id of createdCategoryIds) {
            await call(user1Token, `/categories/${id}`, { method: 'DELETE' })
        }
    })

    it('rejects a request with no token before it reaches any Lambda', async () => {
        const { status } = await call(null, '/accounts/list')
        expect(status).toBe(401)
    })

    it('resolves the caller from the JWT', async () => {
        const { status, body } = await call(user1Token, '/accounts/user')
        expect(status).toBe(200)
        expect(body.userId).toBeTruthy()
    })

    describe('accounts CRUD', () => {
        let accountId: string

        it('creates an account', async () => {
            const { status, body } = await call(user1Token, '/accounts/create', {
                method: 'POST',
                body: JSON.stringify({ name: 'Integration Test Checking', type: 'checking' }),
            })
            expect(status).toBe(201)
            expect(body.name).toBe('Integration Test Checking')
            accountId = body.id
            createdAccountIds.push(accountId)
        })

        it('lists accounts including the one just created', async () => {
            const { status, body } = await call(user1Token, '/accounts/list')
            expect(status).toBe(200)
            expect(body.some((a: any) => a.id === accountId)).toBe(true)
        })

        it('gets the account by id', async () => {
            const { status, body } = await call(user1Token, `/accounts/${accountId}`)
            expect(status).toBe(200)
            expect(body.id).toBe(accountId)
        })

        it('updates the account', async () => {
            const { status, body } = await call(user1Token, `/accounts/${accountId}`, {
                method: 'PUT',
                body: JSON.stringify({ name: 'Renamed Checking' }),
            })
            expect(status).toBe(200)
            expect(body.name).toBe('Renamed Checking')
        })

        it('deletes the account and then 404s on it', async () => {
            const del = await call(user1Token, `/accounts/${accountId}`, { method: 'DELETE' })
            expect(del.status).toBe(200)
            createdAccountIds.splice(createdAccountIds.indexOf(accountId), 1)

            const get = await call(user1Token, `/accounts/${accountId}`)
            expect(get.status).toBe(404)
        })
    })

    describe('categories CRUD', () => {
        let categoryId: string

        it('creates a category', async () => {
            const { status, body } = await call(user1Token, '/categories/create', {
                method: 'POST',
                body: JSON.stringify({ name: 'Integration Test Groceries', kind: 'expense' }),
            })
            expect(status).toBe(201)
            categoryId = body.id
            createdCategoryIds.push(categoryId)
        })

        it('lists, gets, updates, and deletes the category', async () => {
            const list = await call(user1Token, '/categories/list')
            expect(list.status).toBe(200)
            expect(list.body.some((c: any) => c.id === categoryId)).toBe(true)

            const get = await call(user1Token, `/categories/${categoryId}`)
            expect(get.status).toBe(200)

            const update = await call(user1Token, `/categories/${categoryId}`, {
                method: 'PUT',
                body: JSON.stringify({ name: 'Renamed Groceries' }),
            })
            expect(update.status).toBe(200)
            expect(update.body.name).toBe('Renamed Groceries')

            const del = await call(user1Token, `/categories/${categoryId}`, { method: 'DELETE' })
            expect(del.status).toBe(200)
            createdCategoryIds.splice(createdCategoryIds.indexOf(categoryId), 1)

            const getAfterDelete = await call(user1Token, `/categories/${categoryId}`)
            expect(getAfterDelete.status).toBe(404)
        })
    })

    describe('transactions CRUD and ownership checks', () => {
        let accountId: string
        let categoryId: string
        let transactionId: string

        beforeAll(async () => {
            const account = await call(user1Token, '/accounts/create', {
                method: 'POST',
                body: JSON.stringify({ name: 'Txn Test Account', type: 'checking' }),
            })
            accountId = account.body.id
            createdAccountIds.push(accountId)

            const category = await call(user1Token, '/categories/create', {
                method: 'POST',
                body: JSON.stringify({ name: 'Txn Test Category', kind: 'expense' }),
            })
            categoryId = category.body.id
            createdCategoryIds.push(categoryId)
        })

        it('rejects a transaction referencing an account that does not exist', async () => {
            const { status } = await call(user1Token, '/transactions/create', {
                method: 'POST',
                body: JSON.stringify({
                    amount: '10.00',
                    accountId: '00000000-0000-0000-0000-000000000000',
                    occurredAt: new Date().toISOString(),
                }),
            })
            expect(status).toBe(404)
        })

        it.skipIf(!hasUser2)('rejects a transaction referencing another user\'s account', async () => {
            const other = await call(user2Token, '/accounts/create', {
                method: 'POST',
                body: JSON.stringify({ name: 'User2 Account', type: 'checking' }),
            })
            expect(other.status).toBe(201)

            const { status } = await call(user1Token, '/transactions/create', {
                method: 'POST',
                body: JSON.stringify({
                    amount: '10.00',
                    accountId: other.body.id,
                    occurredAt: new Date().toISOString(),
                }),
            })
            expect(status).toBe(404)

            await call(user2Token, `/accounts/${other.body.id}`, { method: 'DELETE' })
        })

        it('creates a transaction referencing its own account/category, forcing source to manual', async () => {
            const { status, body } = await call(user1Token, '/transactions/create', {
                method: 'POST',
                body: JSON.stringify({
                    amount: '42.50',
                    accountId,
                    categoryId,
                    description: 'Integration test transaction',
                    occurredAt: new Date().toISOString(),
                    source: 'plaid', // should be ignored server-side
                }),
            })
            expect(status).toBe(201)
            expect(body.source).toBe('manual')
            transactionId = body.id
            createdTransactionIds.push(transactionId)
        })

        it('lists, gets, updates, and deletes the transaction', async () => {
            const list = await call(user1Token, '/transactions/list')
            expect(list.status).toBe(200)
            expect(list.body.some((t: any) => t.id === transactionId)).toBe(true)

            const get = await call(user1Token, `/transactions/${transactionId}`)
            expect(get.status).toBe(200)

            const update = await call(user1Token, `/transactions/${transactionId}`, {
                method: 'PUT',
                body: JSON.stringify({ description: 'Updated description' }),
            })
            expect(update.status).toBe(200)
            expect(update.body.description).toBe('Updated description')

            const del = await call(user1Token, `/transactions/${transactionId}`, { method: 'DELETE' })
            expect(del.status).toBe(200)
            createdTransactionIds.splice(createdTransactionIds.indexOf(transactionId), 1)

            const getAfterDelete = await call(user1Token, `/transactions/${transactionId}`)
            expect(getAfterDelete.status).toBe(404)
        })
    })
})
