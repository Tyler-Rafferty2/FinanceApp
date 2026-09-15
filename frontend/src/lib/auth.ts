import * as cognito from './cognito'
import { saveSession, loadSession, clearSession, isExpired } from './session'

export async function signUp(email: string, password: string, name: string) {
    await cognito.signUp(email, password, name)
}

export async function confirmSignUp(email: string, code: string) {
    await cognito.confirmSignUp(email, code)
}

export async function login(email: string, password: string) {
    const result = await cognito.login(email, password)
    saveSession(result.IdToken, result.RefreshToken ?? null, result.ExpiresIn)
}

export function logout() {
    clearSession()
}

export function isLoggedIn() {
    return loadSession() !== null
}

// Returns a currently-valid ID token, refreshing it first if it's expired.
// Throws if there's no session or the refresh fails — callers (the API
// client) treat that as "not logged in" and send the user to /login.
export async function getValidIdToken(): Promise<string> {
    const session = loadSession()
    if (!session) throw new Error('Not logged in')

    if (!isExpired(session)) return session.idToken

    if (!session.refreshToken) {
        clearSession()
        throw new Error('Session expired')
    }

    try {
        const result = await cognito.refresh(session.refreshToken)
        saveSession(result.IdToken, session.refreshToken, result.ExpiresIn)
        return result.IdToken
    } catch (err) {
        clearSession()
        throw err
    }
}
