resource "aws_api_gateway_rest_api" "api_gateway" {
  name = "${var.environment}-financeapp-api-gateway"
}

data "aws_region" "current" {}

# Built from the REST API id directly (not aws_api_gateway_stage.invoke_url)
# to avoid a dependency cycle: plaid_link needs this to tell Plaid where to
# send webhooks, but the stage depends on the deployment, which depends on
# the plaid_link integration.
locals {
  api_base_url = "https://${aws_api_gateway_rest_api.api_gateway.id}.execute-api.${data.aws_region.current.name}.amazonaws.com/${var.environment}"
}

data "aws_secretsmanager_secret_version" "db" {
  secret_id = var.db_secret_arn
}

locals {
  db_creds = jsondecode(data.aws_secretsmanager_secret_version.db.secret_string)
}

resource "aws_iam_role" "api" {
  name = "${var.environment}-financeapp-api-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "api_basic_logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "api_vpc_access" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Shared by accounts/categories/transactions, but only transactions actually
# sends to this queue — scoped to the one queue ARN rather than "sqs:*".
resource "aws_iam_role_policy" "api_transaction_events_send" {
  name = "${var.environment}-financeapp-api-transaction-events-send"
  role = aws_iam_role.api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "sqs:SendMessage"
      Resource = var.transaction_events_queue_arn
    }]
  })
}

resource "aws_api_gateway_deployment" "api_gateway_deployment" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.accounts.id,
      aws_api_gateway_resource.accounts_proxy.id,
      aws_api_gateway_method.accounts_method.id,
      aws_api_gateway_integration.accounts_integration.id,
      aws_api_gateway_method.accounts_options.id,
      aws_api_gateway_integration.accounts_options_integration.id,
      aws_api_gateway_integration_response.accounts_options_integration_response.id,
      aws_api_gateway_resource.categories.id,
      aws_api_gateway_resource.categories_proxy.id,
      aws_api_gateway_method.categories_method.id,
      aws_api_gateway_integration.categories_integration.id,
      aws_api_gateway_method.categories_options.id,
      aws_api_gateway_integration.categories_options_integration.id,
      aws_api_gateway_integration_response.categories_options_integration_response.id,
      aws_api_gateway_resource.transactions.id,
      aws_api_gateway_resource.transactions_proxy.id,
      aws_api_gateway_method.transactions_method.id,
      aws_api_gateway_integration.transactions_integration.id,
      aws_api_gateway_method.transactions_options.id,
      aws_api_gateway_integration.transactions_options_integration.id,
      aws_api_gateway_integration_response.transactions_options_integration_response.id,
      aws_api_gateway_gateway_response.unauthorized.id,
      aws_api_gateway_gateway_response.access_denied.id,
      aws_api_gateway_gateway_response.default_4xx.id,
      aws_api_gateway_gateway_response.default_5xx.id,
      aws_api_gateway_resource.plaid.id,
      aws_api_gateway_resource.plaid_proxy.id,
      aws_api_gateway_method.plaid_method.id,
      aws_api_gateway_integration.plaid_integration.id,
      aws_api_gateway_method.plaid_options.id,
      aws_api_gateway_integration.plaid_options_integration.id,
      aws_api_gateway_integration_response.plaid_options_integration_response.id,
      aws_api_gateway_resource.plaid_webhook.id,
      aws_api_gateway_method.plaid_webhook_method.id,
      aws_api_gateway_integration.plaid_webhook_integration.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "api_gateway_stage" {
  deployment_id = aws_api_gateway_deployment.api_gateway_deployment.id
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  stage_name    = var.environment
}

#accounts

resource "aws_api_gateway_resource" "accounts" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  parent_id   = aws_api_gateway_rest_api.api_gateway.root_resource_id
  path_part   = "accounts"
}

resource "aws_api_gateway_resource" "accounts_proxy" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  parent_id   = aws_api_gateway_resource.accounts.id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "accounts_method" {
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  resource_id   = aws_api_gateway_resource.accounts_proxy.id
  http_method   = "ANY"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "accounts_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api_gateway.id
  resource_id             = aws_api_gateway_resource.accounts_proxy.id
  http_method             = aws_api_gateway_method.accounts_method.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.accounts.invoke_arn
}

resource "aws_lambda_function" "accounts" {
  function_name = "${var.environment}-financeapp-accounts-lambda"
  role          = aws_iam_role.api.arn
  handler       = "handler.handler"
  runtime       = "nodejs22.x"
  timeout       = 10

  filename         = "${path.module}/../../../backend/dist/accounts.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../backend/dist/accounts.zip")

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = {
      DB_USERNAME    = local.db_creds.username
      DB_PASSWORD    = local.db_creds.password
      DB_HOST        = var.db_host
      ALLOWED_ORIGIN = var.frontend_origin
    }
  }
}

resource "aws_lambda_permission" "allow_apigw_accounts" {
  statement_id  = "AllowAPIGatewayInvokeAccounts"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.accounts.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api_gateway.execution_arn}/*/*"
}

# CORS preflight — OPTIONS has no Authorization header by design, so it can't
# go through the Cognito authorizer like the ANY method above does. This is a
# separate, unauthenticated MOCK method that just echoes back the allowed
# headers/methods/origin so the browser's preflight check passes; the real
# request still goes through the authorizer as normal.
resource "aws_api_gateway_method" "accounts_options" {
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  resource_id   = aws_api_gateway_resource.accounts_proxy.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_method_response" "accounts_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  resource_id = aws_api_gateway_resource.accounts_proxy.id
  http_method = aws_api_gateway_method.accounts_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration" "accounts_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  resource_id = aws_api_gateway_resource.accounts_proxy.id
  http_method = aws_api_gateway_method.accounts_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_integration_response" "accounts_options_integration_response" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  resource_id = aws_api_gateway_resource.accounts_proxy.id
  http_method = aws_api_gateway_method.accounts_options.http_method
  status_code = aws_api_gateway_method_response.accounts_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.frontend_origin}'"
  }
}

#categories

resource "aws_api_gateway_resource" "categories" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  parent_id   = aws_api_gateway_rest_api.api_gateway.root_resource_id
  path_part   = "categories"
}

resource "aws_api_gateway_resource" "categories_proxy" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  parent_id   = aws_api_gateway_resource.categories.id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "categories_method" {
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  resource_id   = aws_api_gateway_resource.categories_proxy.id
  http_method   = "ANY"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "categories_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api_gateway.id
  resource_id             = aws_api_gateway_resource.categories_proxy.id
  http_method             = aws_api_gateway_method.categories_method.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.categories.invoke_arn
}

resource "aws_lambda_function" "categories" {
  function_name = "${var.environment}-financeapp-categories-lambda"
  role          = aws_iam_role.api.arn
  handler       = "handler.handler"
  runtime       = "nodejs22.x"
  timeout       = 10

  filename         = "${path.module}/../../../backend/dist/categories.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../backend/dist/categories.zip")

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = {
      DB_USERNAME    = local.db_creds.username
      DB_PASSWORD    = local.db_creds.password
      DB_HOST        = var.db_host
      ALLOWED_ORIGIN = var.frontend_origin
    }
  }
}

resource "aws_lambda_permission" "allow_apigw_categories" {
  statement_id  = "AllowAPIGatewayInvokeCategories"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.categories.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api_gateway.execution_arn}/*/*"
}

resource "aws_api_gateway_method" "categories_options" {
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  resource_id   = aws_api_gateway_resource.categories_proxy.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_method_response" "categories_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  resource_id = aws_api_gateway_resource.categories_proxy.id
  http_method = aws_api_gateway_method.categories_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration" "categories_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  resource_id = aws_api_gateway_resource.categories_proxy.id
  http_method = aws_api_gateway_method.categories_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_integration_response" "categories_options_integration_response" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  resource_id = aws_api_gateway_resource.categories_proxy.id
  http_method = aws_api_gateway_method.categories_options.http_method
  status_code = aws_api_gateway_method_response.categories_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.frontend_origin}'"
  }
}

#transactions

resource "aws_api_gateway_resource" "transactions" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  parent_id   = aws_api_gateway_rest_api.api_gateway.root_resource_id
  path_part   = "transactions"
}

resource "aws_api_gateway_resource" "transactions_proxy" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  parent_id   = aws_api_gateway_resource.transactions.id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "transactions_method" {
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  resource_id   = aws_api_gateway_resource.transactions_proxy.id
  http_method   = "ANY"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "transactions_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api_gateway.id
  resource_id             = aws_api_gateway_resource.transactions_proxy.id
  http_method             = aws_api_gateway_method.transactions_method.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.transactions.invoke_arn
}

resource "aws_lambda_function" "transactions" {
  function_name = "${var.environment}-financeapp-transactions-lambda"
  role          = aws_iam_role.api.arn
  handler       = "handler.handler"
  runtime       = "nodejs22.x"
  timeout       = 10

  filename         = "${path.module}/../../../backend/dist/transactions.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../backend/dist/transactions.zip")

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = {
      DB_USERNAME           = local.db_creds.username
      DB_PASSWORD           = local.db_creds.password
      DB_HOST               = var.db_host
      ALLOWED_ORIGIN        = var.frontend_origin
      TRANSACTION_QUEUE_URL = var.transaction_events_queue_url
    }
  }
}

resource "aws_lambda_permission" "allow_apigw_transactions" {
  statement_id  = "AllowAPIGatewayInvokeTransactions"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.transactions.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api_gateway.execution_arn}/*/*"
}

resource "aws_api_gateway_method" "transactions_options" {
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  resource_id   = aws_api_gateway_resource.transactions_proxy.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_method_response" "transactions_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  resource_id = aws_api_gateway_resource.transactions_proxy.id
  http_method = aws_api_gateway_method.transactions_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration" "transactions_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  resource_id = aws_api_gateway_resource.transactions_proxy.id
  http_method = aws_api_gateway_method.transactions_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_integration_response" "transactions_options_integration_response" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  resource_id = aws_api_gateway_resource.transactions_proxy.id
  http_method = aws_api_gateway_method.transactions_options.http_method
  status_code = aws_api_gateway_method_response.transactions_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.frontend_origin}'"
  }
}

#plaid (link-token/exchange, Cognito-authed; own role since it doesn't need
# RDS/VPC — see infra/modules/plaid/main.tf for why the Plaid-API-calling
# and RDS-writing pieces are split across non-VPC/VPC Lambdas)

resource "aws_iam_role" "plaid_link" {
  name = "${var.environment}-financeapp-plaid-link-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "plaid_link_basic_logs" {
  role       = aws_iam_role.plaid_link.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "plaid_link_secrets" {
  name = "${var.environment}-financeapp-plaid-link-secrets"
  role = aws_iam_role.plaid_link.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = var.plaid_credentials_secret_arn
      },
      {
        Effect   = "Allow"
        Action   = "secretsmanager:CreateSecret"
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "plaid_link_sqs_send" {
  name = "${var.environment}-financeapp-plaid-link-sqs-send"
  role = aws_iam_role.plaid_link.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "sqs:SendMessage"
      Resource = var.plaid_events_queue_arn
    }]
  })
}

resource "aws_api_gateway_resource" "plaid" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  parent_id   = aws_api_gateway_rest_api.api_gateway.root_resource_id
  path_part   = "plaid"
}

resource "aws_api_gateway_resource" "plaid_proxy" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  parent_id   = aws_api_gateway_resource.plaid.id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "plaid_method" {
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  resource_id   = aws_api_gateway_resource.plaid_proxy.id
  http_method   = "ANY"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "plaid_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api_gateway.id
  resource_id             = aws_api_gateway_resource.plaid_proxy.id
  http_method             = aws_api_gateway_method.plaid_method.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.plaid_link.invoke_arn
}

resource "aws_lambda_function" "plaid_link" {
  function_name = "${var.environment}-financeapp-plaid-link-lambda"
  role          = aws_iam_role.plaid_link.arn
  handler       = "handler.handler"
  runtime       = "nodejs22.x"
  timeout       = 15

  filename         = "${path.module}/../../../backend/dist/plaid-link.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../backend/dist/plaid-link.zip")

  environment {
    variables = {
      ALLOWED_ORIGIN               = var.frontend_origin
      PLAID_CREDENTIALS_SECRET_ARN = var.plaid_credentials_secret_arn
      PLAID_ITEM_SECRET_PREFIX     = "${var.environment}-financeapp-plaid-item-"
      PLAID_EVENTS_QUEUE_URL       = var.plaid_events_queue_url
      PLAID_WEBHOOK_URL            = "${local.api_base_url}/plaid-webhook"
    }
  }
}

resource "aws_lambda_permission" "allow_apigw_plaid" {
  statement_id  = "AllowAPIGatewayInvokePlaidLink"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.plaid_link.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api_gateway.execution_arn}/*/*"
}

resource "aws_api_gateway_method" "plaid_options" {
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  resource_id   = aws_api_gateway_resource.plaid_proxy.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_method_response" "plaid_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  resource_id = aws_api_gateway_resource.plaid_proxy.id
  http_method = aws_api_gateway_method.plaid_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration" "plaid_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  resource_id = aws_api_gateway_resource.plaid_proxy.id
  http_method = aws_api_gateway_method.plaid_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_integration_response" "plaid_options_integration_response" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  resource_id = aws_api_gateway_resource.plaid_proxy.id
  http_method = aws_api_gateway_method.plaid_options.http_method
  status_code = aws_api_gateway_method_response.plaid_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.frontend_origin}'"
  }
}

#plaid-webhook (public — Plaid calls this server-to-server, no Cognito token)

resource "aws_api_gateway_resource" "plaid_webhook" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id
  parent_id   = aws_api_gateway_rest_api.api_gateway.root_resource_id
  path_part   = "plaid-webhook"
}

resource "aws_api_gateway_method" "plaid_webhook_method" {
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  resource_id   = aws_api_gateway_resource.plaid_webhook.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "plaid_webhook_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api_gateway.id
  resource_id             = aws_api_gateway_resource.plaid_webhook.id
  http_method             = aws_api_gateway_method.plaid_webhook_method.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.plaid_webhook_invoke_arn
}

resource "aws_lambda_permission" "allow_apigw_plaid_webhook" {
  statement_id  = "AllowAPIGatewayInvokePlaidWebhook"
  action        = "lambda:InvokeFunction"
  function_name = var.plaid_webhook_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api_gateway.execution_arn}/*/*"
}

#Authorizer

resource "aws_api_gateway_authorizer" "cognito" {
  name            = "${var.environment}-financeapp-api-gateway-authorizer"
  rest_api_id     = aws_api_gateway_rest_api.api_gateway.id
  type            = "COGNITO_USER_POOLS"
  provider_arns   = [var.cognito_user_pool_arn]
  identity_source = "method.request.header.Authorization"
}

# A request the Cognito authorizer rejects (missing/invalid/expired token)
# never reaches the Lambda, so Hono's cors() middleware never runs — API
# Gateway serves its own built-in "Gateway Response" instead. Without these,
# every auth failure comes back with no CORS headers at all, which the
# browser reports as a CORS error instead of surfacing the real 401/403.
resource "aws_api_gateway_gateway_response" "unauthorized" {
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  response_type = "UNAUTHORIZED"
  status_code   = "401"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${var.frontend_origin}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
  }
}

resource "aws_api_gateway_gateway_response" "access_denied" {
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  response_type = "ACCESS_DENIED"
  status_code   = "403"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${var.frontend_origin}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
  }
}

resource "aws_api_gateway_gateway_response" "default_4xx" {
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  response_type = "DEFAULT_4XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${var.frontend_origin}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
  }
}

resource "aws_api_gateway_gateway_response" "default_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  response_type = "DEFAULT_5XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${var.frontend_origin}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
  }
}