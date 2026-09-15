resource "aws_api_gateway_rest_api" "api_gateway" {
  name = "${var.environment}-financeapp-api-gateway"
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

resource "aws_api_gateway_deployment" "api_gateway_deployment" {
  rest_api_id = aws_api_gateway_rest_api.api_gateway.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.accounts.id,
      aws_api_gateway_resource.accounts_proxy.id,
      aws_api_gateway_method.accounts_method.id,
      aws_api_gateway_integration.accounts_integration.id,
      aws_api_gateway_resource.categories.id,
      aws_api_gateway_resource.categories_proxy.id,
      aws_api_gateway_method.categories_method.id,
      aws_api_gateway_integration.categories_integration.id,
      aws_api_gateway_resource.transactions.id,
      aws_api_gateway_resource.transactions_proxy.id,
      aws_api_gateway_method.transactions_method.id,
      aws_api_gateway_integration.transactions_integration.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "api_gateway_stage" {
  deployment_id = aws_api_gateway_deployment.api_gateway_deployment.id
  rest_api_id   = aws_api_gateway_rest_api.api_gateway.id
  stage_name    = "${var.environment}"
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
      DB_USERNAME = local.db_creds.username
      DB_PASSWORD = local.db_creds.password
      DB_HOST     = var.db_host
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
      DB_USERNAME = local.db_creds.username
      DB_PASSWORD = local.db_creds.password
      DB_HOST     = var.db_host
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
      DB_USERNAME = local.db_creds.username
      DB_PASSWORD = local.db_creds.password
      DB_HOST     = var.db_host
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

#Authorizer

resource "aws_api_gateway_authorizer" "cognito" {
  name            = "${var.environment}-financeapp-api-gateway-authorizer"
  rest_api_id     = aws_api_gateway_rest_api.api_gateway.id
  type            = "COGNITO_USER_POOLS"
  provider_arns   = [var.cognito_user_pool_arn]
  identity_source = "method.request.header.Authorization"
}