variable "environment" {
  description = "Environment name, used for resource naming/tagging (e.g. dev, prod)"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs to attach the digest Lambda to"
  type        = list(string)
}

variable "lambda_security_group_id" {
  description = "Security group allowing the digest Lambda to reach RDS and the SQS VPC endpoint"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID the SQS interface endpoint attaches to"
  type        = string
}

variable "db_secret_arn" {
  description = "Secrets Manager ARN holding the RDS master credentials (digest Lambda needs read access)"
  type        = string
}

variable "db_host" {
  description = "RDS endpoint (host:port)"
  type        = string
}

variable "ses_sender_email" {
  description = "Verified SES sender identity the notifications Lambda sends digest emails from"
  type        = string
}
