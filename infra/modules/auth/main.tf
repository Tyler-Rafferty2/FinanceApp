data "aws_secretsmanager_secret_version" "db" {
  secret_id = var.db_secret_arn
}

locals {
  db_creds = jsondecode(data.aws_secretsmanager_secret_version.db.secret_string)
}

resource "aws_iam_role" "post_confirmation" {
  name = "${var.environment}-financeapp-post-confirmation-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "post_confirmation_basic_logs" {
  role       = aws_iam_role.post_confirmation.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "post_confirmation_vpc_access" {
  role       = aws_iam_role.post_confirmation.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_lambda_function" "post_confirmation" {
  function_name = "${var.environment}-financeapp-post-confirmation"
  role          = aws_iam_role.post_confirmation.arn
  handler       = "handler.handler"
  runtime       = "nodejs20.x"
  timeout       = 10

  filename         = "${path.module}/../../../backend/dist/post-confirmation.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../backend/dist/post-confirmation.zip")

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

resource "aws_lambda_permission" "allow_cognito" {
  statement_id  = "AllowCognitoInvokePostConfirmation"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.post_confirmation.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.pool.arn
}

resource "aws_cognito_user_pool" "pool" {
    name = "${var.environment}-financeapp-user-pool"

    username_attributes = ["email"]


    auto_verified_attributes = ["email"]

    password_policy {
        minimum_length = 8
        require_uppercase = true
        require_lowercase = true
        require_numbers = true
        require_symbols = true
    }

    verification_message_template {
      default_email_option = "CONFIRM_WITH_CODE"
      email_subject        = "FinanceApp Email Verification"
      email_message        = "Your verification code is {####}"
    }

     schema {
        name                = "name"
        attribute_data_type = "String"
        required             = true
        mutable              = true
    }

    lambda_config {
      post_confirmation = aws_lambda_function.post_confirmation.arn
    }
}

resource "aws_cognito_user_pool_client" "client" {
  name = "${var.environment}-financeapp-user-pool-client"

  user_pool_id = aws_cognito_user_pool.pool.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]
}