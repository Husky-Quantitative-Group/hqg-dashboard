# Terraform Remote State Setup (hqg-prod)

This guide explains the minimal setup for using an S3 backend for `hqg-prod`, while keeping backend config optional and local-only.

## Core model

- `AWS_PROFILE` selects credentials/account.
- Terraform backend selects where state is stored.
- Terraform workspace selects logical state within that backend.
- `-var-file` selects environment values (`prod.tfvars`, `dev.tfvars`).

## Prerequisites

- Terraform `>= 1.5`
- AWS CLI configured with a prod profile (example: `hqg-prod`)
- IAM permissions to create/read/write:
  - S3 backend bucket
  - DynamoDB lock table
  - Infra resources in `infra/main.tf`

## 1) Create backend resources (once, in prod account)

Use your prod profile:

```bash
AWS_PROFILE=hqg-prod aws s3api create-bucket \
  --bucket hqg-prod-terraform-state \
  --region us-east-1

AWS_PROFILE=hqg-prod aws s3api put-bucket-versioning \
  --bucket hqg-prod-terraform-state \
  --versioning-configuration Status=Enabled

AWS_PROFILE=hqg-prod aws dynamodb create-table \
  --table-name hqg-prod-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

## 2) Local-only backend files

In this repo, `infra/backend.tf` and `infra/backend.hcl` are gitignored. That keeps backend setup optional for each developer.

Create `infra/backend.tf` locally:

```
terraform {
  backend "s3" {}
}
```

Create `infra/backend.hcl` locally for prod:

```
bucket         = "hqg-prod-terraform-state"
key            = "hqg-prod-dashboard/prod/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "hqg-prod-terraform-locks"
encrypt        = true
```

## 3) Initialize Terraform to prod backend

```bash
AWS_PROFILE=hqg-prod terraform -chdir=infra init -reconfigure -backend-config=backend.hcl
```

If prod has never been deployed before, no state migration is needed.

## 4) Create/select workspace and deploy prod

```bash
AWS_PROFILE=hqg-prod terraform -chdir=infra workspace new prod
# if it already exists:
# AWS_PROFILE=hqg-prod terraform -chdir=infra workspace select prod

AWS_PROFILE=hqg-prod terraform -chdir=infra plan -var-file=prod.tfvars
AWS_PROFILE=hqg-prod terraform -chdir=infra apply -var-file=prod.tfvars
```

## 5) Switching environments safely

For dev in the same backend, use a different key or workspace.

Minimal approach:
- same `backend.hcl`
- workspace `dev`
- `-var-file=dev.tfvars`

Commands:

```bash
AWS_PROFILE=hqg-prod terraform -chdir=infra workspace select dev
AWS_PROFILE=hqg-prod terraform -chdir=infra plan -var-file=dev.tfvars
```

## 6) Different AWS accounts

If team members deploy to different AWS accounts, each account must have separate state location.

Recommended:
- one backend config file per target account/env
- one profile per account

Example:
- `infra/backend-prod-accountA.hcl`
- `infra/backend-prod-accountB.hcl`

Switch target:

```bash
AWS_PROFILE=<profile> terraform -chdir=infra init -reconfigure -backend-config=<backend-file>.hcl
```

Then select workspace and run plan/apply.

## Common checks

List profiles:

```bash
aws configure list-profiles
```

Check active identity:

```bash
AWS_PROFILE=hqg-prod aws sts get-caller-identity
```

List workspaces:

```bash
terraform -chdir=infra workspace list
```
