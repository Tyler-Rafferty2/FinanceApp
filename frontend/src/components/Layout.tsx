import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

export function Layout() {
    const { logout } = useAuth()

    return (
        <div>
            <nav className="nav">
                <NavLink to="/accounts">Accounts</NavLink>
                <NavLink to="/categories">Categories</NavLink>
                <NavLink to="/transactions">Transactions</NavLink>
                <button onClick={logout}>Log out</button>
            </nav>
            <main className="main">
                <Outlet />
            </main>
        </div>
    )
}
