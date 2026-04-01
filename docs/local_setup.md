# Local Setup — HQG Dashboard

This repo has two main parts:
- `frontend/` for the React Router UI
- `infra/` + `aws/` for the AWS infrastructure and Lambda APIs

## Prerequisites
- Node.js + npm (LTS) for the frontend: https://nodejs.org/en/download
- Terraform (>= 1.5) for infra work: https://developer.hashicorp.com/terraform/downloads
- AWS credentials for Terraform: https://developer.hashicorp.com/terraform/language/providers/aws#authentication

## 1) Infra (AWS / Terraform)

If you already have a deployed API, you can skip this section and just set `CORE_API_URL` in `frontend/.env`.

### Create your tfvars file
```bash
cp infra/example.tfvars infra/dev.tfvars
```

Edit `infra/dev.tfvars` with your values:
- `project`, `env`, `aws_region`
- `frontend_base_url` (CORS / allowed origin)

### Build Lambda Layers
This repository uses AWS Lambda Layers to manage Python dependencies that are shared across Lambdas (for example, JWT libraries).

This step is only required when you add/update any lambda layers in `/aws/lambda_layers`.

```bash
bash infra/scripts/build_layers.sh
```

### Init / plan / apply
Deploy the infrastructure from repo root:
```bash
terraform -chdir=infra init # only needed once
terraform -chdir=infra plan -var-file=dev.tfvars
terraform -chdir=infra apply -var-file=dev.tfvars # same as plan, but with option to deploy
```

### Seed data (required on first deploy)
Seeding is required the first time you create a new stack.

```bash
python3 -m pip install --user boto3
python3 infra/seed/main.py \
  --bucket "$(terraform -chdir=infra output -raw artifacts_bucket_name)" \
  --backtests-bucket "$(terraform -chdir=infra output -raw backtests_bucket_name)" \
  --strategies-table "$(terraform -chdir=infra output -raw strategies_table_name)" \
  --artifacts-table "$(terraform -chdir=infra output -raw strategy_artifacts_table_name)" \
  --artifact-versions-table "$(terraform -chdir=infra output -raw strategy_artifact_versions_table_name)" \
  --strategy-backtests-table "$(terraform -chdir=infra output -raw strategy_backtests_table_name)" \
  --strategies-read-permissions-table "$(terraform -chdir=infra output -raw strategies_read_permissions_table_name)" \
  --strategies-write-permissions-table "$(terraform -chdir=infra output -raw strategies_write_permissions_table_name)" \
  --backtester-url "http://localhost:8005" \
  --users-table "$(terraform -chdir=infra output -raw users_table_name)" \
  --admin-netid "YOUR_NETID" \
  --region us-east-1
# Optional: --skip-backtests
```

Run this from the repo root and use the same region as `aws_region` in `dev.tfvars`.
If the backtester URL is unreachable or blocked, strategies still seed and backtests are skipped with a summary at the end.
You can also force skipping backtests with `--skip-backtests`.
Seeded strategies are private by default. To mark a strategy public at seed time, add `"public": true` to its entry in `infra/seed/strategies.json`.

### Tear down
```bash
terraform -chdir=infra destroy -var-file=dev.tfvars
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
CORE_API_URL=https://your-api.execute-api.us-east-1.amazonaws.com/dev
IS_PROD=0
```

- `CORE_API_URL` should point at the deployed API Gateway URL.
- `IS_PROD=0` keeps local proxy behavior (`/api` and `/backtester-api`) for development.

### Run the dev server
```bash
npm run dev
```

Open `http://localhost:5173`.

## 4) Backtester

### Docker
In order to have the backtester working, make sure you have [Docker Desktop](https://www.docker.com/get-started/) installed onto your device. The hqg-backtester repo is required for setup. It is recommonded to follow a similar file structure if you don't have the backtester repo cloned already:

```text
hqg/
├── hqg-dashboard/
└── hqg-backtester/
```

Clone the backtester:

```bash
git clone https://github.com/Husky-Quantitative-Group/hqg-backtester.git
cd hqg-backtester
```

Set the backtester environment variable `HQG_JWKS_URL` to the JWKS endpoint from Terraform:

```bash
terraform output -raw jwks_object_url
```

If you're running this from the `hqg-backtester` directory, point Terraform at the dashboard infra folder:

```bash
terraform -chdir=../hqg-dashboard/infra output -raw jwks_object_url
```

Run the backtester:

```bash
docker compose up --build
```

The API should be available at http://localhost:8005

If you're running the dashboard locally, set the backtester URL in `frontend/.env` so the Vite proxy can reach it:

```ini
BACKTESTER_URL=http://localhost:8005
```
