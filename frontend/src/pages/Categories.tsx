import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Category, CategoryKind } from '../lib/types'

export function Categories() {
    const [categories, setCategories] = useState<Category[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [name, setName] = useState('')
    const [kind, setKind] = useState<CategoryKind>('expense')

    const [editingId, setEditingId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')

    async function load() {
        setLoading(true)
        setError(null)
        try {
            setCategories(await api.get<Category[]>('/categories/list'))
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load categories')
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
            await api.post('/categories/create', { name, kind })
            setName('')
            await load()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create category')
        }
    }

    async function handleDelete(id: string) {
        try {
            await api.delete(`/categories/${id}`)
            await load()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete category')
        }
    }

    function startEdit(category: Category) {
        setEditingId(category.id)
        setEditName(category.name)
    }

    async function saveEdit(id: string) {
        try {
            await api.put(`/categories/${id}`, { name: editName })
            setEditingId(null)
            await load()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update category')
        }
    }

    if (loading) return <p>Loading…</p>

    return (
        <div>
            <h1>Categories</h1>
            {error && <p className="error">{error}</p>}

            <form onSubmit={handleCreate} className="inline-form">
                <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
                <select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
                    <option value="expense">expense</option>
                    <option value="income">income</option>
                </select>
                <button type="submit">Add category</button>
            </form>

            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Kind</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {categories.map((category) => (
                        <tr key={category.id}>
                            <td>
                                {editingId === category.id ? (
                                    <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                                ) : (
                                    category.name
                                )}
                            </td>
                            <td>{category.kind}</td>
                            <td>
                                {editingId === category.id ? (
                                    <>
                                        <button onClick={() => saveEdit(category.id)}>Save</button>
                                        <button onClick={() => setEditingId(null)}>Cancel</button>
                                    </>
                                ) : (
                                    <>
                                        <button onClick={() => startEdit(category)}>Edit</button>
                                        <button onClick={() => handleDelete(category.id)}>Delete</button>
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
