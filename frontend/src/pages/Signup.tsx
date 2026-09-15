import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as auth from '../lib/auth'

export function Signup() {
    const navigate = useNavigate()
    const [email, setEmail] = useState('')
    const [name, setName] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setLoading(true)
        try {
            await auth.signUp(email, password, name)
            navigate('/confirm', { state: { email } })
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Sign up failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="auth-form">
            <h1>Sign up</h1>
            <form onSubmit={handleSubmit}>
                <label>
                    Name
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
                </label>
                <label>
                    Email
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <label>
                    Password
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </label>
                {error && <p className="error">{error}</p>}
                <button type="submit" disabled={loading}>{loading ? 'Signing up…' : 'Sign up'}</button>
            </form>
        </div>
    )
}
