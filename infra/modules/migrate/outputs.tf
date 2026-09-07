output "function_name" {
  description = "Name of the migration Lambda (for `aws lambda invoke`/`update-function-code`)"
  value       = aws_lambda_function.migrate.function_name
}
