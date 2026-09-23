output "plaid_credentials_secret_arn" {
  value = aws_secretsmanager_secret.plaid_credentials.arn
}

output "plaid_events_queue_url" {
  value = aws_sqs_queue.plaid_events.url
}

output "plaid_events_queue_arn" {
  value = aws_sqs_queue.plaid_events.arn
}

output "plaid_item_secret_arn_pattern" {
  value = local.plaid_item_secret_arn_pattern
}

output "plaid_webhook_invoke_arn" {
  value = aws_lambda_function.plaid_webhook.invoke_arn
}

output "plaid_webhook_function_name" {
  value = aws_lambda_function.plaid_webhook.function_name
}
