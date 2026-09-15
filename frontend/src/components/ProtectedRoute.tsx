import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

export function ProtectedRoute() {
    const { isLoggedIn } = useAuth()
    if (!isLoggedIn) return <Navigate to="/login" replace />
    return <Outlet />
}
