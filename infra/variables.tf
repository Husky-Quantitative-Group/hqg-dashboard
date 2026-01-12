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
