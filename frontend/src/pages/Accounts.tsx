import { useEffect, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { api } from '../lib/api'
import type { Account, AccountType, Transaction } from '../lib/types'

const ACCOUNT_TYPES: AccountType[] = ['checking', 'savings', 'credit_card', 'cash', 'investment']

function ConnectBankButton({ onLinked }: { onLinked: () => void }) {
    const [linkToken, setLinkToken] = useState<string | null>(null)
    const [linking, setLinking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        api.post<{ linkToken: string }>('/plaid/link-token', {})
            .then((res) => setLinkToken(res.linkToken))
            .catch((err) => setError(err instanceof Error ? err.message : 'Failed to start Plaid Link'))
    }, [])

    const { open, ready } = usePlaidLink({
        token: linkToken,
        onSuccess: async (publicToken, metadata) => {
            setLinking(true)
            setError(null)
            try {
                await api.post('/plaid/exchange', {
                    publicToken,
                    institutionName: metadata.institution?.name,
                })
                onLinked()
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to link account')
            } finally {
                setLinking(false)
            }
        },
    })

    return (
        <div>
            <button onClick={() => open()} disabled={!ready || linking}>
                {linking ? 'Linking…' : 'Connect a bank (Sandbox)'}
            </button>
            {error && <p className="error">{error}</p>}
        </div>
    )
}

function computeBalances(transactions: Transaction[]): Record<string, number> {
    const balances: Record<string, number> = {}
    for (const t of transactions) {
        balances[t.accountId] = (balances[t.accountId] ?? 0) + Number(t.amount)
    }
    return balances
}

export function Accounts() {
    const [accounts, setAccounts] = useState<Account[]>([])
    const [balances, setBalances] = useState<Record<string, number>>({})
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [name, setName] = useState('')
    const [type, setType] = useState<AccountType>('checking')
    const [institution, setInstitution] = useState('')

    const [editingId, setEditingId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')

    async function load() {
        setLoading(true)
        setError(null)
        try {
            const [accountList, transactionList] = await Promise.all([
                api.get<Account[]>('/accounts/list'),
                api.get<Transaction[]>('/transactions/list'),
            ])
            setAccounts(accountList)
            setBalances(computeBalances(transactionList))
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load accounts')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
    }, [])

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault()
        try {
            await api.post('/accounts/create', { name, type, institution: institution || undefined })
            setName('')
            setInstitution('')
            await load()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create account')
        }
    }

    async function handleDelete(id: string) {
        try {
            await api.delete(`/accounts/${id}`)
            await load()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete account')
        }
    }

    function startEdit(account: Account) {
        setEditingId(account.id)
        setEditName(account.name)
    }

    async function saveEdit(id: string) {
        try {
            await api.put(`/accounts/${id}`, { name: editName })
            setEditingId(null)
            await load()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update account')
        }
    }

    if (loading) return <p>Loading…</p>

    return (
        <div>
            <h1>Accounts</h1>
            {error && <p className="error">{error}</p>}

            <ConnectBankButton onLinked={load} />

            <form onSubmit={handleCreate} className="inline-form">
                <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
                <select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                    {ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                    ))}
                </select>
                <input placeholder="Institution (optional)" value={institution} onChange={(e) => setInstitution(e.target.value)} />
                <button type="submit">Add account</button>
            </form>

            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Institution</th>
                        <th>Balance</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {accounts.map((account) => (
                        <tr key={account.id}>
                            <td>
                                {editingId === account.id ? (
                                    <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                                ) : (
                                    account.name
                                )}
                            </td>
                            <td>{account.type}</td>
                            <td>{account.institution ?? '—'}</td>
                            <td>{(balances[account.id] ?? 0).toFixed(2)}</td>
                            <td>
                                {editingId === account.id ? (
                                    <>
                                        <button onClick={() => saveEdit(account.id)}>Save</button>
                                        <button onClick={() => setEditingId(null)}>Cancel</button>
                                    </>
                                ) : (
                                    <>
                                        <button onClick={() => startEdit(account)}>Edit</button>
                                        <button onClick={() => handleDelete(account.id)}>Delete</button>
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
