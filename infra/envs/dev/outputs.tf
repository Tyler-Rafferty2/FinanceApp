output "db_endpoint" {
  description = "RDS connection endpoint"
  value       = module.database.db_endpoint
}

output "db_secret_arn" {
  description = "Secrets Manager ARN holding the RDS master credentials"
  value       = module.database.db_secret_arn
}

output "user_pool_id" {
  description = "Cognito user pool ID"
  value       = module.auth.user_pool_id
}

output "user_pool_client_id" {
  description = "Cognito app client ID"
  value       = module.auth.user_pool_client_id
}
