# Migrating from AWS — HQG Dashboard

The dashboard used to run on AWS. This version serves the same API from a single
service and PostgreSQL. This guide maps the old resources to the new ones, moves the
data across, and lists the behavior that differs.

## What replaced what

| AWS | Now |
| --- | --- |
| API Gateway HTTP API, its cookie authorizer and CORS settings | The FastAPI app in `backend/hqg_dashboard`: the same routes, responses and status codes |
| Lambdas in `aws/lambdas/` | `backend/hqg_dashboard/routes/` (`accounts/` for engine accounts) |
| DynamoDB tables | PostgreSQL tables, defined in `backend/hqg_dashboard/migrations/` |
| S3 artifacts bucket: strategy files and engine packages | Stored in the database |
| S3 backtests bucket, presigned POST and GET URLs | Stored in the database; short-lived signed URLs under `/storage/backtests` |
| S3 JWKS object (`jwks_object_url`) | `GET /.well-known/jwks.json` |
| SSM signing key, monthly EventBridge rotator | Keys in the database, rotated monthly by the API |
| Terraform, Lambda layers | `docker-compose.yml`, `backend/requirements.txt` |
| CloudWatch logs | `docker-compose logs api` |
| `infra/seed/main.py` | `python -m hqg_dashboard seed` |
| `aws/lambdas/accounts/admin.py` | `python -m hqg_dashboard provision-account` and `authorize-replacement` |

Session cookies keep their name, claims and attributes, and keys keep the same key ids
(RFC 7638 thumbprints). Services that verify sessions only need the new JWKS URL.

## Moving the data

`import-aws` copies the AWS deployment into an empty database in one transaction:
members, access requests, strategies with every file version, sharing, backtests
and their results, engine accounts with their registered packages, and the strategy
id counter. With `--jwt-key-parameter` it also copies the current session signing key,
so nobody has to sign in again. Data that cannot be copied, such as a file version
whose S3 object is gone, is reported as a warning and skipped.

The AWS credentials need `dynamodb:Scan` and `dynamodb:GetItem` on the tables,
`s3:GetObject` and `s3:GetObjectVersion` on both buckets, and `ssm:GetParameter` on
the key parameter.

### 1) Deploy and rehearse

Deploy this version as in [prod_deployment.md](./prod_deployment.md), steps 1–4, but
do not seed it. From your checkout of the AWS version, with its prod Terraform backend
configured, export the resource names and copy them to the VPS checkout:

```bash
AWS_PROFILE=hqg-prod terraform -chdir=infra output -json > aws-outputs.json
scp aws-outputs.json <vps>:/home/software/hqg-dashboard/
```

On the VPS, with the `hqg-prod` AWS profile in `~/.aws`, run the import in a one-off
container:

```bash
cd /home/software/hqg-dashboard
docker-compose run --rm --no-deps -u root \
  -v "$HOME/.aws:/root/.aws:ro" -e AWS_PROFILE=hqg-prod \
  -v "$PWD/aws-outputs.json:/app/aws-outputs.json:ro" \
  api sh -c 'pip install --no-cache-dir -q -r requirements-aws-import.txt &&
    python -m hqg_dashboard import-aws --terraform-outputs aws-outputs.json \
      --jwt-key-parameter hqg-prod-jwt-private-key'
```

It prints the warnings and how many records of each kind it copied. Review them and
spot-check the data: until the cutover, test the new API locally through
`ssh -L 5000:127.0.0.1:5000 <vps>` and the frontend's dev server
(`CORE_API_URL=http://localhost:5000`), or compare in the database shell.

### 2) Cut over

1. A day ahead, lower the TTL of the `api` DNS record, so the switch propagates quickly.
2. Pause both modes of every engine account, wait for reconciliation, and stop the
   engine providers.
3. Stop writes to AWS by throttling its API to zero; it then answers every request with 429:
   ```bash
   AWS_PROFILE=hqg-prod aws apigatewayv2 update-stage \
     --api-id "$(terraform -chdir=infra output -raw http_api_id)" --stage-name prod \
     --default-route-settings ThrottlingBurstLimit=0,ThrottlingRateLimit=0
   ```
4. Import again, replacing the rehearsal: add `--replace` to the `import-aws` command
   above. It deletes the dashboard data but keeps this deployment's signing keys.
5. Point `api.uconnquant.com` at the VPS ([prod_deployment.md](./prod_deployment.md),
   step 4) and update the other services' settings (step 5):
   - hqg-platform: `HQG_DASH_JWKS_URL` and `DASHBOARD_CORE_URL`
   - hqg-backtester: `HQG_DASH_JWKS_URL`
   - hqg-engine: `DASHBOARD_SYNC_URL`, plus the readiness settings in this `.env`
     (`CONTROL_READINESS_URL`, `CONTROL_READINESS_TOKEN`, `WEBSITE_READINESS_URL`,
     which were the Terraform variables `engine_control_readiness_url`,
     `engine_control_readiness_token` and `engine_frontend_readiness_url`)
6. Check the deployment (step 6), start the engine providers and Resume.

Keeping the hostname `api.uconnquant.com` leaves the frontend's `CORE_API_URL` and the
CAS service URL unchanged, so the frontend needs no new deploy.

### 3) Clean up

Delete `aws-outputs.json` and the AWS credentials from the VPS. Once the new
deployment has run long enough that you will not roll back, destroy the AWS stack from
the old checkout with `terraform destroy`; its buckets and tables are then deleted.
Until then, rolling back means restoring the `api` DNS record and the services'
settings, and lifting the throttle with a `terraform apply`. Changes made on the VPS
in the meantime would not be in AWS.

## Behavior that differs

These are deliberate. None needs a frontend change.

**Sessions and keys**
- Retired signing keys stay published until the sessions they signed expire. AWS
  dropped the previous key when it rotated, which signed everyone out once a month.
- Roles and bans are read from the database on every request, so changes apply at
  once. The API Gateway authorizer cached its decisions for up to 5 minutes.

**New endpoints**
- `GET /health` for health checks, and `GET /.well-known/jwks.json` (cacheable for 10
  minutes) in place of the S3 object.
- `POST /storage/backtests` and `GET /storage/backtests/{key}` take the place of the S3
  presigned URLs. Browsers use them exactly as they used S3; responses still describe
  payloads with `s3_bucket`, `s3_key` and `s3` fields, with the bucket name `backtests`.

**Validation and limits**
- Request bodies that are not valid JSON objects, and strings with unpaired
  surrogates, are rejected with 400.
- Backtest uploads are limited to 25 MiB and their uncompressed results to 256 MiB
  (`BACKTEST_UPLOAD_MAX_BYTES`, `BACKTEST_PAYLOAD_MAX_BYTES`). A non-finite
  `initial_capital` is rejected.
- Rate limiting is configured in nginx instead of API Gateway.

**Consistency**
- Creating a strategy, updating its sharing and saving a backtest are single
  transactions. A sharing update with an invalid entry changes nothing.
- Saving a backtest for a strategy that does not exist answers 404.
- `next_cursor` is null unless another page of backtests exists.
- Strategy ids come from a database sequence, which `seed` and `import-aws` keep
  ahead of the existing ids.

**Smaller differences**
- Member search covers every member, not only those carrying the AWS search index
  attributes (`search_pk`, `full_name_lower`).
- File paths may contain `/`, and downloads of any file name get a valid
  `Content-Disposition` header.
- Admin lists are ordered: members by NetID, access requests newest first. A denial
  without notes stores `""`.
- Responses omit unset attributes, as DynamoDB items did. The approve response no
  longer includes explicit nulls or the internal `search_pk` and `full_name_lower`
  attributes.
- `seed --admin-netid` keeps an existing member's profile.
- Registered engine packages are kept in the database rather than the versioned
  artifacts bucket.
