# Local Setup — HQG Dashboard

This repo has two main parts:
- `frontend/` for the React Router UI
- `infra/` + `aws/` for the AWS infrastructure and Lambda APIs

## Prerequisites
- Node.js + npm (LTS) for the frontend: https://nodejs.org/en/download
- Terraform (>= 1.5) for infra work: https://developer.hashicorp.com/terraform/downloads
- AWS credentials for Terraform: https://developer.hashicorp.com/terraform/language/providers/aws#authentication

## 1) Infra (AWS / Terraform)

If you already have a deployed API, you can skip this section and just set `VITE_CORE_API` in `frontend/.env`.

### Create your tfvars file
```bash
cp infra/example.tfvars infra/dev.tfvars
```

Edit `infra/dev.tfvars` with your values:
- `project`, `env`, `aws_region`
- `api_token` (shared secret required by the API)
- `frontend_base_url` (CORS / allowed origin)
- `jwt_secret` (used for JWT signing)

You can use https://jwtsecretkeygenerator.com/ to generate a JWT secret.

### Build Lambda Layers
This repository uses AWS Lambda Layers to manage Python dependencies that are shared across Lambdas (for example, JWT libraries).

This step is only required when you add/update any lambda layers in `/aws/lambda_layers`.

```bash
bash scripts/build_layers.sh
```

### Init / plan / apply
Deploy the infrastructure.
```bash
cd infra
terraform init # only needed once
terraform plan -var-file=dev.tfvars
terraform apply -var-file=dev.tfvars # same as plan, but with option to deploy
```

### Seed data (required on first deploy)
Seeding is required the first time you create a new stack.

```bash
python3 -m pip install --user boto3
python3 seed/main.py \
  --bucket "$(terraform output -raw artifacts_bucket_name)" \
  --strategies-table "$(terraform output -raw strategies_table_name)" \
  --artifacts-table "$(terraform output -raw strategy_artifacts_table_name)" \
  --artifact-versions-table "$(terraform output -raw strategy_artifact_versions_table_name)" \
  --region us-east-1
```

Run this from the `infra/` directory and use the same region as `aws_region` in `dev.tfvars`.

Optional: seed your NetID as an admin user to skip the apply flow.
```bash
python3 seed/main.py \
  --bucket "$(terraform output -raw artifacts_bucket_name)" \
  --strategies-table "$(terraform output -raw strategies_table_name)" \
  --artifacts-table "$(terraform output -raw strategy_artifacts_table_name)" \
  --artifact-versions-table "$(terraform output -raw strategy_artifact_versions_table_name)" \
  --users-table "$(terraform output -raw users_table_name)" \
  --admin-netid "YOUR_NETID" \
  --region us-east-1
```

### Tear down
```bash
terraform destroy -var-file=dev.tfvars
```

### Seeding

```bash
python infra/seed/main.py \
  --bucket "$(terraform output -raw artifacts_bucket_name)" \
  --strategies-table "$(terraform output -raw strategies_table_name)" \
  --artifacts-table "$(terraform output -raw strategy_artifacts_table_name)" \
  --artifact-versions-table "$(terraform output -raw strategy_artifact_versions_table_name)" \
  --region us-east-1
  ```

## 2) Frontend

### Install dependencies
From root:
```bash
npm install
```

### Configure environment
Make a new `.env` file.
```bash
cp frontend/.env.example frontend/.env
```

Get the deployed API Gateway URL
```bash
terraform -chdir=../infra output -raw http_api_endpoint
```

Edit `frontend/.env`:
```ini
VITE_CORE_API=https://your-api.execute-api.us-east-1.amazonaws.com/dev
```

- `VITE_CORE_API` should point at the deployed API Gateway URL.

### Run the dev server
```bash
npm run dev
```

Open `http://localhost:5173`.
