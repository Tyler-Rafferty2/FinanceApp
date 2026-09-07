# Database module — RDS Postgres, single instance, multi-tenant via tenant_id column.
#
# The RDS security group itself is created in the network module (security
# groups live with the VPC they secure) and passed in via var.rds_security_group_id.
#
# Resources to add here (Phase 1):
#   - aws_db_subnet_group.this        — built from var.private_subnet_ids
#   - aws_db_instance.this            — engine = "postgres", instance_class = var.instance_class,
#                                        vpc_security_group_ids = [var.rds_security_group_id],
#                                        db_name = var.db_name, free-tier storage (20GB gp2/gp3),
#                                        manage_master_user_password = true (lets RDS create/rotate
#                                        the master password in Secrets Manager instead of you
#                                        picking one and putting it in a .tfvars file)
#
# Wire the outputs in outputs.tf as you create each resource.

resource "aws_db_subnet_group" "this" {
  name       = "${var.environment}-scheduler-db-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name        = "${var.environment}-scheduler-db-subnet-group"
    Environment = var.environment
  }
}

resource "aws_db_instance" "this" {
  identifier     = "${var.environment}-scheduler-db"
  engine         = "postgres"
  engine_version = "16.4"

  instance_class    = var.instance_class
  allocated_storage = 20
  storage_type      = "gp2"

  db_name  = var.db_name
  username = "scheduler_admin"

  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.rds_security_group_id]
  publicly_accessible    = false

  multi_az                = false
  backup_retention_period = 7
  deletion_protection     = false
  skip_final_snapshot     = true
  apply_immediately       = true

  tags = {
    Name        = "${var.environment}-scheduler-db"
    Environment = var.environment
  }
}
