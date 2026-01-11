terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # TODO: switch to remote state (S3 + DynamoDB lock table) before multi-user use.
  # backend "s3" {}
}

provider "aws" {
  region = var.aws_region
}

locals {
  name_prefix                      = "${var.project}-${var.env}"
  artifacts_bucket_name            = coalesce(var.artifacts_bucket_name, "${local.name_prefix}-strategy-artifacts")
  strategies_table_name            = coalesce(var.strategies_table_name, "${local.name_prefix}-strategies")
  strategy_artifacts_table_name    = coalesce(var.strategy_artifacts_table_name, "${local.name_prefix}-strategy-artifacts")
  strategy_artifact_versions_table = coalesce(var.strategy_artifact_versions_table_name, "${local.name_prefix}-strategy-artifact-versions")

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
  bucket = local.artifacts_bucket_name

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

resource "aws_s3_bucket_cors_configuration" "strategy_artifacts" {
  bucket = aws_s3_bucket.strategy_artifacts.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = ["*"]
    max_age_seconds = 300
  }
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
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:DescribeTable",
    ]

    resources = [
      aws_dynamodb_table.strategies.arn,
      aws_dynamodb_table.strategy_artifacts.arn,
      aws_dynamodb_table.strategy_artifact_versions.arn,
    ]
  }
}

resource "aws_iam_policy" "strategy_storage" {
  name   = "${local.name_prefix}-strategy-storage"
  policy = data.aws_iam_policy_document.strategy_storage.json

  tags = local.tags
}

# ------------------------------
# API Gateway (HTTP API) scaffold
# ------------------------------

resource "aws_apigatewayv2_api" "api" {
  name          = "${local.name_prefix}-http-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["content-type", "x-api-token", "authorization"]
    allow_methods = ["OPTIONS", "GET", "POST", "PATCH"]
    allow_origins = ["*"]
    max_age       = 300
  }

  tags = local.tags
}

resource "aws_apigatewayv2_stage" "dev" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "dev"
  auto_deploy = true

  # Add throttling/logging/etc. route settings here if needed.
  # default_route_settings {
  #   throttling_burst_limit = 10
  #   throttling_rate_limit  = 20
  # }

  tags = local.tags
}

# TODO: Add integrations and routes for strategies/artifacts lambdas here.
