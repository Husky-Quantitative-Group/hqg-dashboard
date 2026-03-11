terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

locals {
  name_prefix                             = "${var.project}-${var.env}"
  is_prod                                 = lower(var.env) == "prod"
  api_custom_domain_requested             = local.is_prod && var.api_custom_domain_name != null
  api_custom_domain_activated             = local.api_custom_domain_requested && var.api_custom_domain_activate
  artifacts_bucket_name                   = coalesce(var.artifacts_bucket_name, "${local.name_prefix}-strategy-artifacts-${data.aws_caller_identity.current.account_id}")
  backtests_bucket_name                   = coalesce(var.backtests_bucket_name, "${local.name_prefix}-backtest-metrics-${data.aws_caller_identity.current.account_id}")
  jwks_bucket_name                        = coalesce(var.jwks_bucket_name, "${local.name_prefix}-jwks-${random_id.jwks_bucket_suffix.hex}")
  strategies_table_name                   = coalesce(var.strategies_table_name, "${local.name_prefix}-strategies")
  strategy_artifacts_table_name           = coalesce(var.strategy_artifacts_table_name, "${local.name_prefix}-strategy-artifacts")
  strategy_artifact_versions_table        = coalesce(var.strategy_artifact_versions_table_name, "${local.name_prefix}-strategy-artifact-versions")
  users_table_name                        = coalesce(var.users_table_name, "${local.name_prefix}-users")
  user_access_applications_table_name     = coalesce(var.user_access_applications_table_name, "${local.name_prefix}-user-access-applications")
  backtest_metrics_table_name             = coalesce(var.backtest_metrics_table_name, "${local.name_prefix}-backtest-metrics")
  strategies_read_permissions_table_name  = coalesce(var.strategies_read_permissions_table_name, "${local.name_prefix}-strategies-read-permissions")
  strategies_write_permissions_table_name = coalesce(var.strategies_write_permissions_table_name, "${local.name_prefix}-strategies-write-permissions")
  counters_table_name                     = coalesce(var.counters_table_name, "${local.name_prefix}-counters")

  tags = merge(
    {
      Project = var.project
      Env     = var.env
    },
    var.tags
  )
}

# ------------------------------
# S3 bucket for strategy artifacts
# ------------------------------

resource "aws_s3_bucket" "strategy_artifacts" {
  bucket        = local.artifacts_bucket_name
  force_destroy = lower(var.env) != "prod"

  tags = local.tags
}

resource "aws_s3_bucket_versioning" "strategy_artifacts" {
  bucket = aws_s3_bucket.strategy_artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "strategy_artifacts" {
  bucket = aws_s3_bucket.strategy_artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "strategy_artifacts" {
  bucket = aws_s3_bucket.strategy_artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ------------------------------
# S3 bucket for backtest storage
# ------------------------------

resource "aws_s3_bucket" "backtest_metrics" {
  bucket        = local.backtests_bucket_name
  force_destroy = lower(var.env) != "prod"

  tags = local.tags
}

resource "aws_s3_bucket_versioning" "backtest_metrics" {
  bucket = aws_s3_bucket.backtest_metrics.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "backtest_metrics" {
  bucket = aws_s3_bucket.backtest_metrics.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backtest_metrics" {
  bucket = aws_s3_bucket.backtest_metrics.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "backtest_metrics" {
  bucket = aws_s3_bucket.backtest_metrics.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "HEAD"]
    allowed_origins = [var.frontend_base_url, "https://dashboard.uconnquant.com"]
    max_age_seconds = 300
  }
}

# ------------------------------  
# S3 bucket for JWKS
# ------------------------------

resource "random_id" "jwks_bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "jwks" {
  bucket        = local.jwks_bucket_name
  force_destroy = lower(var.env) != "prod"

  tags = local.tags
}

resource "aws_s3_bucket_public_access_block" "jwks" {
  bucket = aws_s3_bucket.jwks.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

data "aws_iam_policy_document" "jwks_public_read" {
  statement {
    sid    = "PublicReadJwks"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    actions = [
      "s3:GetObject",
    ]

    resources = [
      "${aws_s3_bucket.jwks.arn}/.well-known/jwks.json",
    ]
  }
}

resource "aws_s3_bucket_policy" "jwks_public_read" {
  bucket = aws_s3_bucket.jwks.id
  policy = data.aws_iam_policy_document.jwks_public_read.json

  depends_on = [aws_s3_bucket_public_access_block.jwks]
}

# ------------------------------
# DynamoDB tables
# ------------------------------

resource "aws_dynamodb_table" "strategies" {
  name         = local.strategies_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = local.tags
}

resource "aws_dynamodb_table" "counters" {
  name         = local.counters_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "counter_name"

  attribute {
    name = "counter_name"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = local.tags
}

resource "aws_dynamodb_table" "strategy_artifacts" {
  name         = local.strategy_artifacts_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "strategy_id"
  range_key    = "artifact_id"

  attribute {
    name = "strategy_id"
    type = "S"
  }

  attribute {
    name = "artifact_id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = local.tags
}

resource "aws_dynamodb_table" "strategy_artifact_versions" {
  name         = local.strategy_artifact_versions_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "strategy_artifact_id"
  range_key    = "strategy_version"

  attribute {
    name = "strategy_artifact_id"
    type = "S"
  }

  attribute {
    name = "strategy_version"
    type = "N"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = local.tags
}

resource "aws_dynamodb_table" "users" {
  name         = local.users_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "netid"

  attribute {
    name = "netid"
    type = "S"
  }

  attribute {
    name = "search_pk"
    type = "S"
  }

  attribute {
    name = "full_name_lower"
    type = "S"
  }

  global_secondary_index {
    name            = "users-netid-gsi"
    hash_key        = "search_pk"
    range_key       = "netid"
    projection_type = "INCLUDE"
    non_key_attributes = [
      "full_name",
      "uconn_email",
    ]
  }

  global_secondary_index {
    name            = "users-full-name-gsi"
    hash_key        = "search_pk"
    range_key       = "full_name_lower"
    projection_type = "INCLUDE"
    non_key_attributes = [
      "netid",
      "full_name",
      "uconn_email",
    ]
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = local.tags
}

resource "aws_dynamodb_table" "user_access_applications" {
  name         = local.user_access_applications_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "netid"
  range_key    = "created_at"

  attribute {
    name = "netid"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = local.tags
}

resource "aws_dynamodb_table" "backtest_metrics" {
  name         = local.backtest_metrics_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "strategy_id"
  range_key    = "run_id"

  attribute {
    name = "strategy_id"
    type = "S"
  }

  attribute {
    name = "run_id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = local.tags
}

resource "aws_dynamodb_table" "strategies_read_permissions" {
  name         = local.strategies_read_permissions_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "strategy_id"
  range_key    = "principal"

  attribute {
    name = "strategy_id"
    type = "S"
  }

  attribute {
    name = "principal"
    type = "S"
  }

  global_secondary_index {
    name            = "principal-strategy-index"
    hash_key        = "principal"
    range_key       = "strategy_id"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = local.tags
}

resource "aws_dynamodb_table" "strategies_write_permissions" {
  name         = local.strategies_write_permissions_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "strategy_id"
  range_key    = "principal"

  attribute {
    name = "strategy_id"
    type = "S"
  }

  attribute {
    name = "principal"
    type = "S"
  }

  global_secondary_index {
    name            = "principal-strategy-index"
    hash_key        = "principal"
    range_key       = "strategy_id"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = local.tags
}

# ------------------------------
# IAM policy: allow Lambdas to use storage
# ------------------------------

data "aws_iam_policy_document" "strategy_storage" {
  statement {
    sid    = "S3ArtifactsAccess"
    effect = "Allow"

    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListBucket",
      "s3:GetObjectVersion",
    ]

    resources = [
      aws_s3_bucket.strategy_artifacts.arn,
      "${aws_s3_bucket.strategy_artifacts.arn}/*",
    ]
  }

  statement {
    sid    = "DynamoStrategiesAccess"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:BatchGetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:DescribeTable",
    ]

    resources = [
      aws_dynamodb_table.strategies.arn,
      aws_dynamodb_table.strategy_artifacts.arn,
      aws_dynamodb_table.strategy_artifact_versions.arn,
      aws_dynamodb_table.strategies_read_permissions.arn,
      "${aws_dynamodb_table.strategies_read_permissions.arn}/index/*",
      aws_dynamodb_table.strategies_write_permissions.arn,
      "${aws_dynamodb_table.strategies_write_permissions.arn}/index/*",
    ]
  }
}

resource "aws_iam_policy" "strategy_storage" {
  name   = "${local.name_prefix}-strategy-storage"
  policy = data.aws_iam_policy_document.strategy_storage.json

  tags = local.tags
}

data "aws_iam_policy_document" "counters_write" {
  statement {
    sid    = "DynamoCountersWrite"
    effect = "Allow"

    actions = [
      "dynamodb:UpdateItem",
    ]

    resources = [
      aws_dynamodb_table.counters.arn,
    ]
  }
}

resource "aws_iam_policy" "counters_write" {
  name   = "${local.name_prefix}-counters-write"
  policy = data.aws_iam_policy_document.counters_write.json

  tags = local.tags
}

data "aws_iam_policy_document" "users_read" {
  statement {
    sid    = "DynamoUsersRead"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
    ]

    resources = [
      aws_dynamodb_table.users.arn,
    ]
  }
}

resource "aws_iam_policy" "users_read" {
  name   = "${local.name_prefix}-users-read"
  policy = data.aws_iam_policy_document.users_read.json

  tags = local.tags
}

data "aws_iam_policy_document" "users_search" {
  statement {
    sid    = "DynamoUsersSearch"
    effect = "Allow"

    actions = [
      "dynamodb:BatchGetItem",
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]

    resources = [
      aws_dynamodb_table.users.arn,
      "${aws_dynamodb_table.users.arn}/index/*",
    ]
  }
}

resource "aws_iam_policy" "users_search" {
  name   = "${local.name_prefix}-users-search"
  policy = data.aws_iam_policy_document.users_search.json

  tags = local.tags
}

data "aws_iam_policy_document" "user_access_applications_write" {
  statement {
    sid    = "DynamoUserAccessApplicationsWrite"
    effect = "Allow"

    actions = [
      "dynamodb:PutItem",
      "dynamodb:Query",
    ]

    resources = [
      aws_dynamodb_table.user_access_applications.arn,
    ]
  }
}

resource "aws_iam_policy" "user_access_applications_write" {
  name   = "${local.name_prefix}-user-access-applications-write"
  policy = data.aws_iam_policy_document.user_access_applications_write.json

  tags = local.tags
}

data "aws_iam_policy_document" "admin_dynamodb" {
  statement {
    sid    = "DynamoAdminAccess"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:DescribeTable",
    ]

    resources = [
      aws_dynamodb_table.users.arn,
      aws_dynamodb_table.user_access_applications.arn,
    ]
  }
}

resource "aws_iam_policy" "admin_dynamodb" {
  name   = "${local.name_prefix}-admin-dynamodb"
  policy = data.aws_iam_policy_document.admin_dynamodb.json

  tags = local.tags
}

data "aws_iam_policy_document" "backtest_metrics_storage" {
  statement {
    sid    = "S3BacktestMetricsAccess"
    effect = "Allow"

    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListBucket",
      "s3:GetObjectVersion",
    ]

    resources = [
      aws_s3_bucket.backtest_metrics.arn,
      "${aws_s3_bucket.backtest_metrics.arn}/*",
    ]
  }

  statement {
    sid    = "DynamoBacktestMetricsAccess"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:DescribeTable",
    ]

    resources = [
      aws_dynamodb_table.backtest_metrics.arn,
      aws_dynamodb_table.strategies_write_permissions.arn,
      "${aws_dynamodb_table.strategies_write_permissions.arn}/index/*",
      aws_dynamodb_table.strategies.arn,
    ]
  }
}

resource "aws_iam_policy" "backtest_metrics_storage" {
  name   = "${local.name_prefix}-backtest-metrics-storage"
  policy = data.aws_iam_policy_document.backtest_metrics_storage.json

  tags = local.tags
}

# ------------------------------
# SSM parameter for JWT private key
# ------------------------------

resource "aws_ssm_parameter" "jwt_private_key" {
  name  = "${local.name_prefix}-jwt-private-key"
  type  = "SecureString"
  value = "ROTATE_ME"

  tags = local.tags
}

data "aws_iam_policy_document" "jwt_private_key_read" {
  statement {
    sid    = "SsmJwtPrivateKeyRead"
    effect = "Allow"

    actions = [
      "ssm:GetParameter",
    ]

    resources = [
      aws_ssm_parameter.jwt_private_key.arn,
    ]
  }
}

resource "aws_iam_policy" "jwt_private_key_read" {
  name   = "${local.name_prefix}-jwt-private-key-read"
  policy = data.aws_iam_policy_document.jwt_private_key_read.json

  tags = local.tags
}

data "aws_iam_policy_document" "jwt_key_rotator" {
  statement {
    sid    = "SsmJwtPrivateKeyWrite"
    effect = "Allow"

    actions = [
      "ssm:PutParameter",
    ]

    resources = [
      aws_ssm_parameter.jwt_private_key.arn,
    ]
  }

  statement {
    sid    = "S3JwksWrite"
    effect = "Allow"

    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]

    resources = [
      "${aws_s3_bucket.jwks.arn}/.well-known/jwks.json",
    ]
  }

  statement {
    sid    = "S3JwksList"
    effect = "Allow"

    actions = [
      "s3:ListBucket",
    ]

    resources = [
      aws_s3_bucket.jwks.arn,
    ]
  }
}

resource "aws_iam_policy" "jwt_key_rotator" {
  name   = "${local.name_prefix}-jwt-key-rotator"
  policy = data.aws_iam_policy_document.jwt_key_rotator.json

  tags = local.tags
}

data "aws_iam_policy_document" "scheduler_assume_role" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "jwt_key_rotator_scheduler" {
  name               = "${local.name_prefix}-jwt-key-rotator-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume_role.json

  tags = local.tags
}

data "aws_iam_policy_document" "jwt_key_rotator_scheduler" {
  statement {
    sid    = "InvokeJwtKeyRotator"
    effect = "Allow"

    actions = [
      "lambda:InvokeFunction",
    ]

    resources = [
      aws_lambda_function.jwt_key_rotator.arn,
    ]
  }
}

resource "aws_iam_policy" "jwt_key_rotator_scheduler" {
  name   = "${local.name_prefix}-jwt-key-rotator-scheduler"
  policy = data.aws_iam_policy_document.jwt_key_rotator_scheduler.json

  tags = local.tags
}

# ------------------------------
# API Gateway (HTTP API) scaffold
# ------------------------------

resource "aws_apigatewayv2_api" "api" {
  name          = "${local.name_prefix}-http-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers     = ["content-type"]
    allow_methods     = ["OPTIONS", "GET", "POST", "PATCH"]
    allow_origins     = [var.frontend_base_url]
    allow_credentials = true
    max_age           = 300
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${local.name_prefix}-http-api-access"
  retention_in_days = 7
  tags              = local.tags
}

resource "aws_apigatewayv2_stage" "stage" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = var.env
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 25
    throttling_rate_limit  = 50
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId          = "$context.requestId"
      routeKey           = "$context.routeKey"
      status             = "$context.status"
      responseLatency    = "$context.responseLatency"
      integrationLatency = "$context.integrationLatency"
      authorizerLatency  = "$context.authorizer.latency"
    })
  }

  tags = local.tags
}

resource "aws_acm_certificate" "api_custom_domain" {
  count = local.api_custom_domain_requested ? 1 : 0

  domain_name       = var.api_custom_domain_name
  validation_method = "DNS"

  tags = local.tags
}

resource "aws_acm_certificate_validation" "api_custom_domain" {
  count = local.api_custom_domain_activated ? 1 : 0

  certificate_arn = aws_acm_certificate.api_custom_domain[0].arn
  validation_record_fqdns = [
    for dvo in aws_acm_certificate.api_custom_domain[0].domain_validation_options :
    dvo.resource_record_name
  ]
}

resource "aws_apigatewayv2_domain_name" "api_custom_domain" {
  count = local.api_custom_domain_activated ? 1 : 0

  domain_name = var.api_custom_domain_name

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.api_custom_domain[0].certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  tags = local.tags
}

resource "aws_apigatewayv2_api_mapping" "api_custom_domain" {
  count = local.api_custom_domain_activated ? 1 : 0

  api_id      = aws_apigatewayv2_api.api.id
  domain_name = aws_apigatewayv2_domain_name.api_custom_domain[0].id
  stage       = aws_apigatewayv2_stage.stage.id
}

# ------------------------------
# Lambda packaging
# ------------------------------

data "archive_file" "strategies_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../aws/lambdas/strategies"
  output_path = "${path.module}/dist/strategies-lambda.zip"
}

data "archive_file" "strategy_artifacts_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../aws/lambdas/strategy_artifacts"
  output_path = "${path.module}/dist/strategy-artifacts-lambda.zip"
}

data "archive_file" "auth_granter_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../aws/lambdas/auth-granter"
  output_path = "${path.module}/dist/auth-granter-lambda.zip"
}

data "archive_file" "auth_checker_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../aws/lambdas/auth-checker"
  output_path = "${path.module}/dist/auth-checker-lambda.zip"
}

data "archive_file" "jwt_key_rotator_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../aws/lambdas/jwt-key-rotator"
  output_path = "${path.module}/dist/jwt-key-rotator-lambda.zip"
}

data "archive_file" "admin_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../aws/lambdas/admin"
  output_path = "${path.module}/dist/admin-lambda.zip"
}

data "archive_file" "backtest_metrics_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../aws/lambdas/backtest-metrics"
  output_path = "${path.module}/dist/backtest-metrics-lambda.zip"
}

# ------------------------------
# Lambda IAM roles and policies
# ------------------------------

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "strategies_lambda" {
  name               = "${local.name_prefix}-strategies-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = local.tags
}

resource "aws_iam_role" "strategy_artifacts_lambda" {
  name               = "${local.name_prefix}-strategy-artifacts-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = local.tags
}

resource "aws_iam_role" "auth_granter_lambda" {
  name               = "${local.name_prefix}-auth-granter-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = local.tags
}

resource "aws_iam_role" "auth_checker_lambda" {
  name               = "${local.name_prefix}-auth-checker-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = local.tags
}

resource "aws_iam_role" "jwt_key_rotator_lambda" {
  name               = "${local.name_prefix}-jwt-key-rotator-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = local.tags
}

resource "aws_iam_role" "admin_lambda" {
  name               = "${local.name_prefix}-admin-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = local.tags
}

resource "aws_iam_role" "backtest_metrics_lambda" {
  name               = "${local.name_prefix}-backtest-metrics-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "strategies_lambda_basic_logs" {
  role       = aws_iam_role.strategies_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "strategies_lambda_storage" {
  role       = aws_iam_role.strategies_lambda.name
  policy_arn = aws_iam_policy.strategy_storage.arn
}

resource "aws_iam_role_policy_attachment" "strategies_lambda_users_search" {
  role       = aws_iam_role.strategies_lambda.name
  policy_arn = aws_iam_policy.users_search.arn
}

resource "aws_iam_role_policy_attachment" "strategies_lambda_counters" {
  role       = aws_iam_role.strategies_lambda.name
  policy_arn = aws_iam_policy.counters_write.arn
}

resource "aws_iam_role_policy_attachment" "strategy_artifacts_lambda_basic_logs" {
  role       = aws_iam_role.strategy_artifacts_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "strategy_artifacts_lambda_storage" {
  role       = aws_iam_role.strategy_artifacts_lambda.name
  policy_arn = aws_iam_policy.strategy_storage.arn
}

resource "aws_iam_role_policy_attachment" "auth_granter_lambda_basic_logs" {
  role       = aws_iam_role.auth_granter_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "auth_granter_lambda_users_read" {
  role       = aws_iam_role.auth_granter_lambda.name
  policy_arn = aws_iam_policy.users_read.arn
}

resource "aws_iam_role_policy_attachment" "auth_granter_lambda_jwt_private_key_read" {
  role       = aws_iam_role.auth_granter_lambda.name
  policy_arn = aws_iam_policy.jwt_private_key_read.arn
}

resource "aws_iam_role_policy_attachment" "auth_granter_lambda_user_access_applications_write" {
  role       = aws_iam_role.auth_granter_lambda.name
  policy_arn = aws_iam_policy.user_access_applications_write.arn
}

resource "aws_iam_role_policy_attachment" "auth_checker_lambda_basic_logs" {
  role       = aws_iam_role.auth_checker_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "auth_checker_lambda_users_read" {
  role       = aws_iam_role.auth_checker_lambda.name
  policy_arn = aws_iam_policy.users_read.arn
}

resource "aws_iam_role_policy_attachment" "jwt_key_rotator_lambda_basic_logs" {
  role       = aws_iam_role.jwt_key_rotator_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "jwt_key_rotator_lambda_access" {
  role       = aws_iam_role.jwt_key_rotator_lambda.name
  policy_arn = aws_iam_policy.jwt_key_rotator.arn
}

resource "aws_iam_role_policy_attachment" "jwt_key_rotator_scheduler_invoke" {
  role       = aws_iam_role.jwt_key_rotator_scheduler.name
  policy_arn = aws_iam_policy.jwt_key_rotator_scheduler.arn
}

resource "aws_iam_role_policy_attachment" "admin_lambda_basic_logs" {
  role       = aws_iam_role.admin_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "admin_lambda_dynamodb" {
  role       = aws_iam_role.admin_lambda.name
  policy_arn = aws_iam_policy.admin_dynamodb.arn
}

resource "aws_iam_role_policy_attachment" "backtest_metrics_lambda_basic_logs" {
  role       = aws_iam_role.backtest_metrics_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "backtest_metrics_lambda_storage" {
  role       = aws_iam_role.backtest_metrics_lambda.name
  policy_arn = aws_iam_policy.backtest_metrics_storage.arn
}

# ------------------------------
# Lambda layers packaging
# ------------------------------

resource "aws_lambda_layer_version" "pyjwt" {
  layer_name          = "${local.name_prefix}-pyjwt"
  filename            = "${path.module}/../aws/lambda_layers/pyjwt/build/pyjwt-layer.zip"
  source_code_hash    = filebase64sha256("${path.module}/../aws/lambda_layers/pyjwt/build/pyjwt-layer.zip")
  compatible_runtimes = ["python3.12"]
}

resource "aws_lambda_layer_version" "cryptography" {
  layer_name          = "${local.name_prefix}-cryptography"
  filename            = "${path.module}/../aws/lambda_layers/cryptography/build/cryptography-layer.zip"
  source_code_hash    = filebase64sha256("${path.module}/../aws/lambda_layers/cryptography/build/cryptography-layer.zip")
  compatible_runtimes = ["python3.12"]
}

resource "aws_lambda_layer_version" "wonderwords" {
  layer_name          = "${local.name_prefix}-wonderwords"
  filename            = "${path.module}/../aws/lambda_layers/wonderwords/build/wonderwords-layer.zip"
  source_code_hash    = filebase64sha256("${path.module}/../aws/lambda_layers/wonderwords/build/wonderwords-layer.zip")
  compatible_runtimes = ["python3.12"]
}

# ------------------------------
# Lambda deployment definitions
# ------------------------------

resource "aws_lambda_function" "strategies" {
  function_name = "${local.name_prefix}-strategies"
  role          = aws_iam_role.strategies_lambda.arn
  runtime       = "python3.12"
  handler       = "main.handler"

  filename         = data.archive_file.strategies_lambda.output_path
  source_code_hash = data.archive_file.strategies_lambda.output_base64sha256

  environment {
    variables = {
      STRATEGIES_TABLE                   = aws_dynamodb_table.strategies.name
      STRATEGY_ARTIFACTS_TABLE           = aws_dynamodb_table.strategy_artifacts.name
      STRATEGY_ARTIFACT_VERSIONS_TABLE   = aws_dynamodb_table.strategy_artifact_versions.name
      ARTIFACT_BUCKET                    = aws_s3_bucket.strategy_artifacts.bucket
      STRATEGIES_READ_PERMISSIONS_TABLE  = aws_dynamodb_table.strategies_read_permissions.name
      STRATEGIES_WRITE_PERMISSIONS_TABLE = aws_dynamodb_table.strategies_write_permissions.name
      USERS_TABLE                        = aws_dynamodb_table.users.name
      COUNTERS_TABLE                     = aws_dynamodb_table.counters.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "strategy_artifacts" {
  function_name = "${local.name_prefix}-strategy-artifacts"
  role          = aws_iam_role.strategy_artifacts_lambda.arn
  runtime       = "python3.12"
  handler       = "main.handler"

  filename         = data.archive_file.strategy_artifacts_lambda.output_path
  source_code_hash = data.archive_file.strategy_artifacts_lambda.output_base64sha256

  environment {
    variables = {
      STRATEGIES_TABLE                   = aws_dynamodb_table.strategies.name
      STRATEGY_ARTIFACTS_TABLE           = aws_dynamodb_table.strategy_artifacts.name
      STRATEGY_ARTIFACT_VERSIONS_TABLE   = aws_dynamodb_table.strategy_artifact_versions.name
      ARTIFACT_BUCKET                    = aws_s3_bucket.strategy_artifacts.bucket
      STRATEGIES_WRITE_PERMISSIONS_TABLE = aws_dynamodb_table.strategies_write_permissions.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "auth_granter" {
  function_name = "${local.name_prefix}-auth-granter"
  role          = aws_iam_role.auth_granter_lambda.arn
  runtime       = "python3.12"
  handler       = "main.handler"

  filename         = data.archive_file.auth_granter_lambda.output_path
  source_code_hash = data.archive_file.auth_granter_lambda.output_base64sha256

  layers = [
    aws_lambda_layer_version.pyjwt.arn,
    aws_lambda_layer_version.cryptography.arn,
  ]

  environment {
    variables = {
      CAS_CALLBACK_URL               = local.is_prod ? (local.api_custom_domain_activated ? "https://${var.api_custom_domain_name}/auth/callback" : "${trimsuffix(aws_apigatewayv2_stage.stage.invoke_url, "/")}/auth/callback") : "${trimsuffix(var.frontend_base_url, "/")}/api/auth/callback"
      FRONTEND_BASE_URL              = var.frontend_base_url
      JWT_PRIVATE_KEY_PARAMETER      = aws_ssm_parameter.jwt_private_key.name
      JWKS_BUCKET                    = aws_s3_bucket.jwks.bucket
      APP_ENV                        = var.env
      USERS_TABLE                    = aws_dynamodb_table.users.name
      USER_ACCESS_APPLICATIONS_TABLE = aws_dynamodb_table.user_access_applications.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "auth_checker" {
  function_name = "${local.name_prefix}-auth-checker"
  role          = aws_iam_role.auth_checker_lambda.arn
  runtime       = "python3.12"
  handler       = "main.handler"

  filename         = data.archive_file.auth_checker_lambda.output_path
  source_code_hash = data.archive_file.auth_checker_lambda.output_base64sha256

  layers = [
    aws_lambda_layer_version.pyjwt.arn,
    aws_lambda_layer_version.cryptography.arn,
  ]

  environment {
    variables = {
      USERS_TABLE = aws_dynamodb_table.users.name
      JWKS_BUCKET = aws_s3_bucket.jwks.bucket
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "jwt_key_rotator" {
  function_name = "${local.name_prefix}-jwt-key-rotator"
  role          = aws_iam_role.jwt_key_rotator_lambda.arn
  runtime       = "python3.12"
  handler       = "main.handler"

  filename         = data.archive_file.jwt_key_rotator_lambda.output_path
  source_code_hash = data.archive_file.jwt_key_rotator_lambda.output_base64sha256

  layers = [aws_lambda_layer_version.cryptography.arn]

  environment {
    variables = {
      JWT_PRIVATE_KEY_PARAMETER = aws_ssm_parameter.jwt_private_key.name
      JWKS_BUCKET               = aws_s3_bucket.jwks.bucket
    }
  }

  tags = local.tags
}

resource "aws_scheduler_schedule" "jwt_key_rotator_monthly" {
  name                         = "${local.name_prefix}-jwt-key-rotator-monthly"
  schedule_expression          = "cron(0 0 1 * ? *)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.jwt_key_rotator.arn
    role_arn = aws_iam_role.jwt_key_rotator_scheduler.arn
    input    = "{}"

    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts       = 5
    }
  }
}

resource "null_resource" "jwt_key_rotator_invoke" {
  triggers = {
    always_run = timestamp()
  }

  depends_on = [
    aws_lambda_function.jwt_key_rotator,
  ]

  provisioner "local-exec" {
    command = <<-EOT
      aws lambda invoke \
        --function-name "${aws_lambda_function.jwt_key_rotator.function_name}" \
        --region "${var.aws_region}" \
        --payload '{}' \
        --cli-binary-format raw-in-base64-out \
        /tmp/jwt-key-rotator.json
    EOT
  }
}

resource "aws_lambda_function" "admin" {
  function_name = "${local.name_prefix}-admin"
  role          = aws_iam_role.admin_lambda.arn
  runtime       = "python3.12"
  handler       = "main.handler"

  filename         = data.archive_file.admin_lambda.output_path
  source_code_hash = data.archive_file.admin_lambda.output_base64sha256

  environment {
    variables = {
      USERS_TABLE                    = aws_dynamodb_table.users.name
      USER_ACCESS_APPLICATIONS_TABLE = aws_dynamodb_table.user_access_applications.name
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "backtest_metrics" {
  function_name = "${local.name_prefix}-backtest-metrics"
  role          = aws_iam_role.backtest_metrics_lambda.arn
  runtime       = "python3.12"
  handler       = "main.handler"

  filename         = data.archive_file.backtest_metrics_lambda.output_path
  source_code_hash = data.archive_file.backtest_metrics_lambda.output_base64sha256

  layers = [aws_lambda_layer_version.wonderwords.arn]

  environment {
    variables = {
      BACKTEST_METRICS_TABLE             = aws_dynamodb_table.backtest_metrics.name
      BACKTESTS_BUCKET                   = aws_s3_bucket.backtest_metrics.bucket
      STRATEGIES_WRITE_PERMISSIONS_TABLE = aws_dynamodb_table.strategies_write_permissions.name
      STRATEGIES_TABLE                   = aws_dynamodb_table.strategies.name
    }
  }

  tags = local.tags
}

# ------------------------------
# API Gateway authorizer
# ------------------------------

resource "aws_apigatewayv2_authorizer" "auth_checker" {
  api_id                            = aws_apigatewayv2_api.api.id
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.auth_checker.invoke_arn
  authorizer_payload_format_version = "2.0"
  enable_simple_responses           = true

  authorizer_result_ttl_in_seconds = 300

  identity_sources = [
    "$request.header.Cookie",
  ]
  name = "${local.name_prefix}-auth-checker"
}

# ------------------------------
# API Gateway integration/routes for strategies lambda
# ------------------------------

resource "aws_apigatewayv2_integration" "get_strategies" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.strategies.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_strategies" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /strategies"
  target             = "integrations/${aws_apigatewayv2_integration.get_strategies.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "post_strategies" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "POST /strategies"
  target             = "integrations/${aws_apigatewayv2_integration.get_strategies.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "get_strategy_by_id" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /strategies/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.get_strategies.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "get_strategy_permissions" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /strategies/{id}/permissions"
  target             = "integrations/${aws_apigatewayv2_integration.get_strategies.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "patch_strategy_permissions" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "PATCH /strategies/{id}/permissions"
  target             = "integrations/${aws_apigatewayv2_integration.get_strategies.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "delete_strategy_permissions" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "DELETE /strategies/{id}/permissions"
  target             = "integrations/${aws_apigatewayv2_integration.get_strategies.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "get_users_search" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /users/search"
  target             = "integrations/${aws_apigatewayv2_integration.get_strategies.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_lambda_permission" "allow_apigw_invoke_strategies" {
  statement_id  = "AllowAPIGWInvokeStrategies"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.strategies.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ------------------------------
# API Gateway integration/routes for strategy_artifacts lambda
# ------------------------------

resource "aws_apigatewayv2_integration" "get_strategy_artifacts" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.strategy_artifacts.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_strategy_artifacts" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /strategies/{id}/artifacts"
  target             = "integrations/${aws_apigatewayv2_integration.get_strategy_artifacts.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "post_strategy_artifacts" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "POST /strategies/{id}/artifacts"
  target             = "integrations/${aws_apigatewayv2_integration.get_strategy_artifacts.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "get_strategy_artifact_by_id" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /strategies/{id}/artifacts/{artifactId}"
  target             = "integrations/${aws_apigatewayv2_integration.get_strategy_artifacts.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "get_strategy_write_permissions" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /strategies/{id}/permissions/write"
  target             = "integrations/${aws_apigatewayv2_integration.get_strategy_artifacts.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_lambda_permission" "allow_apigw_invoke_strategy_artifacts" {
  statement_id  = "AllowAPIGWInvokeStrategyArtifacts"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.strategy_artifacts.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ------------------------------
# API Gateway integration/routes for auth-granter lambda
# ------------------------------

resource "aws_apigatewayv2_integration" "auth_granter" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.auth_granter.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "auth_login" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /auth/login"
  target    = "integrations/${aws_apigatewayv2_integration.auth_granter.id}"
}

resource "aws_apigatewayv2_route" "auth_callback" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /auth/callback"
  target    = "integrations/${aws_apigatewayv2_integration.auth_granter.id}"
}

resource "aws_apigatewayv2_route" "auth_me" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /auth/me"
  target    = "integrations/${aws_apigatewayv2_integration.auth_granter.id}"
}

resource "aws_apigatewayv2_route" "auth_apply" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /auth/apply"
  target    = "integrations/${aws_apigatewayv2_integration.auth_granter.id}"
}

resource "aws_apigatewayv2_route" "auth_apply_check" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /auth/apply/check"
  target    = "integrations/${aws_apigatewayv2_integration.auth_granter.id}"
}

resource "aws_lambda_permission" "allow_apigw_invoke_auth_granter" {
  statement_id  = "AllowAPIGWInvokeAuthGranter"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_granter.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "allow_apigw_invoke_auth_checker" {
  statement_id  = "AllowAPIGWInvokeAuthChecker"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_checker.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/authorizers/*"
}

# ------------------------------
# API Gateway integration/routes for admin lambda
# ------------------------------

resource "aws_apigatewayv2_integration" "admin" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.admin.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_admin_users" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /admin/users"
  target             = "integrations/${aws_apigatewayv2_integration.admin.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "get_admin_user_by_netid" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /admin/users/{netid}"
  target             = "integrations/${aws_apigatewayv2_integration.admin.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "patch_admin_user_by_netid" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "PATCH /admin/users/{netid}"
  target             = "integrations/${aws_apigatewayv2_integration.admin.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "get_admin_access_requests" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /admin/access-requests"
  target             = "integrations/${aws_apigatewayv2_integration.admin.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "post_admin_access_requests_approve" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "POST /admin/access-requests/{netid}/approve"
  target             = "integrations/${aws_apigatewayv2_integration.admin.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "post_admin_access_requests_deny" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "POST /admin/access-requests/{netid}/deny"
  target             = "integrations/${aws_apigatewayv2_integration.admin.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_lambda_permission" "allow_apigw_invoke_admin" {
  statement_id  = "AllowAPIGWInvokeAdmin"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.admin.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ------------------------------
# API Gateway integration/routes for backtest_metrics lambda
# ------------------------------

resource "aws_apigatewayv2_integration" "backtest_metrics" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.backtest_metrics.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post_strategy_backtests_presign" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "POST /strategies/{id}/backtests/presign"
  target             = "integrations/${aws_apigatewayv2_integration.backtest_metrics.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "get_strategy_backtests" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /strategies/{id}/backtests"
  target             = "integrations/${aws_apigatewayv2_integration.backtest_metrics.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "post_strategy_backtests" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "POST /strategies/{id}/backtests"
  target             = "integrations/${aws_apigatewayv2_integration.backtest_metrics.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "get_strategy_backtest_by_id" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /strategies/{id}/backtests/{backtestId}"
  target             = "integrations/${aws_apigatewayv2_integration.backtest_metrics.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_lambda_permission" "allow_apigw_invoke_backtest_metrics" {
  statement_id  = "AllowAPIGWInvokeBacktestMetrics"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backtest_metrics.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
