output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.this.id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets (RDS lives here)"
  value       = [for s in aws_subnet.private : s.id]
}

output "lambda_security_group_id" {
  description = "Security group ID to attach to Lambdas that need RDS access"
  value       = aws_security_group.lambda.id
}

output "rds_security_group_id" {
  description = "Security group ID to attach to the RDS instance"
  value       = aws_security_group.rds.id
}
