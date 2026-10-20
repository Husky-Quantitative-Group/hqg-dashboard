# Account control and registered strategy packages. No account or broker is provisioned automatically.
resource "aws_dynamodb_table" "engine_accounts" {
  name         = "${local.name_prefix}-engine-accounts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "account_id"
  range_key    = "record"
  attribute {
    name = "account_id"
    type = "S"
  }
  attribute {
    name = "record"
    type = "S"
  }
  point_in_time_recovery {
    enabled = true
  }
  tags = local.tags
}

data "archive_file" "accounts_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../aws/lambdas/accounts"
  output_path = "${path.module}/dist/accounts-lambda.zip"
  excludes    = ["__pycache__"]
}

resource "aws_iam_role" "accounts_lambda" {
  name               = "${local.name_prefix}-accounts-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "accounts_logs" {
  role       = aws_iam_role.accounts_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "accounts_storage" {
  role = aws_iam_role.accounts_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:ConditionCheckItem"]
      Resource = aws_dynamodb_table.engine_accounts.arn
      }, {
      Effect = "Allow"
      Action = ["dynamodb:GetItem", "dynamodb:Query"]
      Resource = [
        aws_dynamodb_table.strategies.arn,
        aws_dynamodb_table.strategy_artifacts.arn,
        aws_dynamodb_table.strategy_artifact_versions.arn,
        aws_dynamodb_table.strategies_read_permissions.arn,
        aws_dynamodb_table.strategies_write_permissions.arn,
      ]
      }, {
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:GetObjectVersion"]
      Resource = "${aws_s3_bucket.strategy_artifacts.arn}/*"
      }, {
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "${aws_s3_bucket.strategy_artifacts.arn}/engine-packages/*"
    }]
  })
}

variable "engine_control_readiness_url" {
  type        = string
  default     = ""
  description = "HTTPS platform /control/accounts/{accountId}/readiness URL for the manually provisioned account. Empty denies permission."
}

variable "engine_control_readiness_token" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Account-scoped service credential for the control readiness probe."
}

resource "aws_lambda_function" "accounts" {
  function_name    = "${local.name_prefix}-accounts"
  role             = aws_iam_role.accounts_lambda.arn
  runtime          = "python3.12"
  handler          = "main.handler"
  timeout          = 10
  filename         = data.archive_file.accounts_lambda.output_path
  source_code_hash = data.archive_file.accounts_lambda.output_base64sha256
  layers           = [aws_lambda_layer_version.hqg_permissions.arn]
  environment {
    variables = {
      ACCOUNTS_TABLE                     = aws_dynamodb_table.engine_accounts.name
      STRATEGIES_TABLE                   = aws_dynamodb_table.strategies.name
      STRATEGY_ARTIFACTS_TABLE           = aws_dynamodb_table.strategy_artifacts.name
      STRATEGY_ARTIFACT_VERSIONS_TABLE   = aws_dynamodb_table.strategy_artifact_versions.name
      STRATEGIES_READ_PERMISSIONS_TABLE  = aws_dynamodb_table.strategies_read_permissions.name
      STRATEGIES_WRITE_PERMISSIONS_TABLE = aws_dynamodb_table.strategies_write_permissions.name
      ARTIFACT_BUCKET                    = aws_s3_bucket.strategy_artifacts.bucket
      CONTROL_READINESS_URL              = var.engine_control_readiness_url
      CONTROL_READINESS_CONTENT          = "hqg-account-control-ready"
      CONTROL_READINESS_TOKEN            = var.engine_control_readiness_token
      WEBSITE_READINESS_URL              = var.engine_frontend_readiness_url
      WEBSITE_READINESS_CONTENT          = "hqg-dashboard-app"
    }
  }
  tags = local.tags
}

resource "aws_apigatewayv2_integration" "accounts" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.accounts.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "account_actions" {
  for_each = toset([
    "PUT /accounts/{accountId}/configuration",
    "POST /accounts/{accountId}/actions",
    "GET /accounts/{accountId}/status",
    "POST /accounts/{accountId}/strategies",
  ])
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.accounts.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_checker.id
}

resource "aws_apigatewayv2_route" "account_sync" {
  for_each = toset([
    "POST /internal/v1/accounts/{accountId}/sync",
    "GET /internal/v1/accounts/{accountId}/readiness",
    "GET /internal/v1/accounts/{accountId}/strategy-packages/{sourceDigest}",
  ])
  api_id    = aws_apigatewayv2_api.api.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.accounts.id}"
  # The handler validates the account-scoped service credential.
}

resource "aws_lambda_permission" "accounts_gateway" {
  statement_id  = "AllowAPIGWInvokeAccounts"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.accounts.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

output "engine_accounts_table" {
  value = aws_dynamodb_table.engine_accounts.name
}

variable "engine_frontend_readiness_url" {
  type        = string
  default     = ""
  description = "Reachable HTTPS frontend or development tunnel, separate from login/CORS origin. Empty denies execution."
}
