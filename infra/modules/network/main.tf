# Network module — VPC, subnets, security groups.
#
# Private-subnets-only: nothing in this design needs a public IP inside the
# VPC (CloudFront/S3/API Gateway are all outside the VPC entirely). No IGW,
# no NAT Gateway, no public subnets. Phase 3/5 Lambdas that need RDS *and*
# an outbound AWS API (SQS) will use a VPC interface endpoint instead of NAT
# — see the spec's "Networking note" under Async/Event-Driven Flow.
#
# Resources to add here (Phase 1, per docs/superpowers/specs/2026-09-08-financeapp-design.md):
#   - aws_vpc.this
#   - aws_subnet.private (one per AZ)  — RDS goes here
#   - aws_security_group.rds     — allow 5432 inbound only from lambda_security_group_id
#   - aws_security_group.lambda  — Lambdas that need to reach RDS get attached to this
#
# Wire the outputs in outputs.tf as you create each resource.

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "${var.environment}-financeapp-vpc"
    Environment = var.environment
  }
}

resource "aws_subnet" "private" {
  for_each          = toset(var.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, index(var.azs, each.value))
  availability_zone = each.value

  tags = {
    Name        = "${var.environment}-financeapp-private-${each.value}"
    Environment = var.environment
  }
}

resource "aws_security_group" "lambda" {
  name_prefix = "${var.environment}-financeapp-lambda-"
  vpc_id      = aws_vpc.this.id
  description = "Attached to Lambdas that need to reach RDS"

  # No ingress rules — Lambda ENIs don't receive inbound traffic.
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.environment}-financeapp-lambda-sg"
    Environment = var.environment
  }
}

resource "aws_security_group" "rds" {
  name_prefix = "${var.environment}-financeapp-rds-"
  vpc_id      = aws_vpc.this.id
  description = "Allows Postgres access only from the Lambda security group"

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  tags = {
    Name        = "${var.environment}-financeapp-rds-sg"
    Environment = var.environment
  }
}
