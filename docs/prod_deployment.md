# Prod Deployment (This Repo)

Use this to deploy the `prod` environment from a fresh clone.

RECOMMENDED: Create a new local repository for deployment.

## Prerequisites

- AWS profile configured: `hqg-prod`
- Terraform `>= 1.5`
- IAM permissions for:
  - Terraform backend resources (S3 + DynamoDB)
  - Infra resources in `infra/main.tf`

## 1) Verify AWS profile

```bash
AWS_PROFILE=hqg-prod aws sts get-caller-identity
```

## 2) Create backend resources (one time, prod account)

```bash
export AWS_PROFILE=hqg-prod
export AWS_REGION=us-east-1
export ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export STATE_BUCKET="hqg-prod-terraform-state-${ACCOUNT_ID}"
export LOCK_TABLE="hqg-prod-terraform-locks"

aws s3api create-bucket --bucket "${STATE_BUCKET}" --region "${AWS_REGION}"
aws s3api put-bucket-versioning \
  --bucket "${STATE_BUCKET}" \
  --versioning-configuration Status=Enabled

aws dynamodb create-table \
  --table-name "${LOCK_TABLE}" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "${AWS_REGION}"
```

## 3) Create local backend files in `infra/`

`infra/backend.tf`:

```
terraform {
  backend "s3" {}
}
```

`infra/backend.hcl`:

```
bucket         = "hqg-prod-terraform-state"
key            = "hqg-prod-dashboard/prod/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "hqg-prod-terraform-locks"
encrypt        = true
```

Note: `backend.tf` and `backend.hcl` are gitignored in this repo.

## 4) Initialize Terraform backend and workspace

```bash
AWS_PROFILE=hqg-prod terraform -chdir=infra init -reconfigure -backend-config=backend.hcl
```

## 5) Deploy prod infra

Check `infra/prod.tfvars`:
- `env = "prod"`
- `aws_region = "us-east-1"`
- `frontend_base_url` set for prod
- `api_custom_domain_name = "api.uconnquant.com"`
- `api_custom_domain_activate = false` for first apply

First apply (requests ACM cert and prints validation records):

```bash
AWS_PROFILE=hqg-prod terraform -chdir=infra plan -var-file=prod.tfvars
AWS_PROFILE=hqg-prod terraform -chdir=infra apply -var-file=prod.tfvars
```

## 6) Validate cert in Squarespace and activate custom domain

Get the ACM DNS validation records:

```bash
terraform -chdir=infra output api_custom_domain_validation_records
```

In Squarespace DNS, create each CNAME from that output.

After ACM shows the certificate as `ISSUED`, set `api_custom_domain_activate = true` in `infra/prod.tfvars`, then apply again:

```bash
AWS_PROFILE=hqg-prod terraform -chdir=infra apply -var-file=prod.tfvars
```

Get the API Gateway target and add your production CNAME:
- Type: `CNAME`
- Host: `api`
- Target: `terraform -chdir=infra output -raw api_custom_domain_target`

## 7) Seed initial data (first deploy only)

```bash
python3 -m pip install --user boto3

AWS_PROFILE=hqg-prod python3 infra/seed/main.py \
  --bucket "$(terraform -chdir=infra output -raw artifacts_bucket_name)" \
  --strategies-table "$(terraform -chdir=infra output -raw strategies_table_name)" \
  --artifacts-table "$(terraform -chdir=infra output -raw strategy_artifacts_table_name)" \
  --artifact-versions-table "$(terraform -chdir=infra output -raw strategy_artifact_versions_table_name)" \
  --users-table "$(terraform -chdir=infra output -raw users_table_name)" \
  --admin-netid "<your-netid>" \
  --region us-east-1
```
