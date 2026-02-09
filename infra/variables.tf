variable "project" {
  description = "Project or application name for naming/tagging."
  type        = string
}

variable "env" {
  description = "Environment identifier (e.g., dev, staging, prod)."
  type        = string
}

variable "aws_region" {
  description = "AWS region to deploy resources into."
  type        = string
}

variable "artifacts_bucket_name" {
  description = "Optional explicit name for the artifacts bucket. Defaults to \"<project>-<env>-strategy-artifacts\"."
  type        = string
  default     = null
}

variable "backtests_bucket_name" {
  description = "Optional explicit name for the backtests bucket. Defaults to \"<project>-<env>-backtest-metrics\"."
  type        = string
  default     = null
}

variable "strategies_table_name" {
  description = "Optional explicit name for the Strategies table. Defaults to \"<project>-<env>-strategies\"."
  type        = string
  default     = null
}

variable "strategy_artifacts_table_name" {
  description = "Optional explicit name for the StrategyArtifacts table. Defaults to \"<project>-<env>-strategy-artifacts\"."
  type        = string
  default     = null
}

variable "strategy_artifact_versions_table_name" {
  description = "Optional explicit name for the StrategyArtifactVersions table. Defaults to \"<project>-<env>-strategy-artifact-versions\"."
  type        = string
  default     = null
}

variable "users_table_name" {
  description = "Optional explicit name for the Users table. Defaults to \"<project>-<env>-users\"."
  type        = string
  default     = null
}

variable "user_access_applications_table_name" {
  description = "Optional explicit name for the UserAccessApplications table. Defaults to \"<project>-<env>-user-access-applications\"."
  type        = string
  default     = null
}

variable "backtest_metrics_table_name" {
  description = "Optional explicit name for the BacktestMetrics table. Defaults to \"<project>-<env>-backtest-metrics\"."
  type        = string
  default     = null
}

variable "tags" {
  description = "Additional tags to apply to resources."
  type        = map(string)
  default     = {}
}

variable "api_token" {
  description = "Shared secret for Lambda auth (x-api-token)."
  type        = string
  sensitive   = true
}

variable "frontend_base_url" {
  description = "Base URL for the frontend app (used for auth redirects)."
  type        = string
}

variable "jwt_secret" {
  description = "Secret for JWT encoding and decoding"
  type        = string
}
