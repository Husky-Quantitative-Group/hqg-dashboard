# Prod Deployment — HQG Dashboard

Use this runbook to deploy `prod` from a fresh clone.

## 1) Clone the repo

```bash
git clone https://github.com/Husky-Quantitative-Group/hqg-dashboard.git
cd hqg-dashboard
```

## 2) Install required tools

- AWS CLI
- Terraform `>= 1.5`
- Python 3 + pip (for seed script)
- IAM principal used by `hqg-prod` must include permissions in `infra/deploy_iam_policy.json`

## 3) Create and verify AWS profile

Create profile:

```bash
aws configure --profile hqg-prod
aws configure set region us-east-1 --profile hqg-prod
```

Verify credentials:

```bash
AWS_PROFILE=hqg-prod aws sts get-caller-identity
```

## 4) Create Terraform backend resources (one-time in prod account)

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

If these already exist, AWS will return `BucketAlreadyOwnedByYou` / `ResourceInUseException`; that is fine, continue.

## 5) Create local backend config in `infra/`

`infra/backend.tf`:

```
terraform {
  backend "s3" {}
}
```

`infra/backend.hcl`:

```
bucket         = "hqg-prod-terraform-state-<your-account-id>"
key            = "hqg-prod-dashboard/prod/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "hqg-prod-terraform-locks"
encrypt        = true
```

Replace `<your-account-id>` with the account from step 4.

In the original prod version, we dropped the account id.

## 6) Build Lambda layer artifacts

From repo root:

```bash
bash infra/scripts/build_layers.sh
```

## 7) Configure prod tfvars

Create/edit `infra/prod.tfvars`:

```hcl
project                    = "hqg"
env                        = "prod"
aws_region                 = "us-east-1"
frontend_base_url          = "https://dashboard.uconnquant.com"
api_custom_domain_name     = "api.uconnquant.com"
api_custom_domain_activate = false
```

## 8) Initialize Terraform

```bash
AWS_PROFILE=hqg-prod terraform -chdir=infra init -reconfigure -backend-config=backend.hcl
```

## 9) One-time custom domain + CNAME setup (do once)

This section is only for initial setup of `api.uconnquant.com`. After this is done, use step 10 for normal deploys.

Run first apply with `api_custom_domain_activate = false` to request the ACM cert:

```bash
AWS_PROFILE=hqg-prod terraform -chdir=infra plan -var-file=prod.tfvars
AWS_PROFILE=hqg-prod terraform -chdir=infra apply -var-file=prod.tfvars
```

Get ACM validation records:

```bash
terraform -chdir=infra output -json api_custom_domain_validation_records
```

In Squarespace DNS, add one CNAME per record:

- Type: `CNAME`
- Host: `record_name` (if Squarespace expects relative host, drop `.uconnquant.com` and trailing `.`)
- Data: `record_value` (trailing `.` is optional)

Wait for cert status `ISSUED` in ACM (`us-east-1`):

```bash
AWS_PROFILE=hqg-prod aws acm list-certificates --region us-east-1
AWS_PROFILE=hqg-prod aws acm describe-certificate --region us-east-1 --certificate-arn <arn>
```

Then set in `infra/prod.tfvars`:

```hcl
api_custom_domain_activate = true
```

Apply again:

```bash
AWS_PROFILE=hqg-prod terraform -chdir=infra apply -var-file=prod.tfvars
```

Get API Gateway domain target:

```bash
AWS_PROFILE=hqg-prod terraform -chdir=infra output -raw api_custom_domain_target
```

Create final API DNS record in Squarespace:

- Type: `CNAME`
- Host: `api`
- Data: `<value from api_custom_domain_target>`

## 10) Normal prod deploy (recurring)

After one-time domain setup is complete, use this for normal deploys:

```bash
AWS_PROFILE=hqg-prod terraform -chdir=infra plan -var-file=prod.tfvars
AWS_PROFILE=hqg-prod terraform -chdir=infra apply -var-file=prod.tfvars
```


## 11) Verify endpoint

```bash
dig +short api.uconnquant.com CNAME
curl -i https://api.uconnquant.com
```

## 12) Seed initial data (first deploy only)

```bash
python3 -m pip install --user boto3

AWS_PROFILE=hqg-prod python3 infra/seed/main.py \
  --bucket "$(terraform -chdir=infra output -raw artifacts_bucket_name)" \
  --backtests-bucket "$(terraform -chdir=infra output -raw backtests_bucket_name)" \
  --strategies-table "$(terraform -chdir=infra output -raw strategies_table_name)" \
  --artifacts-table "$(terraform -chdir=infra output -raw strategy_artifacts_table_name)" \
  --artifact-versions-table "$(terraform -chdir=infra output -raw strategy_artifact_versions_table_name)" \
  --strategy-backtests-table "$(terraform -chdir=infra output -raw strategy_backtests_table_name)" \
  --backtester-url "http://localhost:8005" \
  --users-table "$(terraform -chdir=infra output -raw users_table_name)" \
  --admin-netid "<your-netid>" \
  --region us-east-1
# Optional: --skip-backtests
```

Add `--skip-backtests` to the command if you want to seed strategies/artifacts/users without generating backtest runs.

## 13) Frontend wiring (if needed)

If your frontend should call this prod API directly (without local Vite proxy), set:

```ini
CORE_API_URL=https://api.uconnquant.com
IS_PROD=1
```

