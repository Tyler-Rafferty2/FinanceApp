// Direct calls to the Cognito Identity Provider API — same pattern as
// scratch/get-token.sh, just from the browser instead of curl. No Amplify
// dependency; this is a thin enough surface (signup/confirm/login/refresh)
// that hand-rolling it keeps the dependency list small.
import { COGNITO_REGION, COGNITO_CLIENT_ID } from './config'

const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`

async function cognitoRequest<T>(target: string, body: object): Promise<T> {
    const res = await fetch(COGNITO_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
        },
        body: JSON.stringify(body),
    })

    // Some actions (e.g. ConfirmSignUp) return a genuinely empty body on
    // success — res.json() throws on that, so parse text ourselves.
    const text = await res.text()
    const data = text ? JSON.parse(text) : {}
    if (!res.ok) {
        throw new Error(data.message ?? data.__type ?? 'Cognito request failed')
    }
    return data as T
}

export function signUp(email: string, password: string, name: string) {
    return cognitoRequest('SignUp', {
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        Password: password,
        UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'name', Value: name },
        ],
    })
}

export function confirmSignUp(email: string, code: string) {
    return cognitoRequest('ConfirmSignUp', {
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        ConfirmationCode: code,
    })
}

type AuthResult = {
    AuthenticationResult: {
        IdToken: string
        AccessToken: string
        RefreshToken?: string
        ExpiresIn: number
    }
}

export async function login(email: string, password: string) {
    const data = await cognitoRequest<AuthResult>('InitiateAuth', {
        ClientId: COGNITO_CLIENT_ID,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: password },
    })
    return data.AuthenticationResult
}

export async function refresh(refreshToken: string) {
    const data = await cognitoRequest<AuthResult>('InitiateAuth', {
        ClientId: COGNITO_CLIENT_ID,
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: { REFRESH_TOKEN: refreshToken },
    })
    return data.AuthenticationResult
}
