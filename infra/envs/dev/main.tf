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

# Phase 2+ modules get added here as you build them, e.g.:
# module "auth" {
#   source = "../../modules/auth"
#   ...
# }
