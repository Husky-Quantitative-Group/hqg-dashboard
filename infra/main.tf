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

# ------------------------------
# Lambda packaging and deployment
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

resource "aws_iam_role_policy_attachment" "strategies_lambda_basic_logs" {
  role       = aws_iam_role.strategies_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "strategies_lambda_storage" {
  role       = aws_iam_role.strategies_lambda.name
  policy_arn = aws_iam_policy.strategy_storage.arn
}

resource "aws_iam_role_policy_attachment" "strategy_artifacts_lambda_basic_logs" {
  role       = aws_iam_role.strategy_artifacts_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "strategy_artifacts_lambda_storage" {
  role       = aws_iam_role.strategy_artifacts_lambda.name
  policy_arn = aws_iam_policy.strategy_storage.arn
}

resource "aws_lambda_function" "strategies" {
  function_name = "${local.name_prefix}-strategies"
  role          = aws_iam_role.strategies_lambda.arn
  runtime       = "python3.11"
  handler       = "main.handler"

  filename         = data.archive_file.strategies_lambda.output_path
  source_code_hash = data.archive_file.strategies_lambda.output_base64sha256

  environment {
    variables = {
      STRATEGIES_TABLE                 = aws_dynamodb_table.strategies.name
      STRATEGY_ARTIFACTS_TABLE         = aws_dynamodb_table.strategy_artifacts.name
      STRATEGY_ARTIFACT_VERSIONS_TABLE = aws_dynamodb_table.strategy_artifact_versions.name
      ARTIFACT_BUCKET                  = aws_s3_bucket.strategy_artifacts.bucket
      API_TOKEN                        = var.api_token
    }
  }

  tags = local.tags
}

resource "aws_lambda_function" "strategy_artifacts" {
  function_name = "${local.name_prefix}-strategy-artifacts"
  role          = aws_iam_role.strategy_artifacts_lambda.arn
  runtime       = "python3.11"
  handler       = "main.handler"

  filename         = data.archive_file.strategy_artifacts_lambda.output_path
  source_code_hash = data.archive_file.strategy_artifacts_lambda.output_base64sha256

  environment {
    variables = {
      STRATEGIES_TABLE                  = aws_dynamodb_table.strategies.name
      STRATEGY_ARTIFACTS_TABLE          = aws_dynamodb_table.strategy_artifacts.name
      STRATEGY_ARTIFACT_VERSIONS_TABLE  = aws_dynamodb_table.strategy_artifact_versions.name
      ARTIFACT_BUCKET                   = aws_s3_bucket.strategy_artifacts.bucket
      API_TOKEN                         = var.api_token
    }
  }

  tags = local.tags
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
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /strategies"
  target    = "integrations/${aws_apigatewayv2_integration.get_strategies.id}"
}

resource "aws_apigatewayv2_route" "post_strategies" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /strategies"
  target    = "integrations/${aws_apigatewayv2_integration.get_strategies.id}"
}

resource "aws_apigatewayv2_route" "get_strategy_by_id" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /strategies/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.get_strategies.id}"
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
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /strategies/{id}/artifacts"
  target    = "integrations/${aws_apigatewayv2_integration.get_strategy_artifacts.id}"
}

resource "aws_lambda_permission" "allow_apigw_invoke_strategy_artifacts" {
  statement_id  = "AllowAPIGWInvokeStrategyArtifacts"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.strategy_artifacts.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
