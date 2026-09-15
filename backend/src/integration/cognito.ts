// Thin wrapper around Cognito's InitiateAuth (USER_PASSWORD_AUTH flow) —
// same call scratch/get-token.sh makes, but returning the IdToken directly
// for use in fetch-based integration tests instead of printing it to stdout.
const REGION = process.env.COGNITO_REGION ?? 'us-east-1'
const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '7jvsv98dk4pd16pdmhpvglnemm'

export async function getIdToken(email: string, password: string): Promise<string> {
    const res = await fetch(`https://cognito-idp.${REGION}.amazonaws.com/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
        },
        body: JSON.stringify({
            ClientId: CLIENT_ID,
            AuthFlow: 'USER_PASSWORD_AUTH',
            AuthParameters: { USERNAME: email, PASSWORD: password },
        }),
    })

    const json = await res.json() as any
    const idToken = json?.AuthenticationResult?.IdToken
    if (!idToken) {
        throw new Error(`Cognito auth failed for ${email}: ${JSON.stringify(json)}`)
    }
    return idToken
}
