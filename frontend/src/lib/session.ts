// Token storage. localStorage (not memory-only) so a page refresh doesn't
// force a re-login — acceptable tradeoff for a personal-use app; an XSS bug
// could exfiltrate the token either way since there's no HttpOnly-cookie
// option available to a static S3/CloudFront site without a backend to set one.
const ID_TOKEN_KEY = 'financeapp.idToken'
const REFRESH_TOKEN_KEY = 'financeapp.refreshToken'
const EXPIRES_AT_KEY = 'financeapp.expiresAt'

export type Session = {
    idToken: string
    refreshToken: string | null
    expiresAt: number
}

export function saveSession(idToken: string, refreshToken: string | null, expiresInSeconds: number) {
    const expiresAt = Date.now() + expiresInSeconds * 1000
    localStorage.setItem(ID_TOKEN_KEY, idToken)
    localStorage.setItem(EXPIRES_AT_KEY, String(expiresAt))
    if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function loadSession(): Session | null {
    const idToken = localStorage.getItem(ID_TOKEN_KEY)
    const expiresAt = localStorage.getItem(EXPIRES_AT_KEY)
    if (!idToken || !expiresAt) return null

    return {
        idToken,
        refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
        expiresAt: Number(expiresAt),
    }
}

export function clearSession() {
    localStorage.removeItem(ID_TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(EXPIRES_AT_KEY)
}

export function isExpired(session: Session) {
    return Date.now() >= session.expiresAt
}
