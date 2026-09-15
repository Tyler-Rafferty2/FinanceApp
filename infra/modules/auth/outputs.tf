output "user_pool_id" {
  description = "Cognito user pool ID"
  value       = aws_cognito_user_pool.pool.id
}

output "user_pool_client_id" {
  description = "Cognito app client ID"
  value       = aws_cognito_user_pool_client.client.id
}

output "user_pool_arn" {
  description = "Cognito user pool ARN"
  value       = aws_cognito_user_pool.pool.arn
}