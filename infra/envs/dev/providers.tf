terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local state to start. Once Phase 1 works end-to-end, migrate to an S3
  # backend (with a DynamoDB lock table) as a deliberate follow-up exercise:
  #
  #   backend "s3" {
  #     bucket         = "<unique-bucket-name>"
  #     key            = "dev/terraform.tfstate"
  #     region         = "us-east-1"
  #     dynamodb_table = "terraform-locks"
  #     encrypt        = true
  #   }
  #
  # The bucket + lock table must exist before this backend can be used —
  # create those two resources first (console, or a one-off local-state
  # apply), then `terraform init -migrate-state`.
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}
