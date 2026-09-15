import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { ConfirmSignup } from './pages/ConfirmSignup'
import { Accounts } from './pages/Accounts'
import { Categories } from './pages/Categories'
import { Transactions } from './pages/Transactions'

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />
                    <Route path="/confirm" element={<ConfirmSignup />} />

                    <Route element={<ProtectedRoute />}>
                        <Route element={<Layout />}>
                            <Route path="/accounts" element={<Accounts />} />
                            <Route path="/categories" element={<Categories />} />
                            <Route path="/transactions" element={<Transactions />} />
                        </Route>
                    </Route>

                    <Route path="*" element={<Navigate to="/accounts" replace />} />
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    )
}

export default App
