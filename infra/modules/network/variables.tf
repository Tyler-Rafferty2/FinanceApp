variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
}

variable "azs" {
  description = "Availability zones to spread subnets across"
  type        = list(string)
}

variable "environment" {
  description = "Environment name, used for resource naming/tagging (e.g. dev, prod)"
  type        = string
}
