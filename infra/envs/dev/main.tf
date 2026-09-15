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

module "api" {
  source = "../../modules/api"

  environment              = var.environment
  cognito_user_pool_arn    = module.auth.user_pool_arn
  private_subnet_ids       = module.network.private_subnet_ids
  lambda_security_group_id = module.network.lambda_security_group_id
  db_secret_arn            = module.database.db_secret_arn
  db_host                  = module.database.db_endpoint
  frontend_origin          = var.frontend_origin
}
