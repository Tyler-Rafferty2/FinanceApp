import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Account, Category, Transaction } from '../lib/types'

function todayIso() {
    return new Date().toISOString().slice(0, 10)
}

export function Transactions() {
    const [transactions, setTransactions] = useState<Transaction[]>([])
    const [accounts, setAccounts] = useState<Account[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [amount, setAmount] = useState('')
    const [description, setDescription] = useState('')
    const [accountId, setAccountId] = useState('')
    const [categoryId, setCategoryId] = useState('')
    const [occurredAt, setOccurredAt] = useState(todayIso())

    const [editingId, setEditingId] = useState<string | null>(null)
    const [editAmount, setEditAmount] = useState('')
    const [editDescription, setEditDescription] = useState('')

    async function load() {
        setLoading(true)
        setError(null)
        try {
            const [transactionList, accountList, categoryList] = await Promise.all([
                api.get<Transaction[]>('/transactions/list'),
                api.get<Account[]>('/accounts/list'),
                api.get<Category[]>('/categories/list'),
            ])
            setTransactions(transactionList)
            setAccounts(accountList)
            setCategories(categoryList)
            if (!accountId && accountList.length > 0) setAccountId(accountList[0].id)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load transactions')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault()
        try {
            await api.post('/transactions/create', {
                amount,
                description: description || undefined,
                accountId,
                categoryId: categoryId || undefined,
                occurredAt: new Date(occurredAt).toISOString(),
            })
            setAmount('')
            setDescription('')
            await load()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create transaction')
        }
    }

    async function handleDelete(id: string) {
        try {
            await api.delete(`/transactions/${id}`)
            await load()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete transaction')
        }
    }

    function startEdit(t: Transaction) {
        setEditingId(t.id)
        setEditAmount(t.amount)
        setEditDescription(t.description ?? '')
    }

    async function saveEdit(id: string) {
        try {
            await api.put(`/transactions/${id}`, { amount: editAmount, description: editDescription || undefined })
            setEditingId(null)
            await load()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update transaction')
        }
    }

    function accountName(id: string) {
        return accounts.find((a) => a.id === id)?.name ?? '—'
    }

    function categoryName(id: string | null) {
        if (!id) return '—'
        return categories.find((c) => c.id === id)?.name ?? '—'
    }

    if (loading) return <p>Loading…</p>

    return (
        <div>
            <h1>Transactions</h1>
            {error && <p className="error">{error}</p>}

            <form onSubmit={handleCreate} className="inline-form">
                <input
                    placeholder="Amount (negative = expense)"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                />
                <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                    {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                </select>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">No category</option>
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
                <input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} required />
                <button type="submit" disabled={accounts.length === 0}>Add transaction</button>
            </form>
            {accounts.length === 0 && <p>Add an account first.</p>}

            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Account</th>
                        <th>Category</th>
                        <th>Description</th>
                        <th>Amount</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {transactions.map((t) => (
                        <tr key={t.id}>
                            <td>{new Date(t.occurredAt).toLocaleDateString()}</td>
                            <td>{accountName(t.accountId)}</td>
                            <td>{categoryName(t.categoryId)}</td>
                            <td>
                                {editingId === t.id ? (
                                    <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                                ) : (
                                    t.description ?? '—'
                                )}
                            </td>
                            <td>
                                {editingId === t.id ? (
                                    <input value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                                ) : (
                                    Number(t.amount).toFixed(2)
                                )}
                            </td>
                            <td>
                                {editingId === t.id ? (
                                    <>
                                        <button onClick={() => saveEdit(t.id)}>Save</button>
                                        <button onClick={() => setEditingId(null)}>Cancel</button>
                                    </>
                                ) : (
                                    <>
                                        <button onClick={() => startEdit(t)}>Edit</button>
                                        <button onClick={() => handleDelete(t.id)}>Delete</button>
                                    </>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
