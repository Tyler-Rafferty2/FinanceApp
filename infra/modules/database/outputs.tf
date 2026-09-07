output "db_endpoint" {
  description = "RDS connection endpoint (host:port)"
  value       = aws_db_instance.this.endpoint
}

output "db_name" {
  description = "Database name"
  value       = var.db_name
}

output "db_secret_arn" {
  description = "Secrets Manager ARN holding the master credentials (if using manage_master_user_password)"
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}
