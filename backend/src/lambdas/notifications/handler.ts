import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({});

type DigestCategory = { categoryName: string; kind: string; total: string };
type DigestMessage = {
    type: "digest";
    userId: string;
    email: string;
    weekStart: string;
    weekEnd: string;
    categories: DigestCategory[];
};

function buildDigestEmail(message: DigestMessage): { subject: string; body: string } {
    const weekStart = new Date(message.weekStart).toLocaleDateString();
    const weekEnd = new Date(message.weekEnd).toLocaleDateString();

    const lines = message.categories
        .sort((a, b) => Number(b.total) - Number(a.total))
        .map((c) => `  ${c.categoryName} (${c.kind}): $${c.total}`);

    const body = [
        `Your spending summary for ${weekStart} - ${weekEnd}:`,
        "",
        ...lines,
    ].join("\n");

    return { subject: `FinanceApp weekly digest: ${weekStart} - ${weekEnd}`, body };
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

    for (const record of event.Records) {
        try {
            const message = JSON.parse(record.body) as DigestMessage;

            if (message.type !== "digest") {
                console.log("skipping unrecognized message type", message.type);
                continue;
            }

            const { subject, body } = buildDigestEmail(message);

            await ses.send(
                new SendEmailCommand({
                    Source: process.env.SES_SENDER_EMAIL!,
                    Destination: { ToAddresses: [message.email] },
                    Message: {
                        Subject: { Data: subject },
                        Body: { Text: { Data: body } },
                    },
                })
            );
        } catch (err) {
            console.error("failed to process message", record.messageId, err);
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }

    return { batchItemFailures };
}
