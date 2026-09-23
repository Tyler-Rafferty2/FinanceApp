variable "environment" {
  description = "Environment name, used for resource naming/tagging (e.g. dev, prod)"
  type        = string
}

variable "cognito_user_pool_arn" {
  description = "ARN of the Cognito user pool the authorizer validates tokens against"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs to attach the post-confirmation Lambda to"
  type        = list(string)
}

variable "lambda_security_group_id" {
  description = "Security group allowing the post-confirmation Lambda to reach RDS"
  type        = string
}

variable "db_secret_arn" {
  description = "Secrets Manager ARN holding the RDS master credentials"
  type        = string
}

variable "db_host" {
  description = "RDS endpoint (host:port)"
  type        = string
}

variable "frontend_origin" {
  description = "Origin allowed to call the API via CORS (e.g. the CloudFront URL). \"*\" is fine here since auth uses a Bearer token, not cookies."
  type        = string
  default     = "*"
}

variable "transaction_events_queue_url" {
  description = "URL of the async module's transaction-events queue, for the transactions Lambda to enqueue writes onto"
  type        = string
}

variable "transaction_events_queue_arn" {
  description = "ARN of the async module's transaction-events queue, scoped for the transactions Lambda's sqs:SendMessage permission"
  type        = string
}

variable "plaid_credentials_secret_arn" {
  description = "Secrets Manager ARN holding the Plaid client_id/secret, for plaid-link to call Plaid's API"
  type        = string
}

variable "plaid_events_queue_url" {
  description = "URL of the plaid module's plaid-events queue, for plaid-link to enqueue item_created messages"
  type        = string
}

variable "plaid_events_queue_arn" {
  description = "ARN of the plaid module's plaid-events queue"
  type        = string
}

variable "plaid_webhook_invoke_arn" {
  description = "Invoke ARN of the plaid module's plaid-webhook Lambda"
  type        = string
}

variable "plaid_webhook_function_name" {
  description = "Function name of the plaid module's plaid-webhook Lambda"
  type        = string
}