variable "private_subnet_ids" {
  description = "Private subnet IDs for the RDS subnet group"
  type        = list(string)
}

variable "rds_security_group_id" {
  description = "Security group to attach to the RDS instance (created in the network module)"
  type        = string
}

variable "instance_class" {
  description = "RDS instance class (keep free-tier eligible, e.g. db.t3.micro / db.t4g.micro)"
  type        = string
  default     = "db.t3.micro"
}

variable "db_name" {
  description = "Initial database name"
  type        = string
  default     = "financeapp"
}

variable "environment" {
  description = "Environment name, used for resource naming/tagging"
  type        = string
}
