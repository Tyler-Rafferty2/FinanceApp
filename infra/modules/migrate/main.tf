# One-off/reusable migration runner — a VPC-attached Lambda that applies
# the Drizzle-generated SQL migrations in backend/drizzle/ to RDS. Invoked
# manually via `aws lambda invoke` after each `npx drizzle-kit generate`.
#
# The Lambda has no internet path (private subnets, no NAT/VPC endpoint),
# so it can't call Secrets Manager itself at runtime. Instead, Terraform
# (running from a machine that does have internet access) fetches the DB
# credentials at apply time and passes them in as plain env vars. Trade-off:
# the password ends up in Terraform state (local, gitignored) and visible
# via `lambda get-function-configuration` — acceptable for a solo sandbox,
# not a pattern to carry into a real multi-person/production account.
data "aws_secretsmanager_secret_version" "db" {
  secret_id = var.db_secret_arn
}

locals {
  db_creds = jsondecode(data.aws_secretsmanager_secret_version.db.secret_string)
}

resource "aws_iam_role" "migrate" {
  name = "${var.environment}-scheduler-migrate-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "basic_logs" {
  role       = aws_iam_role.migrate.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "vpc_access" {
  role       = aws_iam_role.migrate.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_lambda_function" "migrate" {
  function_name = "${var.environment}-scheduler-migrate"
  role          = aws_iam_role.migrate.arn
  handler       = "handler.handler"
  runtime       = "nodejs20.x"
  timeout       = 60

  filename         = "${path.module}/../../../backend/dist/migrate.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../backend/dist/migrate.zip")

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = {
      DB_USERNAME = local.db_creds.username
      DB_PASSWORD = local.db_creds.password
      DB_HOST     = var.db_host
    }
  }
}
