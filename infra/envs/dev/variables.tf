variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "Named AWS CLI profile Terraform should use (see ~/.aws/credentials)"
  type        = string
  default     = "scheduler"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "azs" {
  description = "Availability zones to spread subnets across"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "frontend_origin" {
  description = "Origin allowed to call the API via CORS. Defaults to \"*\" until the CloudFront URL exists (Phase 4 Task 4), then tighten it to that URL."
  type        = string
  default     = "*"
}

variable "ses_sender_email" {
  description = "Verified SES sender identity the notifications Lambda sends weekly digest emails from. Must be verified in the SES console/CLI before apply."
  type        = string
}

variable "plaid_client_id" {
  description = "Plaid client_id (from the Plaid dashboard)"
  type        = string
  sensitive   = true
}

variable "plaid_secret" {
  description = "Plaid Sandbox secret (from the Plaid dashboard)"
  type        = string
  sensitive   = true
}

variable "plaid_env" {
  description = "Plaid API environment"
  type        = string
  default     = "sandbox"
}
