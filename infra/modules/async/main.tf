data "aws_region" "current" {}

# --- notification-events: digest -> notifications -> SES ---

resource "aws_sqs_queue" "notification_events" {
  name                       = "${var.environment}-financeapp-notification-events"
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 10
  visibility_timeout_seconds = 60
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.notification_events_dlq.arn
    maxReceiveCount     = 4
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "notification_events_dlq" {
  name = "${var.environment}-financeapp-notification-events-dlq"
}

resource "aws_sqs_queue_redrive_allow_policy" "notification_events_dlq_allow" {
  queue_url = aws_sqs_queue.notification_events_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue",
    sourceQueueArns   = [aws_sqs_queue.notification_events.arn]
  })
}

# --- transaction-events: transactions -> (future consumer) ---
# Kept separate from notification-events since it's a different kind of
# event (per-write, not weekly digest) with no consumer wired up yet.

resource "aws_sqs_queue" "transaction_events" {
  name                       = "${var.environment}-financeapp-transaction-events"
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 10
  visibility_timeout_seconds = 60
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.transaction_events_dlq.arn
    maxReceiveCount     = 4
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "transaction_events_dlq" {
  name = "${var.environment}-financeapp-transaction-events-dlq"
}

resource "aws_sqs_queue_redrive_allow_policy" "transaction_events_dlq_allow" {
  queue_url = aws_sqs_queue.transaction_events_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue",
    sourceQueueArns   = [aws_sqs_queue.transaction_events.arn]
  })
}

# --- VPC interface endpoint for SQS ---
# digest and transactions are VPC-attached (need RDS) and also need to reach
# SQS's public API; a single-AZ interface endpoint (~$7-8/mo) is used here
# instead of a NAT Gateway (~$32/mo), same tradeoff made elsewhere in this repo.

resource "aws_security_group" "sqs" {
  name_prefix = "${var.environment}-financeapp-sqs"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [var.lambda_security_group_id]
  }
}

resource "aws_vpc_endpoint" "sqs" {
  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.sqs"
  vpc_endpoint_type = "Interface"

  subnet_ids = var.private_subnet_ids

  security_group_ids = [
    aws_security_group.sqs.id,
  ]

  private_dns_enabled = true
}

# --- digest Lambda (EventBridge-scheduled) ---

resource "aws_iam_role" "digest" {
  name = "${var.environment}-financeapp-digest-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "digest_basic_logs" {
  role       = aws_iam_role.digest.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "digest_vpc_access" {
  role       = aws_iam_role.digest.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "digest_sqs_send" {
  name = "${var.environment}-financeapp-digest-sqs-send"
  role = aws_iam_role.digest.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "sqs:SendMessage"
      Resource = aws_sqs_queue.notification_events.arn
    }]
  })
}

data "aws_secretsmanager_secret_version" "db" {
  secret_id = var.db_secret_arn
}

locals {
  db_creds = jsondecode(data.aws_secretsmanager_secret_version.db.secret_string)
}

resource "aws_lambda_function" "digest" {
  function_name = "${var.environment}-financeapp-digest-lambda"
  role          = aws_iam_role.digest.arn
  handler       = "handler.handler"
  runtime       = "nodejs22.x"
  timeout       = 30

  filename         = "${path.module}/../../../backend/dist/digest.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../backend/dist/digest.zip")

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = {
      DB_USERNAME            = local.db_creds.username
      DB_PASSWORD            = local.db_creds.password
      DB_HOST                = var.db_host
      NOTIFICATION_QUEUE_URL = aws_sqs_queue.notification_events.url
    }
  }
}

# EventBridge schedule expressions run in UTC. Sunday 20:00 US/Eastern is
# 00:00/01:00 UTC Monday depending on daylight saving — this trips people up.
# Fixed at 01:00 UTC Monday (roughly Sunday evening Eastern) since EventBridge
# schedules can't follow DST automatically.
resource "aws_cloudwatch_event_rule" "digest_weekly" {
  name                = "${var.environment}-financeapp-digest-weekly"
  schedule_expression = "cron(0 1 ? * MON *)"
}

resource "aws_cloudwatch_event_target" "digest_weekly" {
  rule = aws_cloudwatch_event_rule.digest_weekly.name
  arn  = aws_lambda_function.digest.arn
}

resource "aws_lambda_permission" "allow_eventbridge_digest" {
  statement_id  = "AllowEventBridgeInvokeDigest"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.digest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.digest_weekly.arn
}

# --- notifications Lambda (SQS consumer -> SES) ---
# Not VPC-attached: doesn't touch RDS, and attaching it would require routing
# through the SQS VPC endpoint or a NAT gateway to reach SES.

resource "aws_iam_role" "notifications" {
  name = "${var.environment}-financeapp-notifications-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "notifications_basic_logs" {
  role       = aws_iam_role.notifications.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "notifications_sqs_consume" {
  name = "${var.environment}-financeapp-notifications-sqs-consume"
  role = aws_iam_role.notifications.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
      ]
      Resource = aws_sqs_queue.notification_events.arn
    }]
  })
}

resource "aws_iam_role_policy" "notifications_ses_send" {
  name = "${var.environment}-financeapp-notifications-ses-send"
  role = aws_iam_role.notifications.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "ses:SendEmail"
      Resource = "*"
    }]
  })
}

resource "aws_lambda_function" "notifications" {
  function_name = "${var.environment}-financeapp-notifications-lambda"
  role          = aws_iam_role.notifications.arn
  handler       = "handler.handler"
  runtime       = "nodejs22.x"
  timeout       = 30

  filename         = "${path.module}/../../../backend/dist/notifications.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../backend/dist/notifications.zip")

  environment {
    variables = {
      SES_SENDER_EMAIL = var.ses_sender_email
    }
  }
}

resource "aws_lambda_event_source_mapping" "notifications_from_queue" {
  event_source_arn = aws_sqs_queue.notification_events.arn
  function_name    = aws_lambda_function.notifications.arn
  batch_size       = 10

  # Lets the Lambda report which specific messages in a batch failed, so only
  # those get redelivered instead of the whole batch (or none of it).
  function_response_types = ["ReportBatchItemFailures"]
}

# --- DLQ depth alarms (Task 5 / early Phase 7 preview) ---

resource "aws_cloudwatch_metric_alarm" "notification_dlq_depth" {
  alarm_name          = "${var.environment}-financeapp-notification-dlq-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "notification-events-dlq has at least one message"

  dimensions = {
    QueueName = aws_sqs_queue.notification_events_dlq.name
  }
}

resource "aws_cloudwatch_metric_alarm" "transaction_dlq_depth" {
  alarm_name          = "${var.environment}-financeapp-transaction-dlq-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "transaction-events-dlq has at least one message"

  dimensions = {
    QueueName = aws_sqs_queue.transaction_events_dlq.name
  }
}
