export type AccountType = 'checking' | 'savings' | 'credit_card' | 'cash' | 'investment'
export type CategoryKind = 'income' | 'expense'

export type Account = {
    id: string
    userId: string
    type: AccountType
    institution: string | null
    name: string
    createdAt: string
}

export type Category = {
    id: string
    userId: string
    kind: CategoryKind
    name: string
    createdAt: string
}

export type Transaction = {
    id: string
    userId: string
    accountId: string
    categoryId: string | null
    amount: string
    description: string | null
    occurredAt: string
    source: 'manual' | 'plaid'
    createdAt: string
}
