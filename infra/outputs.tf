output "artifacts_bucket_name" {
  value       = aws_s3_bucket.strategy_artifacts.bucket
  description = "Name of the S3 bucket storing strategy artifacts."
}

output "artifacts_bucket_arn" {
  value       = aws_s3_bucket.strategy_artifacts.arn
  description = "ARN of the artifacts bucket."
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

output "http_api_id" {
  value       = aws_apigatewayv2_api.api.id
  description = "ID of the HTTP API Gateway."
}

output "http_api_endpoint" {
  value       = aws_apigatewayv2_stage.dev.invoke_url
  description = "Invoke URL for the HTTP API stage."
}
