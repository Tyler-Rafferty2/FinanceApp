output "db_endpoint" {
  description = "RDS connection endpoint"
  value       = module.database.db_endpoint
}

output "db_secret_arn" {
  description = "Secrets Manager ARN holding the RDS master credentials"
  value       = module.database.db_secret_arn
}
