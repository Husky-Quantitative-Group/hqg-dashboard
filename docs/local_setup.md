# Local Setup — HQG Dashboard

This repo has two main parts:
- `frontend/` for the React Router UI
- `infra/` + `aws/` for the AWS infrastructure and Lambda APIs

Most people will only need the frontend, but the UI needs an API endpoint to talk to.

## Prerequisites
- Node.js + npm (LTS) for the frontend: https://nodejs.org/en/download
- Terraform (>= 1.5) for infra work: https://developer.hashicorp.com/terraform/downloads
- AWS credentials for Terraform: https://developer.hashicorp.com/terraform/language/providers/aws#authentication

## 1) Frontend (local dev)

### Install dependencies
```bash
cd frontend
npm install
```

### Configure environment
```bash
cp .env.example .env
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

## 2) Infra (AWS / Terraform)

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

### Init / plan / apply
```bash
cd infra
terraform init
terraform plan -var-file=dev.tfvars
terraform apply -var-file=dev.tfvars
```

### Get the API base URL
```bash
terraform output -raw http_api_endpoint
```

Set that value as `VITE_CORE_API` in `frontend/.env`.

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

### Tear down
```bash
terraform destroy -var-file=dev.tfvars
```

## 3) Lambda Layers

This repository uses AWS Lambda Layers to manage Python dependencies that are shared across Lambdas (for example, JWT libraries).

### Why Lambda Layers
- Keeps Lambda source code clean (no vendored `site-packages`).
- Avoids committing large dependency trees to git.
- Allows reuse of the same dependency set across multiple Lambdas.
- Makes upgrades explicit and centralized.

### How layers are used here
- Each folder under `aws/lambda_layers/` represents one Lambda Layer.
- Each layer contains:
  - `requirements.txt` - source of truth for dependencies.
  - `build/` - generated artifacts (should not be committed).

Example:
```
aws/lambda_layers/
  pyjwt/
    requirements.txt
    build/
      python/
      pyjwt-layer.zip
```

### Build flow
1. Install dependencies listed in `requirements.txt` into a `python/` directory.
2. Zip the directory into a layer artifact.
3. Terraform uploads the zip and attaches the layer to Lambdas.

All build output lives in `build/`.

### When to add a new layer
Create a new folder under `aws/lambda_layers/` if:
- A dependency is used by more than one Lambda, or
- The dependency is non-trivial (auth, crypto, SDKs, etc.).

Otherwise, keep Lambdas dependency-free where possible.

### Build layers
If your branch includes the layer build tooling, run:
```bash
bash scripts/build_layers.sh
```
