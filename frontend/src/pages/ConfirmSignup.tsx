import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as auth from '../lib/auth'

export function ConfirmSignup() {
    const navigate = useNavigate()
    const location = useLocation()
    const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '')
    const [code, setCode] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setLoading(true)
        try {
            await auth.confirmSignUp(email, code)
            navigate('/login')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Confirmation failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="auth-form">
            <h1>Confirm your email</h1>
            <p>Enter the code we emailed you.</p>
            <form onSubmit={handleSubmit}>
                <label>
                    Email
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <label>
                    Code
                    <input type="text" value={code} onChange={(e) => setCode(e.target.value)} required />
                </label>
                {error && <p className="error">{error}</p>}
                <button type="submit" disabled={loading}>{loading ? 'Confirming…' : 'Confirm'}</button>
            </form>
        </div>
    )
}
