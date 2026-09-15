import { createContext, useContext, useState, type ReactNode } from 'react'
import * as auth from './auth'

type AuthContextValue = {
    isLoggedIn: boolean
    login: (email: string, password: string) => Promise<void>
    logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
    const [isLoggedIn, setIsLoggedIn] = useState(auth.isLoggedIn())

    async function login(email: string, password: string) {
        await auth.login(email, password)
        setIsLoggedIn(true)
    }

    function logout() {
        auth.logout()
        setIsLoggedIn(false)
    }

    return (
        <AuthContext.Provider value={{ isLoggedIn, login, logout }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used within AuthProvider')
    return ctx
}
