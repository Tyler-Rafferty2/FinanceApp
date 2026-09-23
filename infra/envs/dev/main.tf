# Root module for the dev environment — wires the reusable modules
# together with real values. Add module blocks as each phase needs them.

module "network" {
  source = "../../modules/network"

  vpc_cidr    = var.vpc_cidr
  azs         = var.azs
  environment = var.environment
}

module "database" {
  source = "../../modules/database"

  private_subnet_ids    = module.network.private_subnet_ids
  rds_security_group_id = module.network.rds_security_group_id
  environment           = var.environment
}

module "migrate" {
  source = "../../modules/migrate"

  private_subnet_ids       = module.network.private_subnet_ids
  lambda_security_group_id = module.network.lambda_security_group_id
  db_secret_arn            = module.database.db_secret_arn
  db_host                  = module.database.db_endpoint
  environment              = var.environment
}

module "auth" {
  source = "../../modules/auth"

  environment              = var.environment
  private_subnet_ids       = module.network.private_subnet_ids
  lambda_security_group_id = module.network.lambda_security_group_id
  db_secret_arn            = module.database.db_secret_arn
  db_host                  = module.database.db_endpoint
}

module "async" {
  source = "../../modules/async"

  environment              = var.environment
  private_subnet_ids       = module.network.private_subnet_ids
  lambda_security_group_id = module.network.lambda_security_group_id
  vpc_id                   = module.network.vpc_id
  db_secret_arn            = module.database.db_secret_arn
  db_host                  = module.database.db_endpoint
  ses_sender_email         = var.ses_sender_email
}

module "plaid" {
  source = "../../modules/plaid"

  environment              = var.environment
  private_subnet_ids       = module.network.private_subnet_ids
  lambda_security_group_id = module.network.lambda_security_group_id
  db_secret_arn            = module.database.db_secret_arn
  db_host                  = module.database.db_endpoint
  plaid_client_id          = var.plaid_client_id
  plaid_secret             = var.plaid_secret
  plaid_env                = var.plaid_env
}

module "api" {
  source = "../../modules/api"

  environment                  = var.environment
  cognito_user_pool_arn        = module.auth.user_pool_arn
  private_subnet_ids           = module.network.private_subnet_ids
  lambda_security_group_id     = module.network.lambda_security_group_id
  db_secret_arn                = module.database.db_secret_arn
  db_host                      = module.database.db_endpoint
  frontend_origin              = var.frontend_origin
  transaction_events_queue_url = module.async.transaction_events_queue_url
  transaction_events_queue_arn = module.async.transaction_events_queue_arn
  plaid_credentials_secret_arn = module.plaid.plaid_credentials_secret_arn
  plaid_events_queue_url       = module.plaid.plaid_events_queue_url
  plaid_events_queue_arn       = module.plaid.plaid_events_queue_arn
  plaid_webhook_invoke_arn     = module.plaid.plaid_webhook_invoke_arn
  plaid_webhook_function_name  = module.plaid.plaid_webhook_function_name
}
