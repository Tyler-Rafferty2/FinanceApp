import { API_URL } from './config'
import { getValidIdToken } from './auth'

export class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
        super(message)
        this.status = status
    }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    let token: string
    try {
        token = await getValidIdToken()
    } catch {
        window.location.assign('/login')
        throw new ApiError(401, 'Not logged in')
    }

    const res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Authorization: token,
            ...options.headers,
        },
    })

    if (res.status === 401) {
        window.location.assign('/login')
        throw new ApiError(401, 'Unauthorized')
    }

    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new ApiError(res.status, body.error ?? body.message ?? `Request failed (${res.status})`)
    }

    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
}

export const api = {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
        request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) =>
        request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
