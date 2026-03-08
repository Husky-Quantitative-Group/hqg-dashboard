output "artifacts_bucket_name" {
  value       = aws_s3_bucket.strategy_artifacts.bucket
  description = "Name of the S3 bucket storing strategy artifacts."
}

output "artifacts_bucket_arn" {
  value       = aws_s3_bucket.strategy_artifacts.arn
  description = "ARN of the artifacts bucket."
}

output "backtests_bucket_name" {
  value       = aws_s3_bucket.backtest_metrics.bucket
  description = "Name of the S3 bucket storing backtest metrics."
}

output "backtests_bucket_arn" {
  value       = aws_s3_bucket.backtest_metrics.arn
  description = "ARN of the backtests bucket."
}

output "jwks_object_url" {
  value       = "https://${aws_s3_bucket.jwks.bucket}.s3.${var.aws_region}.amazonaws.com/.well-known/jwks.json"
  description = "Public URL for the JWKS JSON object."
}

output "strategies_table_name" {
  value       = aws_dynamodb_table.strategies.name
  description = "Name of the Strategies table."
}

output "strategies_table_arn" {
  value       = aws_dynamodb_table.strategies.arn
  description = "ARN of the Strategies table."
}

output "strategy_artifacts_table_name" {
  value       = aws_dynamodb_table.strategy_artifacts.name
  description = "Name of the StrategyArtifacts table."
}

output "strategy_artifacts_table_arn" {
  value       = aws_dynamodb_table.strategy_artifacts.arn
  description = "ARN of the StrategyArtifacts table."
}

output "strategy_artifact_versions_table_name" {
  value       = aws_dynamodb_table.strategy_artifact_versions.name
  description = "Name of the StrategyArtifactVersions table."
}

output "strategy_artifact_versions_table_arn" {
  value       = aws_dynamodb_table.strategy_artifact_versions.arn
  description = "ARN of the StrategyArtifactVersions table."
}

output "users_table_name" {
  value       = aws_dynamodb_table.users.name
  description = "Name of the Users table."
}

output "users_table_arn" {
  value       = aws_dynamodb_table.users.arn
  description = "ARN of the Users table."
}

output "user_access_applications_table_name" {
  value       = aws_dynamodb_table.user_access_applications.name
  description = "Name of the UserAccessApplications table."
}

output "user_access_applications_table_arn" {
  value       = aws_dynamodb_table.user_access_applications.arn
  description = "ARN of the UserAccessApplications table."
}

output "backtest_metrics_table_name" {
  value       = aws_dynamodb_table.backtest_metrics.name
  description = "Name of the BacktestMetrics table."
}

output "backtest_metrics_table_arn" {
  value       = aws_dynamodb_table.backtest_metrics.arn
  description = "ARN of the BacktestMetrics table."
}

output "counters_table_name" {
  value       = aws_dynamodb_table.counters.name
  description = "Name of the Counters table."
}

output "http_api_id" {
  value       = aws_apigatewayv2_api.api.id
  description = "ID of the HTTP API Gateway."
}

output "http_api_endpoint" {
  value       = aws_apigatewayv2_stage.stage.invoke_url
  description = "Invoke URL for the HTTP API stage."
}

output "api_custom_domain_validation_records" {
  value = local.api_custom_domain_requested ? [
    for dvo in aws_acm_certificate.api_custom_domain[0].domain_validation_options : {
      domain_name  = dvo.domain_name
      record_name  = dvo.resource_record_name
      record_type  = dvo.resource_record_type
      record_value = dvo.resource_record_value
    }
  ] : []
  description = "DNS validation records for the API custom-domain ACM certificate (prod only)."
}

output "api_custom_domain_target" {
  value       = local.api_custom_domain_activated ? aws_apigatewayv2_domain_name.api_custom_domain[0].domain_name_configuration[0].target_domain_name : null
  description = "Target value for your DNS CNAME record (prod only)."
}
