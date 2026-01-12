## HQG Infrastructure (Terraform)

This module currently provisions only the storage layer for strategies:

- S3 bucket for versioned artifacts.
- DynamoDB tables for strategies, artifacts, and per-file artifact versions.

### Files
- `main.tf` – providers, locals, and storage resources.
- `variables.tf` – inputs (project/env/region and optional name overrides).
- `outputs.tf` – exported names/ARNs.
- `example.tfvars` – starter values; copy to your own `*.tfvars`.

### Usage
```bash
cd infra
terraform init
terraform plan -var-file="example.tfvars"
terraform apply -var-file="example.tfvars"
```

### Inputs (key ones)
- `project` / `env` – used for naming and tagging (`<project>-<env>-...`).
- `aws_region` – region to deploy into.
- `api_token` – shared secret passed to lambdas for `x-api-token` checks.
- Optional `*_name` vars let you override resource names if needed.

### Resources (names default to `<project>-<env>-...`)
- S3 bucket: `strategy-artifacts` (versioning + SSE + public access block + basic CORS GET/PUT/HEAD).
- DynamoDB `Strategies` table: PK `id`.
- DynamoDB `StrategyArtifacts` table: PK `strategy_id`, SK `artifact_id`.
- DynamoDB `StrategyArtifactVersions` table: PK `strategy_artifact_id`, SK `strategy_version` (Number).

### Seeding a root strategy
`infra/seed/main.py` can preload a root strategy (id `1`, entrypoint `main.py`, version `1`) into the bucket and tables. Seeded file contents live in `infra/seed/files/`.

Example:
```bash
python infra/seed/main.py \
  --bucket hqg-dev-strategy-artifacts \
  --strategies-table hqg-dev-strategies \
  --artifacts-table hqg-dev-strategy-artifacts \
  --artifact-versions-table hqg-dev-strategy-artifact-versions \
  --region us-east-1
```

Files uploaded (under `strategies/1/v1/`): `main.py`, `README.md`, `requirements.txt`.
Corresponding items are written to all three DynamoDB tables.

### Notes
- State is local; switch to an S3 backend before multi-user usage.
- All resources have PITR + SSE enabled on DynamoDB; tags merge `Project`, `Env`, and any provided `tags`.
