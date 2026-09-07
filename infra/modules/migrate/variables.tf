variable "private_subnet_ids" {
  description = "Private subnet IDs to attach the migration Lambda to"
  type        = list(string)
}

variable "lambda_security_group_id" {
  description = "Security group allowing this Lambda to reach RDS"
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

variable "environment" {
  description = "Environment name, used for resource naming/tagging"
  type        = string
}
