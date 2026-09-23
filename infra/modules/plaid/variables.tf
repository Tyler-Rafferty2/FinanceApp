variable "environment" {
  description = "Environment name, used for resource naming/tagging (e.g. dev, prod)"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs to attach the plaid-persist Lambda to"
  type        = list(string)
}

variable "lambda_security_group_id" {
  description = "Security group allowing the plaid-persist Lambda to reach RDS"
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

variable "plaid_client_id" {
  description = "Plaid client_id (Sandbox)"
  type        = string
  sensitive   = true
}

variable "plaid_secret" {
  description = "Plaid Sandbox secret"
  type        = string
  sensitive   = true
}

variable "plaid_env" {
  description = "Plaid API environment (sandbox/development/production)"
  type        = string
  default     = "sandbox"
}
