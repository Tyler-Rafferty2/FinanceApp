data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# --- Plaid API client credentials (client_id/secret, not per-item tokens) ---

resource "aws_secretsmanager_secret" "plaid_credentials" {
  name = "${var.environment}-financeapp-plaid-credentials"
}

resource "aws_secretsmanager_secret_version" "plaid_credentials" {
  secret_id = aws_secretsmanager_secret.plaid_credentials.id
  secret_string = jsonencode({
    client_id = var.plaid_client_id
    secret    = var.plaid_secret
    env       = var.plaid_env
  })
}

# Per-item access token + sync cursor secrets are created/read/updated at
# runtime by plaid-link (create) and plaid-webhook (read/update cursor), not
# by Terraform — one per Plaid Item, named "${environment}-financeapp-plaid-item-<itemId>".
# This keeps the access token out of RDS entirely, reachable from Lambdas
# with no VPC attachment (see infra/modules/network/main.tf for why: Plaid
# isn't a PrivateLink service, so a VPC-attached Lambda calling it would need
# a NAT Gateway; splitting persistence (VPC, RDS) from Plaid API calls
# (non-VPC, Secrets Manager) avoids that cost).
locals {
  plaid_item_secret_arn_pattern = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:${var.environment}-financeapp-plaid-item-*"
}

# --- plaid-events: item_created / transactions_synced -> plaid-persist ---

resource "aws_sqs_queue" "plaid_events" {
  name                       = "${var.environment}-financeapp-plaid-events"
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 10
  visibility_timeout_seconds = 60
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.plaid_events_dlq.arn
    maxReceiveCount     = 4
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "plaid_events_dlq" {
  name = "${var.environment}-financeapp-plaid-events-dlq"
}

resource "aws_sqs_queue_redrive_allow_policy" "plaid_events_dlq_allow" {
  queue_url = aws_sqs_queue.plaid_events_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue",
    sourceQueueArns   = [aws_sqs_queue.plaid_events.arn]
  })
}

resource "aws_cloudwatch_metric_alarm" "plaid_events_dlq_depth" {
  alarm_name          = "${var.environment}-financeapp-plaid-events-dlq-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "plaid-events-dlq has at least one message"

  dimensions = {
    QueueName = aws_sqs_queue.plaid_events_dlq.name
  }
}

# --- plaid-webhook (non-VPC: calls Plaid's public API, no RDS access) ---

resource "aws_iam_role" "plaid_webhook" {
  name = "${var.environment}-financeapp-plaid-webhook-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "plaid_webhook_basic_logs" {
  role       = aws_iam_role.plaid_webhook.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "plaid_webhook_secrets" {
  name = "${var.environment}-financeapp-plaid-webhook-secrets"
  role = aws_iam_role.plaid_webhook.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_secretsmanager_secret.plaid_credentials.arn
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
        ]
        Resource = local.plaid_item_secret_arn_pattern
      }
    ]
  })
}

resource "aws_iam_role_policy" "plaid_webhook_sqs_send" {
  name = "${var.environment}-financeapp-plaid-webhook-sqs-send"
  role = aws_iam_role.plaid_webhook.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "sqs:SendMessage"
      Resource = aws_sqs_queue.plaid_events.arn
    }]
  })
}

resource "aws_lambda_function" "plaid_webhook" {
  function_name = "${var.environment}-financeapp-plaid-webhook-lambda"
  role          = aws_iam_role.plaid_webhook.arn
  handler       = "handler.handler"
  runtime       = "nodejs22.x"
  timeout       = 30

  filename         = "${path.module}/../../../backend/dist/plaid-webhook.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../backend/dist/plaid-webhook.zip")

  environment {
    variables = {
      PLAID_CREDENTIALS_SECRET_ARN = aws_secretsmanager_secret.plaid_credentials.arn
      PLAID_ITEM_SECRET_PREFIX     = "${var.environment}-financeapp-plaid-item-"
      PLAID_EVENTS_QUEUE_URL       = aws_sqs_queue.plaid_events.url
    }
  }
}

# --- plaid-persist (VPC-attached: writes plaid_items/accounts/transactions to RDS) ---

resource "aws_iam_role" "plaid_persist" {
  name = "${var.environment}-financeapp-plaid-persist-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "plaid_persist_basic_logs" {
  role       = aws_iam_role.plaid_persist.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "plaid_persist_vpc_access" {
  role       = aws_iam_role.plaid_persist.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "plaid_persist_sqs_consume" {
  name = "${var.environment}-financeapp-plaid-persist-sqs-consume"
  role = aws_iam_role.plaid_persist.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
      ]
      Resource = aws_sqs_queue.plaid_events.arn
    }]
  })
}

data "aws_secretsmanager_secret_version" "db" {
  secret_id = var.db_secret_arn
}

locals {
  db_creds = jsondecode(data.aws_secretsmanager_secret_version.db.secret_string)
}

resource "aws_lambda_function" "plaid_persist" {
  function_name = "${var.environment}-financeapp-plaid-persist-lambda"
  role          = aws_iam_role.plaid_persist.arn
  handler       = "handler.handler"
  runtime       = "nodejs22.x"
  timeout       = 30

  filename         = "${path.module}/../../../backend/dist/plaid-persist.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../backend/dist/plaid-persist.zip")

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

resource "aws_lambda_event_source_mapping" "plaid_persist_from_queue" {
  event_source_arn = aws_sqs_queue.plaid_events.arn
  function_name    = aws_lambda_function.plaid_persist.arn
  batch_size       = 10

  function_response_types = ["ReportBatchItemFailures"]
}
