import type { APIGatewayProxyEvent } from "aws-lambda";
import { Hono, Context } from 'hono'
import type { LambdaEvent, LambdaContext } from 'hono/aws-lambda'
import { handle } from 'hono/aws-lambda'
import { cors } from 'hono/cors'
import { HTTPException } from "hono/http-exception";
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode, AccountBase } from "plaid";
import { SecretsManagerClient, GetSecretValueCommand, CreateSecretCommand } from "@aws-sdk/client-secrets-manager";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

type Bindings = {
    event: LambdaEvent
    lambdaContext: LambdaContext
}

const app = new Hono<{ Bindings: Bindings }>().basePath('/plaid')

app.use('*', cors({ origin: process.env.ALLOWED_ORIGIN ?? '*' }))

const secretsManager = new SecretsManagerClient({})
const sqs = new SQSClient({})

let plaidClientPromise: Promise<PlaidApi> | null = null;
function getPlaidClient(): Promise<PlaidApi> {
    if (!plaidClientPromise) {
        plaidClientPromise = (async () => {
            const { SecretString } = await secretsManager.send(
                new GetSecretValueCommand({ SecretId: process.env.PLAID_CREDENTIALS_SECRET_ARN! })
            );
            const creds = JSON.parse(SecretString!) as { client_id: string; secret: string; env: string };

            const configuration = new Configuration({
                basePath: PlaidEnvironments[creds.env],
                baseOptions: {
                    headers: {
                        "PLAID-CLIENT-ID": creds.client_id,
                        "PLAID-SECRET": creds.secret,
                    },
                },
            });
            return new PlaidApi(configuration);
        })();
    }
    return plaidClientPromise;
}

// This Lambda isn't VPC-attached (it calls Plaid's public API), so it can't
// reach RDS to resolve our internal users.id — it works off the Cognito
// `sub` claim directly and lets plaid-persist (which does have RDS access)
// resolve that to a users row.
function cognitoSub(c: Context<{ Bindings: Bindings }>): string {
    const event = c.env.event as unknown as APIGatewayProxyEvent
    const claims = event.requestContext.authorizer?.claims
    if (!claims?.sub) throw new HTTPException(401, { message: "Unauthorized" })
    return claims.sub
}

app.post('/link-token', async (c) => {
    const sub = cognitoSub(c)
    const plaid = await getPlaidClient()

    const response = await plaid.linkTokenCreate({
        user: { client_user_id: sub },
        client_name: "FinanceApp",
        products: [Products.Transactions],
        country_codes: [CountryCode.Us],
        language: "en",
        webhook: process.env.PLAID_WEBHOOK_URL,
    })

    return c.json({ linkToken: response.data.link_token })
})

function mapAccountType(account: AccountBase): "checking" | "savings" | "credit_card" | "cash" | "investment" {
    if (account.type === "credit") return "credit_card"
    if (account.type === "investment") return "investment"
    if (account.type === "depository" && account.subtype === "savings") return "savings"
    if (account.type === "depository") return "checking"
    return "cash"
}

const exchangeSchema = z.object({
    publicToken: z.string().min(1),
    institutionName: z.string().optional(),
})

app.post('/exchange', zValidator('json', exchangeSchema), async (c) => {
    const sub = cognitoSub(c)
    const body = c.req.valid('json')
    const plaid = await getPlaidClient()

    const exchangeResponse = await plaid.itemPublicTokenExchange({ public_token: body.publicToken })
    const { access_token, item_id } = exchangeResponse.data

    const accountsResponse = await plaid.accountsGet({ access_token })

    // Access token + sync cursor live here, not RDS — see
    // infra/modules/plaid/main.tf for why. cognitoSub travels with it since
    // plaid-webhook (which reads this secret) has no RDS access either.
    await secretsManager.send(new CreateSecretCommand({
        Name: `${process.env.PLAID_ITEM_SECRET_PREFIX}${item_id}`,
        SecretString: JSON.stringify({ accessToken: access_token, cursor: null, cognitoSub: sub }),
    }))

    await sqs.send(new SendMessageCommand({
        QueueUrl: process.env.PLAID_EVENTS_QUEUE_URL!,
        MessageBody: JSON.stringify({
            type: "item_created",
            cognitoSub: sub,
            plaidItemId: item_id,
            institutionName: body.institutionName ?? null,
            accounts: accountsResponse.data.accounts.map((account) => ({
                plaidAccountId: account.account_id,
                name: account.name,
                type: mapAccountType(account),
            })),
        }),
    }))

    return c.json({ success: true })
})

app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    console.error(err)
    return c.json({ error: "internal error" }, 500)
})

export { app }
export const handler = handle(app)
