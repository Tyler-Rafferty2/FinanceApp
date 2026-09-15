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