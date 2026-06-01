resource "aws_db_subnet_group" "portal" {
  name       = "ssp-portal"
  subnet_ids = data.terraform_remote_state.vpc.outputs.private_subnet_ids
}

resource "aws_security_group" "portal_db" {
  name        = "ssp-portal-db"
  description = "Allow Postgres from EKS node SG only."
  vpc_id      = data.terraform_remote_state.vpc.outputs.vpc_id
}

# Inbound from EKS nodes only.
resource "aws_security_group_rule" "portal_db_from_nodes" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = data.terraform_remote_state.eks.outputs.node_security_group_id
  security_group_id        = aws_security_group.portal_db.id
}

resource "random_password" "portal_db" {
  length  = 32
  special = false # keeps the URL form simple (no need to URL-encode)
}

resource "aws_secretsmanager_secret" "portal_db" {
  name        = "ssp/portal/db"
  description = "SSP portal Postgres master credentials. Synced into the cluster via ESO."
  kms_key_id  = data.terraform_remote_state.bootstrap.outputs.secrets_kms_key_arn
}

resource "aws_db_instance" "portal" {
  identifier              = "ssp-portal"
  engine                  = "postgres"
  engine_version          = "16.14"
  instance_class          = var.db_instance_class
  allocated_storage       = 20
  storage_encrypted       = true
  kms_key_id              = data.terraform_remote_state.bootstrap.outputs.secrets_kms_key_arn
  db_name                 = "ssp"
  username                = "ssp"
  password                = random_password.portal_db.result
  db_subnet_group_name    = aws_db_subnet_group.portal.name
  vpc_security_group_ids  = [aws_security_group.portal_db.id]
  publicly_accessible     = false
  multi_az                = false
  backup_retention_period = 1
  skip_final_snapshot     = true
  apply_immediately       = true
}

# Persist the full credential blob to Secrets Manager AFTER the DB is up so we record the
# real endpoint. ESO can then sync this single secret into the portal namespace.
resource "aws_secretsmanager_secret_version" "portal_db" {
  secret_id = aws_secretsmanager_secret.portal_db.id
  secret_string = jsonencode({
    host     = aws_db_instance.portal.address
    port     = aws_db_instance.portal.port
    username = aws_db_instance.portal.username
    password = random_password.portal_db.result
    database = aws_db_instance.portal.db_name
    url      = "postgres://${aws_db_instance.portal.username}:${random_password.portal_db.result}@${aws_db_instance.portal.address}:${aws_db_instance.portal.port}/${aws_db_instance.portal.db_name}"
  })
}
