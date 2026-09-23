import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const secretsManager = new SecretsManagerClient({})
const sqs = new SQSClient({})

const RELEVANT_WEBHOOK_CODES = new Set([
    "SYNC_UPDATES_AVAILABLE",
    "INITIAL_UPDATE",
    "HISTORICAL_UPDATE",
    "DEFAULT_UPDATE",
])

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

type ItemSecret = { accessToken: string; cursor: string | null; cognitoSub: string };

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body ?? "{}");
    const { webhook_type, webhook_code, item_id } = body;

    if (webhook_type !== "TRANSACTIONS" || !RELEVANT_WEBHOOK_CODES.has(webhook_code)) {
        console.log("ignoring webhook", webhook_type, webhook_code);
        return { statusCode: 200, body: JSON.stringify({ status: "ignored" }) };
    }

    const secretName = `${process.env.PLAID_ITEM_SECRET_PREFIX}${item_id}`;
    const { SecretString } = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretName }));
    const item = JSON.parse(SecretString!) as ItemSecret;

    const plaid = await getPlaidClient();

    let cursor = item.cursor ?? undefined;
    let hasMore = true;
    const added: unknown[] = [];
    const modified: unknown[] = [];
    const removed: unknown[] = [];

    while (hasMore) {
        const response = await plaid.transactionsSync({
            access_token: item.accessToken,
            cursor,
        });
        added.push(...response.data.added);
        modified.push(...response.data.modified);
        removed.push(...response.data.removed);
        hasMore = response.data.has_more;
        cursor = response.data.next_cursor;
    }

    await secretsManager.send(new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: JSON.stringify({ ...item, cursor }),
    }));

    if (added.length || modified.length || removed.length) {
        await sqs.send(new SendMessageCommand({
            QueueUrl: process.env.PLAID_EVENTS_QUEUE_URL!,
            MessageBody: JSON.stringify({
                type: "transactions_synced",
                cognitoSub: item.cognitoSub,
                plaidItemId: item_id,
                added,
                modified,
                removed,
            }),
        }));
    }

    console.log(`synced item ${item_id}: +${added.length} ~${modified.length} -${removed.length}`);
    return { statusCode: 200, body: JSON.stringify({ status: "ok" }) };
}
