project           = "hqg"
env               = "dev"
aws_region        = "us-east-1"
frontend_base_url = "http://localhost:5173"

# api_custom_domain_name = "api.example.com" # normally set only in prod tfvars
# api_custom_domain_activate = false

# Optional overrides (uncomment to set explicit names)
# artifacts_bucket_name                 = "strategy-artifacts"
# jwks_bucket_name                      = "hqg-dev-jwks-abcdef12"
# strategies_table_name                 = "hqg-dev-strategies"
# strategy_artifacts_table_name         = "hqg-dev-strategy-artifacts"
# strategy_artifact_versions_table_name = "hqg-dev-strategy-artifact-versions"
# users_table_name                      = "hqg-dev-users"
# user_access_applications_table_name   = "hqg-dev-user-access-applications"
# backtest_metrics_table_name           = "hqg-dev-backtest-metrics"

tags = {
  Owner = "hqg-team"
}
