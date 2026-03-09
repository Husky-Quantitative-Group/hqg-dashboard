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

variable "jwks_bucket_name" {
  description = "Optional explicit name for the JWKS bucket. Defaults to \"<project>-<env>-jwks-<random>\"."
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

variable "counters_table_name" {
  description = "Optional explicit name for the Counters table. Defaults to \"<project>-<env>-counters\"."
  type        = string
  default     = null
}

variable "tags" {
  description = "Additional tags to apply to resources."
  type        = map(string)
  default     = {}
}

variable "frontend_base_url" {
  description = "Base URL for the frontend app (used for auth redirects)."
  type        = string
}

variable "api_custom_domain_name" {
  description = "Optional custom domain for the HTTP API (for example: api.uconnquant.com)."
  type        = string
  default     = null
}

variable "api_custom_domain_activate" {
  description = "Set true after ACM DNS validation records are in DNS and the certificate is issued."
  type        = bool
  default     = false
}
