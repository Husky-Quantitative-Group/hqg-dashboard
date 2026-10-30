# Prod Deployment — HQG Dashboard

Use this runbook to deploy `prod` on the HQG VPS from a fresh clone. The API and its
PostgreSQL database run with Docker Compose, like the other HQG services; nginx on
the host terminates TLS. The frontend stays on GitHub Pages.

If an AWS deployment holds the data you want to keep, follow
[aws_migration.md](./aws_migration.md) alongside this runbook.

## 1) Clone the repo

```bash
cd /home/software
git clone https://github.com/Husky-Quantitative-Group/hqg-dashboard.git
cd hqg-dashboard
```

## 2) Configure

```bash
cp .env.example .env
chmod 600 .env
```

Edit `.env`:

- `POSTGRES_PASSWORD`: letters and digits only, e.g. `openssl rand -hex 24`.
- `FRONTEND_BASE_URL=https://dashboard.uconnquant.com` and
  `PUBLIC_API_URL=https://api.uconnquant.com`. Keeping the AWS API's hostname means
  the frontend and the CAS service URL (`https://api.uconnquant.com/auth/callback`)
  stay the same.
- The engine readiness settings, once an engine account exists (see
  [Engine accounts](#engine-accounts)).
- The proxy variables, if the VPS needs a proxy for outbound HTTPS. The readiness
  checks use a proxy only through `READINESS_PROXY_URL` (see
  [Engine accounts](#engine-accounts)).

## 3) Start

```bash
docker network create hqg_network 2>/dev/null || true
docker-compose up -d --build
curl -s http://127.0.0.1:5000/health
```

The API applies database migrations and creates its session signing key when it
starts. It listens on `127.0.0.1:5000` only (`API_PORT` changes the host port).

## 4) nginx and TLS

Add a server block for the API, e.g. `/etc/nginx/sites-available/hqg-dashboard-api`,
enable it and reload nginx:

```nginx
# API Gateway's limits: 50 requests per second, bursts of 25.
limit_req_zone $server_name zone=hqg_dashboard_api:1m rate=50r/s;

server {
    listen 80;
    server_name api.uconnquant.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name api.uconnquant.com;

    ssl_certificate     /etc/letsencrypt/live/api.uconnquant.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.uconnquant.com/privkey.pem;

    # Backtest uploads are up to 25 MiB (BACKTEST_UPLOAD_MAX_BYTES).
    client_max_body_size 30m;

    limit_req zone=hqg_dashboard_api burst=25 nodelay;
    limit_req_status 429;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Issue the certificate the same way as for the other HQG hostnames, e.g.
`sudo certbot certonly --nginx -d api.uconnquant.com`.

In Squarespace DNS, replace the `api` CNAME (the API Gateway target) with a record for
the VPS. If the VPS is only reachable through the university's reverse proxy, ITS has
to forward `api.uconnquant.com` as well. Without a new hostname, the API can instead
be served under a path of an existing one:

```nginx
# Inside the existing server block of platform.uconnquant.com:
location /dashboard-api/ {
    proxy_pass http://127.0.0.1:5000/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 30m;
}
```

Then use `https://platform.uconnquant.com/dashboard-api` as `PUBLIC_API_URL` and as
every URL of the API below. CAS must accept the new service URL,
`https://platform.uconnquant.com/dashboard-api/auth/callback`.

## 5) Point the frontend and services at the API

- Frontend: the GitHub repository variable `CORE_API_URL` (Settings → Secrets and
  variables → Actions → Variables) is the API's URL, `https://api.uconnquant.com`.
  `BACKTESTER_URL` and `ENGINE_URL` are unchanged. Pushing to `prod` deploys the
  frontend as before.
- hqg-platform `.env`:
  - `HQG_DASH_JWKS_URL=https://api.uconnquant.com/.well-known/jwks.json`
  - `DASHBOARD_CORE_URL=http://hqg-dashboard-api:5000`, for the control readiness
    check. Both containers are on `hqg_network`, and the platform makes this request
    without a proxy.
- hqg-backtester `.env`: `HQG_DASH_JWKS_URL=https://api.uconnquant.com/.well-known/jwks.json`
- hqg-engine `.env`: `DASHBOARD_SYNC_URL=https://api.uconnquant.com`. The engine
  requires HTTPS, so it connects through nginx. It ignores the proxy variables; if the
  VPS reaches Alpaca only through a proxy, also set `ALPACA_PROXY_URL` to it.

Restart each service after changing its `.env`.

## 6) Verify

```bash
curl -i https://api.uconnquant.com/health
curl -s https://api.uconnquant.com/.well-known/jwks.json
```

Then sign in at https://dashboard.uconnquant.com.

## 7) Seed initial data (first deploy only, without an AWS import)

```bash
docker-compose exec api python -m hqg_dashboard seed --admin-netid <your-netid> \
  --backtester-url http://hqg-backtester:8005
# Optional: --skip-backtests instead of --backtester-url
```

## 8) Deploying updates

The hqg-deployment scripts work unchanged for this repo:

```bash
cd /home/software/hqg-dashboard
git pull
docker network create hqg_network 2>/dev/null || true
docker-compose down
docker-compose up -d --build --remove-orphans
docker image prune -f
```

The database lives in the `hqg-dashboard-postgres-data` volume, which `down` keeps.
`docker-compose down -v` deletes it.

## Operations

### Logs and database shell

```bash
docker-compose logs -f api
docker-compose exec db psql -U hqg hqg_dashboard
docker-compose exec api python -m hqg_dashboard --help
```

### Backups

Back up the database regularly, e.g. daily from cron:

```bash
docker-compose exec -T db pg_dump -U hqg -d hqg_dashboard --format=custom \
  > /home/software/backups/hqg-dashboard-$(date +%F).dump
```

Restore into a running stack with:

```bash
docker-compose exec -T db pg_restore -U hqg -d hqg_dashboard --clean --if-exists \
  < /home/software/backups/hqg-dashboard-<date>.dump
```

A backup contains the session signing keys, so keep it as private as `.env`.

### Session signing keys

The API signs session cookies with RSA keys kept in the database and published at
`/.well-known/jwks.json`. It starts a new key on the first check of each month, as
the AWS key rotator did, and keeps publishing the previous key until the sessions it
signed have expired, so rotation signs nobody out.

To start a new key immediately:

```bash
docker-compose exec api python -m hqg_dashboard rotate-keys
```

Sessions signed with older keys stay valid until they expire (24 hours). To end them
at once, e.g. after a leak, also delete the older keys:

```bash
docker-compose exec db psql -U hqg hqg_dashboard -c \
  "DELETE FROM jwt_signing_keys WHERE created_at < (SELECT max(created_at) FROM jwt_signing_keys)"
```

### Admins

Admins manage members, roles and access requests in the dashboard. The first admin of
a new install comes from `seed --admin-netid` (step 7); an AWS import keeps the
existing admins.

### Engine accounts

Choose account and engine UUIDs and a service secret (`openssl rand -hex 32`), and
set in `.env`:

- `CONTROL_READINESS_TOKEN`: the service secret.
- `CONTROL_READINESS_URL=https://platform.uconnquant.com/control/accounts/<account-UUID>/readiness`
- `WEBSITE_READINESS_URL=https://dashboard.uconnquant.com`

The API checks both URLs directly, ignoring the proxy variables, as the Lambda did. If
the VPS reaches them only through a proxy, set `READINESS_PROXY_URL` to it; hosts that
`NO_PROXY` lists are still reached directly. Missing or failed checks prevent
execution.

Apply the settings and provision the account:

```bash
docker-compose up -d
docker-compose exec api python -m hqg_dashboard provision-account \
  --secret-env CONTROL_READINESS_TOKEN \
  --account-id <account-UUID> --engine-id <engine-UUID> --netid <your-NetID>
# Optional: --allow-live
```

Give the engine the same account UUID, engine UUID and secret (`DASHBOARD_SYNC_SECRET`).
Before replacing a provider, stop the old process, wait at least 15 seconds after its
last heartbeat, then run:

```bash
docker-compose exec api python -m hqg_dashboard authorize-replacement \
  --account-id <account-UUID> --actor <maintainer-NetID>
```

See [local_setup.md](./local_setup.md#engine-accounts-and-readiness) for the full
account workflow.
